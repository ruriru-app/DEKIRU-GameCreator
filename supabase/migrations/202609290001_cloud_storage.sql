create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema private from public, anon, authenticated;

create table private.plan_limits (
  plan text primary key, games int not null, publications int not null,
  questions int not null, project_bytes int not null, minute_writes int not null, daily_writes int not null
);
insert into private.plan_limits values ('free',20,10,200,262144,20,500);
create table private.accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','disabled')),
  plan text not null default 'free' references private.plan_limits(plan),
  minute_started timestamptz, minute_count int not null default 0,
  day_started date, day_count int not null default 0
);
create table private.service_control (
  id boolean primary key default true check (id),
  save_enabled boolean not null default true, publish_enabled boolean not null default true,
  public_read_enabled boolean not null default true
);
insert into private.service_control(id) values (true);
create table private.games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references private.accounts(owner_id) on delete cascade,
  project jsonb not null, version int not null default 1 check (version>0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index on private.games(owner_id);
create table private.publications (
  game_id uuid primary key references private.games(id) on delete cascade,
  share_id text not null unique check (share_id ~ '^[A-Za-z0-9_-]{22}$'),
  snapshot jsonb not null, status text not null check (status in ('published','stopped')),
  version int not null check (version>0), source_version int not null,
  runtime_version text not null check (runtime_version='fusuma-1')
);
create table private.requests (
  owner_id uuid not null references private.accounts(owner_id) on delete cascade,
  request_id uuid not null, fingerprint text not null, result jsonb not null,
  expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
  primary key(owner_id,request_id)
);
create index on private.requests(expires_at);
alter table private.plan_limits enable row level security;
alter table private.accounts enable row level security;
alter table private.service_control enable row level security;
alter table private.games enable row level security;
alter table private.publications enable row level security;
alter table private.requests enable row level security;
revoke all on all tables in schema private from public,anon,authenticated;

create function private.fail(code text) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('ok',false,'error',jsonb_build_object('code',code,'message','Request could not be completed'));
$$;
create function private.success(data jsonb) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('ok',true,'data',data);
$$;
create function private.nonblank(value text) returns boolean language sql immutable set search_path='' as $$
  select length(btrim(value,E' \t\n\r\f\v'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)))>0;
$$;
-- Match compact browser serialization, including its small fractional volume.
create function private.number_text(value double precision) returns text language plpgsql immutable set search_path='' as $$
begin
  if value=0 then return '0'; end if;
  if value>=0.000001 then return (value::text::numeric)::text; end if;
  return regexp_replace(value::text,'e-0+','e-');
end;
$$;
create function private.project_text(p jsonb) returns text language sql immutable set search_path='' as $$
  select '{"schemaVersion":1,"title":'||to_json(p->>'title')::text||',"gameType":"typing","templateId":"fusuma","settings":{"volume":'||
    private.number_text((p->'settings'->>'volume')::double precision)||',"muted":'||(p->'settings'->>'muted')||
    '},"questions":['||coalesce((select string_agg(
      '{"id":'||to_json(q->>'id')::text||',"prompt":'||to_json(q->>'prompt')::text||
      ',"displayAnswer":'||to_json(q->>'displayAnswer')::text||',"reading":'||to_json(q->>'reading')::text||
      ',"romajiHint":'||to_json(q->>'romajiHint')::text||'}',',' order by n)
      from jsonb_array_elements(p->'questions') with ordinality as e(q,n)),'')||']}';
$$;
create function private.validate_project(project_text text, mode text) returns jsonb language plpgsql immutable set search_path='' as $$
declare p jsonb; q jsonb; field text; ids text[]='{}'; max_chars int;
begin
  if mode not in ('draft','publish') or mode is null or project_text is null then return private.fail('VALIDATION'); end if;
  if octet_length(project_text)>2097152 then return private.fail('LIMIT'); end if;
  p:=project_text::jsonb;
  if jsonb_typeof(p)<>'object' or p- array['schemaVersion','title','gameType','templateId','settings','questions']<>'{}'::jsonb or
    p->'schemaVersion' is distinct from '1'::jsonb or p->>'gameType' is distinct from 'typing' or p->>'templateId' is distinct from 'fusuma' or
    jsonb_typeof(p->'title') is distinct from 'string' or jsonb_typeof(p->'questions') is distinct from 'array' or
    jsonb_typeof(p->'settings') is distinct from 'object' then return private.fail('VALIDATION'); end if;
  if (p->'settings')-array['volume','muted']<>'{}'::jsonb or jsonb_typeof(p->'settings'->'muted') is distinct from 'boolean' or
    jsonb_typeof(p->'settings'->'volume') is distinct from 'number' then return private.fail('VALIDATION'); end if;
  if (p->'settings'->>'volume')::numeric<0 or (p->'settings'->>'volume')::numeric>1 then return private.fail('VALIDATION'); end if;
  if char_length(p->>'title')>80 or jsonb_array_length(p->'questions')>200 then return private.fail('LIMIT'); end if;
  if mode='publish' and (not private.nonblank(p->>'title') or jsonb_array_length(p->'questions')=0) then return private.fail('VALIDATION'); end if;
  for q in select value from jsonb_array_elements(p->'questions') loop
    if jsonb_typeof(q)<>'object' or q-array['id','prompt','displayAnswer','reading','romajiHint']<>'{}'::jsonb or
      jsonb_typeof(q->'id') is distinct from 'string' or not ((q->>'id') ~ '^[A-Za-z0-9_-]{1,128}$') or q->>'id'=any(ids)
      then return private.fail('VALIDATION'); end if;
    ids:=array_append(ids,q->>'id');
    foreach field in array array['prompt','displayAnswer','reading','romajiHint'] loop
      if jsonb_typeof(q->field) is distinct from 'string' then return private.fail('VALIDATION'); end if;
      max_chars:=case field when 'prompt' then 1000 when 'romajiHint' then 800 else 200 end;
      if char_length(q->>field)>max_chars then return private.fail('LIMIT'); end if;
      if mode='publish' and field<>'romajiHint' and not private.nonblank(q->>field) then return private.fail('VALIDATION'); end if;
    end loop;
  end loop;
  if octet_length(private.project_text(p))>262144 then return private.fail('LIMIT'); end if;
  return private.success(p);
exception when others then return private.fail('VALIDATION');
end;
$$;

create function private.account() returns private.accounts language plpgsql set search_path='' as $$
declare a private.accounts;
begin
  if auth.uid() is null then return null; end if;
  insert into private.accounts(owner_id) values(auth.uid()) on conflict do nothing;
  select * into a from private.accounts where owner_id=auth.uid();
  return a;
end;
$$;
create function private.game_meta(g private.games) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',g.id,'version',g.version,'title',g.project->>'title',
    'questionCount',jsonb_array_length(g.project->'questions'),'updatedAt',g.updated_at,
    'publication',(select jsonb_build_object('shareId',p.share_id,'status',p.status,'version',p.version,
      'sourceVersion',p.source_version,'runtimeVersion',p.runtime_version) from private.publications p where p.game_id=g.id),
    'publicationDirty',coalesce((select p.snapshot<>g.project from private.publications p where p.game_id=g.id),false));
$$;
create function public.creator_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.accounts; l private.plan_limits; c private.service_control;
begin
  a:=private.account();
  if a.owner_id is null then return private.fail('UNAUTHENTICATED'); end if;
  if a.status<>'active' then return private.fail('FORBIDDEN'); end if;
  select * into l from private.plan_limits where plan=a.plan;
  select * into c from private.service_control where id;
  return private.success(jsonb_build_object('ownerId',a.owner_id,'status',a.status,'plan',a.plan,
    'limits',jsonb_build_object('games',l.games,'publications',l.publications,'questions',l.questions,'bytes',l.project_bytes),
    'counts',jsonb_build_object('games',(select count(*) from private.games where owner_id=a.owner_id),
      'publications',(select count(*) from private.publications p join private.games g on g.id=p.game_id where g.owner_id=a.owner_id and p.status='published')),
    'capabilities',jsonb_build_object('save',c.save_enabled,'publish',c.publish_enabled)));
end;
$$;
create function public.list_games() returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.accounts;
begin
  a:=private.account();
  if a.owner_id is null then return private.fail('UNAUTHENTICATED'); end if;
  if a.status<>'active' then return private.fail('FORBIDDEN'); end if;
  return private.success(coalesce((select jsonb_agg(private.game_meta(g) order by g.updated_at desc,g.id) from private.games g where g.owner_id=a.owner_id),'[]'::jsonb));
end;
$$;
create function public.load_game(p_game_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.accounts; g private.games;
begin
  a:=private.account();
  if a.owner_id is null then return private.fail('UNAUTHENTICATED'); end if;
  if a.status<>'active' then return private.fail('FORBIDDEN'); end if;
  select * into g from private.games where id=p_game_id and owner_id=a.owner_id;
  if g.id is null then return private.fail('UNAVAILABLE'); end if;
  return private.success(private.game_meta(g)||jsonb_build_object('project',g.project));
end;
$$;

-- Invoked only after the owner account lock. Exceptions roll back game changes,
-- while the outer function retains the consumed abuse-limit counter.
create function private.apply_mutation(owner uuid,command text,args jsonb) returns jsonb language plpgsql set search_path='' as $$
declare g private.games; p private.publications; l private.plan_limits; c private.service_control;
  game_id uuid; expected int; checked jsonb; publication_count int; new_share text; attempts int=0;
begin
  if command is null or command not in ('save','publish','unpublish','republish','delete') or jsonb_typeof(args)<>'object' then return private.fail('VALIDATION'); end if;
  if args - case when command='save' then array['gameId','expectedVersion','requestId','projectText'] else array['gameId','expectedVersion','requestId'] end <> '{}'::jsonb then return private.fail('VALIDATION'); end if;
  if not(args ? 'gameId') or jsonb_typeof(args->'expectedVersion') is distinct from 'number' or (args->>'expectedVersion') !~ '^[0-9]+$' then return private.fail('VALIDATION'); end if;
  expected:=(args->>'expectedVersion')::int;
  game_id:=(args->>'gameId')::uuid;
  select pl.* into l from private.plan_limits pl join private.accounts a on a.plan=pl.plan where a.owner_id=owner;
  select * into c from private.service_control where id;
  if command='save' and not c.save_enabled or command in ('publish','republish') and not c.publish_enabled then return private.fail('SERVICE_UNAVAILABLE'); end if;
  if command='save' then
    if jsonb_typeof(args->'projectText') is distinct from 'string' then return private.fail('VALIDATION'); end if;
    checked:=private.validate_project(args->>'projectText','draft');
    if checked->>'ok'<>'true' then return checked; end if;
  end if;
  if game_id is null then
    if command<>'save' or expected<>0 then return private.fail('VALIDATION'); end if;
    if (select count(*) from private.games where owner_id=owner)>=l.games then return private.fail('LIMIT'); end if;
    insert into private.games(owner_id,project) values(owner,checked->'data') returning * into g;
    return private.success(private.game_meta(g));
  end if;
  select * into g from private.games where id=game_id and owner_id=owner for update;
  if g.id is null then return private.fail('UNAVAILABLE'); end if;
  if g.version<>expected then return private.fail('CONFLICT'); end if;
  if command='delete' then
    delete from private.games where id=g.id;
    return private.success(jsonb_build_object('id',g.id,'deleted',true));
  elsif command='save' then
    update private.games set project=checked->'data',version=version+1,updated_at=clock_timestamp() where id=g.id returning * into g;
  else
    select * into p from private.publications where private.publications.game_id=g.id;
    if command in ('publish','republish') and (p.game_id is null or p.status<>'published') then
      select count(*) into publication_count from private.publications pub join private.games game on game.id=pub.game_id where game.owner_id=owner and pub.status='published';
      if publication_count>=l.publications then return private.fail('LIMIT'); end if;
    end if;
    if command='publish' then
      checked:=private.validate_project(private.project_text(g.project),'publish');
      if checked->>'ok'<>'true' then return checked; end if;
      if p.game_id is null then
        loop
          new_share:=translate(rtrim(encode(extensions.gen_random_bytes(16),'base64'),'='),'+/','-_');
          begin
            insert into private.publications values(g.id,new_share,g.project,'published',1,g.version,'fusuma-1');
            exit;
          exception when unique_violation then
            attempts:=attempts+1;
            if attempts>=3 then raise; end if;
          end;
        end loop;
      else
        update private.publications set snapshot=g.project,status='published',version=version+1,source_version=g.version where private.publications.game_id=g.id;
      end if;
    else
      if p.game_id is null then return private.fail('UNAVAILABLE'); end if;
      update private.publications set status=case command when 'republish' then 'published' else 'stopped' end where private.publications.game_id=g.id;
    end if;
    update private.games set version=version+1,updated_at=clock_timestamp() where id=g.id returning * into g;
  end if;
  return private.success(private.game_meta(g));
exception when invalid_text_representation or numeric_value_out_of_range then return private.fail('VALIDATION');
end;
$$;

create function public.mutate_game(p_command text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.accounts; l private.plan_limits; prior private.requests; request_id uuid; fingerprint text; result jsonb;
  v_now timestamptz=clock_timestamp(); current_minute timestamptz; current_day date;
begin
  a:=private.account();
  if a.owner_id is null then return private.fail('UNAUTHENTICATED'); end if;
  select * into a from private.accounts where owner_id=a.owner_id for update;
  if a.status<>'active' then return private.fail('FORBIDDEN'); end if;
  select * into l from private.plan_limits where plan=a.plan;
  begin
    if jsonb_typeof(p_args->'requestId')='string' then request_id:=(p_args->>'requestId')::uuid; end if;
  exception when invalid_text_representation then request_id:=null;
  end;
  if request_id is not null then
    fingerprint:=encode(extensions.digest(coalesce(p_command,'')||':'||p_args::text,'sha256'),'hex');
    select * into prior from private.requests r where r.owner_id=a.owner_id and r.request_id=mutate_game.request_id and r.expires_at>v_now;
    if prior.request_id is not null then
      if prior.fingerprint=fingerprint then return prior.result; end if;
      return private.fail('REQUEST_MISMATCH');
    end if;
  end if;
  current_minute:=date_trunc('minute',v_now);
  current_day:=(v_now at time zone 'UTC')::date;
  update private.accounts set
    minute_started=current_minute,minute_count=case when minute_started=current_minute then least(minute_count+1,l.minute_writes+1) else 1 end,
    day_started=current_day,day_count=case when day_started=current_day then least(day_count+1,l.daily_writes+1) else 1 end
    where owner_id=a.owner_id returning * into a;
  if a.minute_count>l.minute_writes or a.day_count>l.daily_writes then
    return private.fail('RATE_LIMIT')||jsonb_build_object('error',jsonb_build_object('code','RATE_LIMIT','message','Please wait','retryAfterSeconds',
      case when a.day_count>l.daily_writes then ceil(extract(epoch from ((current_day+1)::timestamp at time zone 'UTC')-v_now))::int else 60 end));
  end if;
  if request_id is null then return private.fail('VALIDATION'); end if;
  begin
    result:=private.apply_mutation(a.owner_id,p_command,p_args);
  exception when others then result:=private.fail('SERVICE_UNAVAILABLE');
  end;
  insert into private.requests(owner_id,request_id,fingerprint,result) values(a.owner_id,request_id,fingerprint,result)
    on conflict on constraint requests_pkey do update set fingerprint=excluded.fingerprint,result=excluded.result,expires_at=clock_timestamp()+interval '24 hours';
  return result;
end;
$$;
create function private.purge_expired_cloud_records() returns void language sql security definer set search_path='' as $$
  delete from private.requests where expires_at<=clock_timestamp();
$$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.creator_context(),public.list_games(),public.load_game(uuid),public.mutate_game(text,jsonb) from public,anon,authenticated;
grant execute on function public.creator_context(),public.list_games(),public.load_game(uuid),public.mutate_game(text,jsonb) to authenticated;

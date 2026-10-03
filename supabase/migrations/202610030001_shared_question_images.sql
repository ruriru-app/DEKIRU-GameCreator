-- Additive shared-image rollout. No content conversion, auth, ACL or quota changes.
begin;
alter table private.service_control add column shared_question_images_enabled boolean not null default false;
alter table private.publications drop constraint publications_runtime_version_check;
alter table private.publications add constraint publications_runtime_version_check check (runtime_version in ('fusuma-1','fusuma-2','fusuma-3'));

create or replace function private.project_text(p jsonb) returns text language sql immutable set search_path='' as $$
  select '{"schemaVersion":'||case when p->'schemaVersion'='3'::jsonb then '3' when p->'schemaVersion'='2'::jsonb then '2' else '1' end||',"title":'||to_json(p->>'title')::text||',"gameType":"typing","templateId":"fusuma","settings":{"volume":'||
    private.number_text((p->'settings'->>'volume')::double precision)||',"muted":'||(p->'settings'->>'muted')||
    '},"questions":['||coalesce((select string_agg(
      '{"id":'||to_json(q->>'id')::text||',"prompt":'||to_json(q->>'prompt')::text||
      ',"displayAnswer":'||to_json(q->>'displayAnswer')::text||',"reading":'||to_json(q->>'reading')::text||
      ',"romajiHint":'||to_json(q->>'romajiHint')::text||
      case when q ? 'image' and p->'schemaVersion'='3'::jsonb then ',"image":{"imageId":'||to_json(q->'image'->>'imageId')::text||
      ',"placement":'||to_json(q->'image'->>'placement')::text||',"alt":'||to_json(q->'image'->>'alt')::text||'}'
      when q ? 'image' then ',"image":{"dataUrl":'||to_json(q->'image'->>'dataUrl')::text||
      ',"width":'||((q->'image'->>'width')::numeric::int)::text||',"height":'||((q->'image'->>'height')::numeric::int)::text||
      ',"placement":'||to_json(q->'image'->>'placement')::text||',"alt":'||to_json(q->'image'->>'alt')::text||'}' else '' end||'}',',' order by n)
      from jsonb_array_elements(p->'questions') with ordinality as e(q,n)),'')||']'||
    case when p->'schemaVersion'='3'::jsonb and p ? 'images' then ',"images":['||
      coalesce((select string_agg('{"id":'||to_json(a->>'id')::text||',"dataUrl":'||to_json(a->>'dataUrl')::text||
        ',"width":'||((a->>'width')::numeric::int)::text||',"height":'||((a->>'height')::numeric::int)::text||'}',',' order by n)
        from jsonb_array_elements(p->'images') with ordinality e(a,n)),'')||']' else '' end||'}';
$$;

create or replace function private.validate_project(project_text text, mode text) returns jsonb language plpgsql immutable set search_path='' as $$
declare p jsonb; q jsonb; field text; ids text[]='{}'; max_chars int; text_only jsonb; a jsonb; img jsonb; image_ids text[]='{}'; image_sources text[]='{}'; used_ids text[]='{}'; is_pool boolean;
begin
  if mode not in ('draft','publish') or mode is null or project_text is null then return private.fail('VALIDATION'); end if;
  if octet_length(project_text)>4194304 then return private.fail('LIMIT'); end if;
  p:=project_text::jsonb;
  is_pool:=p->'schemaVersion'='3'::jsonb;
  if jsonb_typeof(p)<>'object' or p-(case when is_pool then array['schemaVersion','title','gameType','templateId','settings','questions','images'] else array['schemaVersion','title','gameType','templateId','settings','questions'] end)<>'{}'::jsonb or
    (p->'schemaVersion' is null or p->'schemaVersion' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb)) or p->>'gameType' is distinct from 'typing' or p->>'templateId' is distinct from 'fusuma' or
    jsonb_typeof(p->'title') is distinct from 'string' or jsonb_typeof(p->'questions') is distinct from 'array' or
    jsonb_typeof(p->'settings') is distinct from 'object' then return private.fail('VALIDATION'); end if;
  if (p->'settings')-array['volume','muted']<>'{}'::jsonb or jsonb_typeof(p->'settings'->'muted') is distinct from 'boolean' or
    jsonb_typeof(p->'settings'->'volume') is distinct from 'number' then return private.fail('VALIDATION'); end if;
  if (p->'settings'->>'volume')::numeric<0 or (p->'settings'->>'volume')::numeric>1 then return private.fail('VALIDATION'); end if;
  if char_length(p->>'title')>80 or jsonb_array_length(p->'questions')>200 then return private.fail('LIMIT'); end if;
  if mode='publish' and (not private.nonblank(p->>'title') or jsonb_array_length(p->'questions')=0) then return private.fail('VALIDATION'); end if;
  if is_pool then
    if jsonb_typeof(p->'images') is distinct from 'array' then return private.fail('VALIDATION'); end if;
    if jsonb_array_length(p->'images') not between 1 and 200 then return private.fail('VALIDATION'); end if;
    for a in select value from jsonb_array_elements(p->'images') loop
      if jsonb_typeof(a) is distinct from 'object' or a-array['id','dataUrl','width','height']<>'{}'::jsonb or
        not(a ?& array['id','dataUrl','width','height']) or jsonb_typeof(a->'id') is distinct from 'string' or
        (a->>'id') !~ '^img[1-9][0-9]{0,2} from jsonb_array_elements(p->'questions') loop
    if jsonb_typeof(q)<>'object' or q-(case when p->'schemaVersion' in ('2'::jsonb,'3'::jsonb) then array['id','prompt','displayAnswer','reading','romajiHint','image'] else array['id','prompt','displayAnswer','reading','romajiHint'] end)<>'{}'::jsonb or
      jsonb_typeof(q->'id') is distinct from 'string' or not ((q->>'id') ~ '^[A-Za-z0-9_-]{1,128}$') or q->>'id'=any(ids)
      then return private.fail('VALIDATION'); end if;
    if q ? 'image' then
      img:=q->'image';
      if is_pool then
        if jsonb_typeof(img) is distinct from 'object' or img-array['imageId','placement','alt']<>'{}'::jsonb or
          not(img ?& array['imageId','placement','alt']) or jsonb_typeof(img->'imageId') is distinct from 'string' or
          not(img->>'imageId'=any(image_ids)) or jsonb_typeof(img->'placement') is distinct from 'string' or
          (img->>'placement') not in ('top','bottom','left','right') or jsonb_typeof(img->'alt') is distinct from 'string' then return private.fail('VALIDATION'); end if;
        if char_length(img->>'alt')>200 or
          (select coalesce(sum(case when ascii(substr(img->>'alt',n,1))>65535 then 2 else 1 end),0)
           from generate_series(1,char_length(img->>'alt')) n)>200 then return private.fail('VALIDATION'); end if;
        used_ids:=array_append(used_ids,img->>'imageId');
      elsif not private.validate_question_image(img) then return private.fail('VALIDATION'); end if;
    end if;
    ids:=array_append(ids,q->>'id');
    foreach field in array array['prompt','displayAnswer','reading','romajiHint'] loop
      if jsonb_typeof(q->field) is distinct from 'string' then return private.fail('VALIDATION'); end if;
      max_chars:=case field when 'prompt' then 1000 when 'romajiHint' then 800 else 200 end;
      if char_length(q->>field)>max_chars then return private.fail('LIMIT'); end if;
      if mode='publish' and field<>'romajiHint' and not private.nonblank(q->>field) then return private.fail('VALIDATION'); end if;
    end loop;
  end loop;
  if is_pool and not(image_ids <@ used_ids) then return private.fail('VALIDATION'); end if;
  text_only:=jsonb_set(p-'images','{questions}',coalesce((select jsonb_agg(qvalue-'image' order by n) from jsonb_array_elements(p->'questions') with ordinality e(qvalue,n)),'[]'::jsonb));
  if octet_length(private.project_text(text_only))>262144 or
    octet_length(private.project_text(p))>(case when p->'schemaVersion' in ('2'::jsonb,'3'::jsonb) then 2097152 else 262144 end) then return private.fail('LIMIT'); end if;
  return private.success(p);
exception when others then return private.fail('VALIDATION');
end;
$$;

 then return private.fail('VALIDATION'); end if;
      if substring(a->>'id' from 4)::int>200 or a->>'id'=any(image_ids) or a->>'dataUrl'=any(image_sources) then return private.fail('VALIDATION'); end if;
      if not private.validate_question_image((a-'id')||'{"placement":"top","alt":""}'::jsonb) then return private.fail('VALIDATION'); end if;
      image_ids:=array_append(image_ids,a->>'id'); image_sources:=array_append(image_sources,a->>'dataUrl');
    end loop;
  end if;
  for q in select value from jsonb_array_elements(p->'questions') loop
    if jsonb_typeof(q)<>'object' or q-(case when p->'schemaVersion'='2'::jsonb then array['id','prompt','displayAnswer','reading','romajiHint','image'] else array['id','prompt','displayAnswer','reading','romajiHint'] end)<>'{}'::jsonb or
      jsonb_typeof(q->'id') is distinct from 'string' or not ((q->>'id') ~ '^[A-Za-z0-9_-]{1,128}$') or q->>'id'=any(ids)
      then return private.fail('VALIDATION'); end if;
    if q ? 'image' and not private.validate_question_image(q->'image') then return private.fail('VALIDATION'); end if;
    ids:=array_append(ids,q->>'id');
    foreach field in array array['prompt','displayAnswer','reading','romajiHint'] loop
      if jsonb_typeof(q->field) is distinct from 'string' then return private.fail('VALIDATION'); end if;
      max_chars:=case field when 'prompt' then 1000 when 'romajiHint' then 800 else 200 end;
      if char_length(q->>field)>max_chars then return private.fail('LIMIT'); end if;
      if mode='publish' and field<>'romajiHint' and not private.nonblank(q->>field) then return private.fail('VALIDATION'); end if;
    end loop;
  end loop;
  text_only:=jsonb_set(p,'{questions}',coalesce((select jsonb_agg(qvalue-'image' order by n) from jsonb_array_elements(p->'questions') with ordinality e(qvalue,n)),'[]'::jsonb));
  if octet_length(private.project_text(text_only))>262144 or
    octet_length(private.project_text(p))>(case when p->'schemaVersion'='2'::jsonb then 2097152 else 262144 end) then return private.fail('LIMIT'); end if;
  return private.success(p);
exception when others then return private.fail('VALIDATION');
end;
$$;

create or replace function private.apply_mutation(owner uuid,command text,args jsonb) returns jsonb language plpgsql set search_path='' as $$
declare g private.games; p private.publications; l private.plan_limits; c private.service_control;
  game_id uuid; expected int; checked jsonb; publication_count int; new_share text; attempts int=0; selected_runtime text;
begin
  if command is null or command not in ('save','publish','unpublish','republish','delete') or jsonb_typeof(args)<>'object' then return private.fail('VALIDATION'); end if;
  if args - (case when command='save' then array['gameId','expectedVersion','requestId','projectText'] else array['gameId','expectedVersion','requestId'] end) <> '{}'::jsonb then return private.fail('VALIDATION'); end if;
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
    if (checked->'data'->'schemaVersion' in ('2'::jsonb,'3'::jsonb) and not c.question_images_enabled) or
      (checked->'data'->'schemaVersion'='3'::jsonb and not c.shared_question_images_enabled) then return private.fail('SERVICE_UNAVAILABLE'); end if;
    if octet_length(private.project_text(checked->'data'))>l.project_bytes then return private.fail('LIMIT'); end if;
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
    if ((command='publish' and g.project->'schemaVersion' in ('2'::jsonb,'3'::jsonb) or
        command='republish' and p.snapshot->'schemaVersion' in ('2'::jsonb,'3'::jsonb)) and not c.question_images_enabled) or
       ((command='publish' and g.project->'schemaVersion'='3'::jsonb or
        command='republish' and p.snapshot->'schemaVersion'='3'::jsonb) and not c.shared_question_images_enabled) then return private.fail('SERVICE_UNAVAILABLE'); end if;
    if command='publish' then
      selected_runtime:=case when g.project->'schemaVersion'='3'::jsonb then 'fusuma-3' when g.project->'schemaVersion'='2'::jsonb then 'fusuma-2' else 'fusuma-1' end;
      checked:=private.validate_project(private.project_text(g.project),'publish');
      if checked->>'ok'<>'true' then return checked; end if;
      if p.game_id is null then
        loop
          new_share:=translate(rtrim(encode(extensions.gen_random_bytes(16),'base64'),'='),'+/','-_');
          begin
            insert into private.publications values(g.id,new_share,g.project,'published',1,g.version,selected_runtime);
            exit;
          exception when unique_violation then
            attempts:=attempts+1;
            if attempts>=3 then raise; end if;
          end;
        end loop;
      else
        update private.publications set snapshot=g.project,status='published',version=version+1,source_version=g.version,runtime_version=selected_runtime where private.publications.game_id=g.id;
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

create or replace function public.creator_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.accounts; l private.plan_limits; c private.service_control;
begin
  a:=private.account();
  if a.owner_id is null then return private.fail('UNAUTHENTICATED'); end if;
  if a.status<>'active' then return private.fail('FORBIDDEN'); end if;
  select * into l from private.plan_limits where plan=a.plan;
  select * into c from private.service_control where id;
  return private.success(jsonb_build_object('ownerId',a.owner_id,'status',a.status,'plan',a.plan,
    'limits',jsonb_build_object('games',l.games,'publications',l.publications,'questions',l.questions,'bytes',262144,'imageProjectBytes',l.project_bytes),
    'counts',jsonb_build_object('games',(select count(*) from private.games where owner_id=a.owner_id),
      'publications',(select count(*) from private.publications p join private.games g on g.id=p.game_id where g.owner_id=a.owner_id and p.status='published')),
    'capabilities',jsonb_build_object('save',c.save_enabled,'publish',c.publish_enabled,'questionImages',c.question_images_enabled,'sharedImages',c.shared_question_images_enabled)));
end;
$$;

-- Existing RPC ACLs and security-definer ownership are preserved by CREATE OR REPLACE.
commit;


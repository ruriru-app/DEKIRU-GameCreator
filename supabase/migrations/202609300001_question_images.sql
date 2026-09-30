-- Additive rollout: readers support both formats before image writes are enabled.
begin;
alter table private.service_control add column question_images_enabled boolean not null default false;
update private.plan_limits set project_bytes=2097152 where plan='free';
alter table private.publications drop constraint publications_runtime_version_check;
alter table private.publications add constraint publications_runtime_version_check check (runtime_version in ('fusuma-1','fusuma-2'));

-- Bounded big-endian header reads. Pixel decoding is performed by the browser.
create function private.image_uint(b bytea, at_pos int, byte_count int) returns bigint
language plpgsql immutable set search_path='' as $$
declare result bigint=0; i int;
begin
  for i in 0..byte_count-1 loop result:=result*256+get_byte(b,at_pos+i); end loop;
  return result;
end;
$$;
create function private.validate_question_image(img jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare source text; encoded text; mime text; b bytea; size int; w int; h int; pos int; ending int; len bigint;
  marker int; kind text; has_data boolean=false; scan boolean=false; has_scan boolean=false;
  crc bigint; crc_table bigint[]='{}'; v bigint; i int; j int; depth int; color_type int;
begin
  if jsonb_typeof(img) is distinct from 'object' or
    img-array['dataUrl','width','height','placement','alt']<>'{}'::jsonb or
    not(img ?& array['dataUrl','width','height','placement','alt']) or
    jsonb_typeof(img->'dataUrl') is distinct from 'string' or
    jsonb_typeof(img->'width') is distinct from 'number' or jsonb_typeof(img->'height') is distinct from 'number' or
    jsonb_typeof(img->'placement') is distinct from 'string' or
    (img->>'placement') not in ('top','bottom','left','right') or
    jsonb_typeof(img->'alt') is distinct from 'string' then return false; end if;
  if (img->>'width')::numeric not between 1 and 1280 or (img->>'height')::numeric not between 1 and 1280 or
    trunc((img->>'width')::numeric)<>(img->>'width')::numeric or trunc((img->>'height')::numeric)<>(img->>'height')::numeric then return false; end if;
  if char_length(img->>'alt')>200 then return false; end if;
  -- JS maxlength counts supplementary codepoints as two UTF16 units.
  if (select coalesce(sum(case when ascii(substr(img->>'alt',n,1))>65535 then 2 else 1 end),0)
      from generate_series(1,char_length(img->>'alt')) n)>200 then return false; end if;
  source:=img->>'dataUrl';
  if length(source)>175000 or source !~ '^data:image/(jpeg|png);base64,([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then return false; end if;
  mime:=split_part(split_part(source,';',1),':',2); encoded:=split_part(source,',',2);
  b:=decode(encoded,'base64');size:=octet_length(b);
  if size<12 or size>131072 or replace(encode(b,'base64'),E'\n','')<>encoded then return false; end if;
  if mime='image/png' then
    if substring(b from 1 for 8)<>decode('89504e470d0a1a0a','hex') then return false; end if;
    for i in 0..255 loop
      v:=i;
      for j in 0..7 loop v:=case when (v & 1)=1 then 3988292384 # (v >> 1) else v >> 1 end; end loop;
      crc_table:=array_append(crc_table,v);
    end loop;
    pos:=8;
    while pos+12<=size loop
      len:=private.image_uint(b,pos,4);
      if pos+12+len>size then return false; end if;
      ending:=pos+12+len;kind:=encode(substring(b from pos+5 for 4),'hex');
      crc:=4294967295;
      for i in pos+4..ending-5 loop crc:=crc_table[((crc # get_byte(b,i)) & 255)::int+1] # (crc >> 8); end loop;
      if (crc # 4294967295)<>private.image_uint(b,ending-4,4) then return false; end if;
      if pos=8 and (kind<>'49484452' or len<>13) then return false; end if;
      if kind='49484452' then
        if pos<>8 then return false; end if;
        if private.image_uint(b,pos+8,4)>1280 or private.image_uint(b,pos+12,4)>1280 then return false; end if;
        w:=private.image_uint(b,pos+8,4);h:=private.image_uint(b,pos+12,4);
        depth:=get_byte(b,pos+16);color_type:=get_byte(b,pos+17);
        if not(case color_type when 0 then depth in (1,2,4,8,16) when 2 then depth in (8,16)
          when 3 then depth in (1,2,4,8) when 4 then depth in (8,16) when 6 then depth in (8,16) else false end)
          or get_byte(b,pos+18)<>0 or get_byte(b,pos+19)<>0 or get_byte(b,pos+20)>1 then return false; end if;
      end if;
      if kind='49444154' and len>0 then has_data:=true; end if;
      if kind='49454e44' then
        return coalesce(len=0 and ending=size and has_data and w=(img->>'width')::numeric and h=(img->>'height')::numeric,false);
      end if;
      pos:=ending;
    end loop;
    return false;
  elsif mime='image/jpeg' then
    if get_byte(b,0)<>255 or get_byte(b,1)<>216 then return false; end if;
    pos:=2;
    while pos<size loop
      if scan then
        while pos<size loop exit when get_byte(b,pos)=255; pos:=pos+1; end loop;
        if pos>=size then return false; end if;
      end if;
      if get_byte(b,pos)<>255 then return false; end if;pos:=pos+1;
      while pos<size loop exit when get_byte(b,pos)<>255;pos:=pos+1;end loop;
      if pos>=size then return false; end if;
      marker:=get_byte(b,pos);pos:=pos+1;
      if scan and (marker=0 or marker between 208 and 215) then continue; end if;
      scan:=false;
      if marker=217 then return coalesce(pos=size and has_scan and w=(img->>'width')::numeric and h=(img->>'height')::numeric,false); end if;
      if marker in (0,1,216) or marker between 208 and 215 or pos+2>size then return false; end if;
      len:=private.image_uint(b,pos,2);ending:=pos+len;
      if len<2 or ending>size then return false; end if;
      if marker in (192,193,194) then
        if w is not null or len<8 then return false; end if;
        if len<>8+3*get_byte(b,pos+7) or get_byte(b,pos+2)<>8 then return false; end if;
        h:=private.image_uint(b,pos+3,2);w:=private.image_uint(b,pos+5,2);
      end if;
      if marker=218 then
        if w is null or len<6 then return false; end if;
        if len<>6+2*get_byte(b,pos+2) then return false; end if;
        scan:=true;has_scan:=true;
      end if;
      pos:=ending;
    end loop;
  end if;
  return false;
exception when others then return false;
end;
$$;

create or replace function private.project_text(p jsonb) returns text language sql immutable set search_path='' as $$
  select '{"schemaVersion":'||case when p->'schemaVersion'='2'::jsonb then '2' else '1' end||',"title":'||to_json(p->>'title')::text||',"gameType":"typing","templateId":"fusuma","settings":{"volume":'||
    private.number_text((p->'settings'->>'volume')::double precision)||',"muted":'||(p->'settings'->>'muted')||
    '},"questions":['||coalesce((select string_agg(
      '{"id":'||to_json(q->>'id')::text||',"prompt":'||to_json(q->>'prompt')::text||
      ',"displayAnswer":'||to_json(q->>'displayAnswer')::text||',"reading":'||to_json(q->>'reading')::text||
      ',"romajiHint":'||to_json(q->>'romajiHint')::text||
      case when q ? 'image' then ',"image":{"dataUrl":'||to_json(q->'image'->>'dataUrl')::text||
      ',"width":'||((q->'image'->>'width')::numeric::int)::text||',"height":'||((q->'image'->>'height')::numeric::int)::text||
      ',"placement":'||to_json(q->'image'->>'placement')::text||',"alt":'||to_json(q->'image'->>'alt')::text||'}' else '' end||'}',',' order by n)
      from jsonb_array_elements(p->'questions') with ordinality as e(q,n)),'')||']}';
$$;

create or replace function private.validate_project(project_text text, mode text) returns jsonb language plpgsql immutable set search_path='' as $$
declare p jsonb; q jsonb; field text; ids text[]='{}'; max_chars int; text_only jsonb;
begin
  if mode not in ('draft','publish') or mode is null or project_text is null then return private.fail('VALIDATION'); end if;
  if octet_length(project_text)>4194304 then return private.fail('LIMIT'); end if;
  p:=project_text::jsonb;
  if jsonb_typeof(p)<>'object' or p- array['schemaVersion','title','gameType','templateId','settings','questions']<>'{}'::jsonb or
    (p->'schemaVersion' is null or p->'schemaVersion' not in ('1'::jsonb,'2'::jsonb)) or p->>'gameType' is distinct from 'typing' or p->>'templateId' is distinct from 'fusuma' or
    jsonb_typeof(p->'title') is distinct from 'string' or jsonb_typeof(p->'questions') is distinct from 'array' or
    jsonb_typeof(p->'settings') is distinct from 'object' then return private.fail('VALIDATION'); end if;
  if (p->'settings')-array['volume','muted']<>'{}'::jsonb or jsonb_typeof(p->'settings'->'muted') is distinct from 'boolean' or
    jsonb_typeof(p->'settings'->'volume') is distinct from 'number' then return private.fail('VALIDATION'); end if;
  if (p->'settings'->>'volume')::numeric<0 or (p->'settings'->>'volume')::numeric>1 then return private.fail('VALIDATION'); end if;
  if char_length(p->>'title')>80 or jsonb_array_length(p->'questions')>200 then return private.fail('LIMIT'); end if;
  if mode='publish' and (not private.nonblank(p->>'title') or jsonb_array_length(p->'questions')=0) then return private.fail('VALIDATION'); end if;
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
    octet_length(private.project_text(p))>case when p->'schemaVersion'='2'::jsonb then 2097152 else 262144 end then return private.fail('LIMIT'); end if;
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
    if checked->'data'->'schemaVersion'='2'::jsonb and not c.question_images_enabled then return private.fail('SERVICE_UNAVAILABLE'); end if;
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
    if (command='publish' and g.project->'schemaVersion'='2'::jsonb or
        command='republish' and p.snapshot->'schemaVersion'='2'::jsonb) and not c.question_images_enabled then return private.fail('SERVICE_UNAVAILABLE'); end if;
    if command='publish' then
      selected_runtime:=case when g.project->'schemaVersion'='2'::jsonb then 'fusuma-2' else 'fusuma-1' end;
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
    'capabilities',jsonb_build_object('save',c.save_enabled,'publish',c.publish_enabled,'questionImages',c.question_images_enabled)));
end;
$$;
-- Existing owner RPC privileges remain unchanged; new private helpers are never exposed.
revoke all on function private.image_uint(bytea,int,int),private.validate_question_image(jsonb) from public,anon,authenticated;
commit;

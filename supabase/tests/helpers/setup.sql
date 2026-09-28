create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
create function pg_temp.project(n int default 1) returns jsonb language sql as $$
  select jsonb_build_object('schemaVersion',1,'title','教材','gameType','typing','templateId','fusuma',
    'settings',jsonb_build_object('volume',0.6,'muted',false),
    'questions',coalesce((select jsonb_agg(jsonb_build_object('id','q-'||i,'prompt','問題','displayAnswer','正解','reading','せいかい','romajiHint','') order by i) from generate_series(1,n) i),'[]'::jsonb));
$$;
create function pg_temp.args(game_id uuid default null, version int default 0, project jsonb default pg_temp.project()) returns jsonb language sql as $$
  select jsonb_build_object('gameId',game_id,'expectedVersion',version,'requestId',gen_random_uuid(),'projectText',project::text);
$$;
create function pg_temp.command(game_id uuid, version int) returns jsonb language sql as $$
  select jsonb_build_object('gameId',game_id,'expectedVersion',version,'requestId',gen_random_uuid());
$$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

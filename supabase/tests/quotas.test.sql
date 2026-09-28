begin;
\ir helpers/setup.sql
select public.creator_context();
-- Test fixture inserts are admin-only; production callers have no table grants.
insert into private.games(id,owner_id,project,version)
select gen_random_uuid(),'10000000-0000-4000-8000-000000000001',pg_temp.project(),1 from generate_series(1,19);
select is(public.mutate_game('save',pg_temp.args())->>'ok','true','20th game succeeds');
select is(public.mutate_game('save',pg_temp.args())->'error'->>'code','LIMIT','21st game rejected');
select is((select count(*)::int from private.games),20,'quota failure preserves count');
create temp table ten as select id,row_number() over() as n from private.games limit 11;
insert into private.publications(game_id,share_id,snapshot,status,version,source_version,runtime_version)
select id,lpad(n::text,22,'A'),pg_temp.project(),'published',1,1,'fusuma-1' from ten where n<=9;
select is(public.mutate_game('publish',pg_temp.command((select id from ten where n=10),1))->>'ok','true','10th publication succeeds');
select is(public.mutate_game('publish',pg_temp.command((select id from ten where n=11),1))->'error'->>'code','LIMIT','11th publication rejected');
update private.accounts set minute_started=date_trunc('minute',clock_timestamp()),minute_count=19,day_started=(clock_timestamp() at time zone 'UTC')::date,day_count=0;
select is(public.mutate_game('delete',pg_temp.command((select id from ten where n=11),1))->>'ok','true','20th mutation succeeds');
select is(public.mutate_game('save',pg_temp.args())->'error'->>'code','RATE_LIMIT','21st mutation in minute rejected');
update private.accounts set minute_count=0,day_count=499;
select is(public.mutate_game('save',pg_temp.args())->>'ok','true','500th daily mutation succeeds');
select is(public.mutate_game('save',pg_temp.args())->'error'->>'code','RATE_LIMIT','501st daily mutation rejected');
update private.accounts set minute_count=0,day_count=0;
select is(public.mutate_game('save',pg_temp.args(null,0,pg_temp.project()||'{"unknown":"bad"}'))->'error'->>'code','VALIDATION','invalid data rejected');
select is((select day_count from private.accounts where owner_id='10000000-0000-4000-8000-000000000001'),1,'invalid attempt still counted');
select * from finish();
rollback;

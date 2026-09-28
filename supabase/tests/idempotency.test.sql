begin;
\ir helpers/setup.inc
create temp table retry as select pg_temp.args() as args;
create temp table saved as select public.mutate_game('save',args) as result from retry;
select is(public.mutate_game('save',(select args from retry)),(select result from saved),'response-lost retry returns exact same result');
select is((select count(*)::int from private.games),1,'retry did not duplicate game');
select is(public.mutate_game('save',(select args||jsonb_build_object('projectText',(pg_temp.project()||'{"title":"different"}')::text) from retry))->'error'->>'code','REQUEST_MISMATCH','same requestId with different data rejected');
select is((select count(*)::int from private.games),1,'mismatch cannot duplicate game');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select is(public.mutate_game('save',(select args from retry))->>'ok','true','request IDs are owner scoped');
select is((select count(*)::int from private.games),2,'different owner has their own game');
update private.accounts set status='disabled' where owner_id='10000000-0000-4000-8000-000000000002';
select is(public.mutate_game('save',pg_temp.args())->'error'->>'code','FORBIDDEN','disabled owner cannot save');
select is(public.list_games()->'error'->>'code','FORBIDDEN','disabled owner cannot list');
select * from finish();
rollback;

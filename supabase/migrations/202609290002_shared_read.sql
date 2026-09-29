-- Server-only anonymous snapshot access. Browser roles have no direct access.
create table private.read_limits (
  client_hash text primary key check (client_hash ~ '^[a-f0-9]{64}$'),
  minute_started timestamptz not null,
  read_count int not null check (read_count between 1 and 601),
  created_at timestamptz not null default clock_timestamp()
);
create index on private.read_limits(created_at);
alter table private.read_limits enable row level security;
revoke all on private.read_limits from public,anon,authenticated;

create function public.read_shared_game(p_share_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('schemaVersion',1,'project',p.snapshot,
    'runtimeVersion',p.runtime_version,'publicationVersion',p.version)
  from private.publications p
  join private.games g on g.id=p.game_id
  join private.accounts a on a.owner_id=g.owner_id
  cross join private.service_control c
  where p_share_id ~ '^[A-Za-z0-9_-]{22}$' and p.share_id=p_share_id
    and p.status='published' and a.status='active' and c.id and c.public_read_enabled;
$$;

create function public.consume_shared_read(p_client_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_now timestamptz=clock_timestamp(); v_minute timestamptz; v_count int;
begin
  if p_client_hash is null or p_client_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('allowed',false,'retry_after_seconds',60);
  end if;
  v_minute:=date_trunc('minute',v_now);
  insert into private.read_limits as r(client_hash,minute_started,read_count)
    values(p_client_hash,v_minute,1)
  on conflict(client_hash) do update set
    minute_started=v_minute,
    read_count=case when r.minute_started=v_minute then least(r.read_count+1,601) else 1 end
  returning read_count into v_count;
  return jsonb_build_object('allowed',v_count<=600,'retry_after_seconds',
    case when v_count<=600 then 0 else greatest(1,ceil(extract(epoch from v_minute+interval '1 minute'-v_now))::int) end);
end;
$$;

create or replace function private.purge_expired_cloud_records() returns void
language sql security definer set search_path='' as $$
  delete from private.requests where expires_at<=clock_timestamp();
  delete from private.read_limits where created_at<=clock_timestamp()-interval '23 hours';
$$;
revoke all on function public.read_shared_game(text),public.consume_shared_read(text) from public,anon,authenticated;
grant execute on function public.read_shared_game(text),public.consume_shared_read(text) to service_role;
revoke all on function private.purge_expired_cloud_records() from public,anon,authenticated;
-- Hourly scheduling and its retention check are explicit deployment gates.

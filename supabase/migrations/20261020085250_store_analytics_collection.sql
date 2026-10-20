-- First-party, optional store measurement. Disabled until a reviewed activation.
-- No IP, user agent, URL/query, search terms or profile identifier is stored.
create table private.store_analytics_settings (
 id boolean primary key default true check(id), enabled boolean not null default false,
 notice_version text not null default 'analytics-v1' check(notice_version='analytics-v1'),
 activated_at timestamptz, revision integer not null default 1
);
insert into private.store_analytics_settings(id) values(true);
create table private.store_analytics_windows (
 id bigint generated always as identity primary key, started_at timestamptz not null, ended_at timestamptz,
 check(ended_at is null or ended_at>=started_at)
);
create unique index store_analytics_one_open_window on private.store_analytics_windows((true)) where ended_at is null;
create table private.store_analytics_health (
 minute timestamptz primary key, observed_at timestamptz not null
);
create table private.store_analytics_sessions (
 id uuid primary key default gen_random_uuid(), token_hash text not null unique check(token_hash~'^[0-9a-f]{64}$'),
 notice_version text not null check(notice_version='analytics-v1'), created_at timestamptz not null,
 last_seen_at timestamptz not null, revoked_at timestamptz, event_count integer not null default 0 check(event_count between 0 and 2000),
 channel text not null default 'direct' check(channel in ('direct','search','social','email','paid','referral','internal')),
 source text not null default 'none' check(source in ('none','google','naver','bing','daum','instagram','facebook','youtube','kakao','x','threads','email','other','icons')),
 medium text not null default 'none' check(medium in ('none','organic','social','email','cpc','paid_social','referral','internal')),
 last_link_id uuid references private.marketing_links(id) on delete set null,
 last_page_kind text, last_page_target text
);
create index store_analytics_sessions_age on private.store_analytics_sessions(created_at);
create table private.store_analytics_events (
 id uuid primary key, session_id uuid not null references private.store_analytics_sessions(id) on delete cascade,
 observed_at timestamptz not null, page_kind text not null check(page_kind in ('home','shop','good','stories','story','ip','events','event')),
 target_id text not null check(length(target_id) between 1 and 200),
 ip_id text, category_id uuid,
 channel text not null, source text not null, medium text not null,
 link_id uuid references private.marketing_links(id) on delete set null,
 landing_link_id uuid references private.marketing_links(id) on delete set null,
 payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$')
);
create index store_analytics_events_session_time on private.store_analytics_events(session_id,observed_at);
create index store_analytics_events_time on private.store_analytics_events(observed_at);
create table private.store_analytics_order_bindings (
 order_id uuid primary key references public.orders(id) on delete cascade,
 session_id uuid not null references private.store_analytics_sessions(id) on delete cascade,
 bound_at timestamptz not null, channel text not null, source text not null, medium text not null,
 link_id uuid references private.marketing_links(id) on delete set null,
 page_kind text not null, page_target text not null
);
create index store_analytics_bindings_session on private.store_analytics_order_bindings(session_id);
create table private.store_analytics_rate_buckets (
 bucket timestamptz not null, scope text not null, requests integer not null check(requests>0), primary key(bucket,scope)
);
create table private.store_analytics_daily (
 day date not null, dimension text not null check(dimension in ('total','channel','page','good','ip','category','link')),
 key text not null, page_views bigint not null, product_views bigint not null, sessions bigint not null,
 link_landings bigint not null, orders bigint not null, converted_sessions bigint not null,
 gross_amount bigint, refund_amount bigint, observed_until timestamptz not null,
 primary key(day,dimension,key)
);
create table private.store_analytics_daily_coverage (
 day date primary key, state text not null check(state in ('observed','partial','unmeasured','paused')),
 expected_minutes integer not null, observed_minutes integer not null, observed_until timestamptz not null
);
do $$declare name text;begin
 foreach name in array array['settings','windows','health','sessions','events','order_bindings','rate_buckets','daily','daily_coverage'] loop
  execute format('alter table private.store_analytics_%I enable row level security',name);
  execute format('revoke all on private.store_analytics_%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;

create function private.store_analytics_require_service() returns void
language plpgsql volatile security invoker set search_path='' as $$begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege using message='service_role_required';end if;
end $$;
revoke all on function private.store_analytics_require_service() from public,anon,authenticated,service_role;

create function private.store_analytics_rate(p_scope text,p_limit integer,p_at timestamptz) returns void
language plpgsql volatile security invoker set search_path='' as $$declare used integer;begin
 insert into private.store_analytics_rate_buckets(bucket,scope,requests) values(date_trunc('minute',p_at),p_scope,1)
 on conflict(bucket,scope) do update set requests=store_analytics_rate_buckets.requests+1 returning requests into used;
 if used>p_limit then raise exception using errcode='P0429',message='analytics_rate_limited';end if;
end $$;
revoke all on function private.store_analytics_rate(text,integer,timestamptz) from public,anon,authenticated,service_role;

create function public.get_store_analytics_state() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'noticeVersion',notice_version) from private.store_analytics_settings where id;
$$;
revoke all on function public.get_store_analytics_state() from public,anon,authenticated,service_role;
grant execute on function public.get_store_analytics_state() to anon,authenticated,service_role;

-- Operational activation is separate from deployment and never accepts a date
-- supplied by the caller. No customer traffic is backfilled on activation.
create function public.set_store_analytics_collection(p_enabled boolean,p_notice_version text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare at_time timestamptz; current private.store_analytics_settings;
begin
 perform private.store_analytics_require_service();
 if p_enabled is null or p_notice_version is distinct from 'analytics-v1' then raise invalid_parameter_value using message='analytics_invalid_activation';end if;
 select * into current from private.store_analytics_settings where id for update;
 at_time:=clock_timestamp();
 if current.enabled is distinct from p_enabled then
  update private.store_analytics_settings set enabled=p_enabled,revision=revision+1,
   activated_at=case when p_enabled then coalesce(activated_at,at_time) else activated_at end where id;
  if p_enabled then insert into private.store_analytics_windows(started_at) values(at_time);
  else update private.store_analytics_windows set ended_at=at_time where ended_at is null;end if;
 end if;
 return public.get_store_analytics_state();
end $$;
revoke all on function public.set_store_analytics_collection(boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.set_store_analytics_collection(boolean,text) to service_role;

create function public.start_store_analytics_session(p_token_hash text,p_notice_version text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare at_time timestamptz;
begin
 perform private.store_analytics_require_service();
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_notice_version is distinct from 'analytics-v1' then
  raise invalid_parameter_value using message='analytics_invalid_session';end if;
 perform 1 from private.store_analytics_settings where id and enabled for share;
 if not found then raise object_not_in_prerequisite_state using message='analytics_disabled';end if;
 at_time:=clock_timestamp();
 perform private.store_analytics_rate('session-start',1000,at_time);
 insert into private.store_analytics_sessions(token_hash,notice_version,created_at,last_seen_at)
 values(p_token_hash,p_notice_version,at_time,at_time);
 return jsonb_build_object('startedAt',at_time);
end $$;
revoke all on function public.start_store_analytics_session(text,text) from public,anon,authenticated,service_role;
grant execute on function public.start_store_analytics_session(text,text) to service_role;

create function public.store_analytics_session_status(p_token_hash text) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when auth.role()='service_role' then coalesce((select jsonb_build_object('usable',s.revoked_at is null
  and statement_timestamp()<s.last_seen_at+interval '30 minutes' and statement_timestamp()<s.created_at+interval '24 hours'
  and(statement_timestamp() at time zone 'Asia/Seoul')::date=(s.created_at at time zone 'Asia/Seoul')::date)
  from private.store_analytics_sessions s where s.token_hash=p_token_hash),'{"usable":false}'::jsonb) else null end;
$$;
revoke all on function public.store_analytics_session_status(text) from public,anon,authenticated,service_role;
grant execute on function public.store_analytics_session_status(text) to service_role;

create function public.revoke_store_analytics_session(p_token_hash text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare session private.store_analytics_sessions;
begin
 perform private.store_analytics_require_service();
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then raise invalid_parameter_value using message='analytics_invalid_session';end if;
 select * into session from private.store_analytics_sessions where token_hash=p_token_hash for update;
 if not found then return;end if;
 -- Delete the entire observed session, including its last target and token hash.
 -- Missing tokens are rejected exactly like revoked tokens; no tombstone is needed.
 delete from private.store_analytics_rate_buckets where scope='session:'||session.id::text;
 delete from private.store_analytics_sessions where id=session.id;
end $$;
revoke all on function public.revoke_store_analytics_session(text) from public,anon,authenticated,service_role;
grant execute on function public.revoke_store_analytics_session(text) to service_role;

create function private.store_analytics_page(p_kind text,p_target text,p_at timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare result jsonb;
begin
 if p_kind='home' and p_target='home' or p_kind='shop' and p_target in ('all','new','best')
  or p_kind='stories' and p_target='all' or p_kind='events' and p_target='all' then return '{}';end if;
 if p_kind='shop' and p_target~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists(select 1 from public.get_catalog_categories() where id=p_target::uuid) then return jsonb_build_object('categoryId',p_target);end if;
 if p_kind='good' then
  select jsonb_build_object('ipId',g.ip_id,'categoryId',g.category_id) into result
  from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=p_target and g.published_at is not null and g.archived_at is null
   and g.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null;
 elsif p_kind='ip' then
  select jsonb_build_object('ipId',id) into result from public.ips where public_slug=p_target and published_at is not null and archived_at is null;
 elsif p_kind='story' and p_target~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select '{}'::jsonb into result from public.shopping_stories where id=p_target::uuid and deleted_at is null
   and(starts_at is null or starts_at<=p_at) and(ends_at is null or ends_at>p_at);
 elsif p_kind='event' then
  select jsonb_build_object('ipId',e.ip_id) into result from public.events e join public.ips ip on ip.id=e.ip_id
   where e.id=p_target and e.archived_at is null and ip.published_at is not null and ip.archived_at is null;
 end if;
 return result;
end $$;
revoke all on function private.store_analytics_page(text,text,timestamptz) from public,anon,authenticated,service_role;

create function public.record_store_analytics_event(p_token_hash text,p_event_id uuid,p_page_kind text,p_target_id text,
 p_channel text,p_source text,p_medium text,p_link_token text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare session private.store_analytics_sessions; existing private.store_analytics_events; target jsonb; linked private.marketing_links;
 at_time timestamptz; fingerprint text; landing uuid;
begin
 perform private.store_analytics_require_service();
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_event_id is null
  or p_page_kind is null or p_page_kind not in ('home','shop','good','stories','story','ip','events','event')
  or p_target_id is null or length(p_target_id) not between 1 and 200 or p_target_id~'[[:cntrl:]]'
  or p_channel is null or p_channel not in ('direct','search','social','email','paid','referral','internal')
  or p_source is null or p_source not in ('none','google','naver','bing','daum','instagram','facebook','youtube','kakao','x','threads','email','other','icons')
  or p_medium is null or p_medium not in ('none','organic','social','email','cpc','paid_social','referral','internal')
  or(p_link_token is not null and p_link_token!~'^[0-9a-f]{32}$') then raise invalid_parameter_value using message='analytics_invalid_event';end if;
 perform 1 from private.store_analytics_settings where id and enabled for share;
 if not found then raise object_not_in_prerequisite_state using message='analytics_disabled';end if;
 select * into session from private.store_analytics_sessions where token_hash=p_token_hash for update;
 at_time:=clock_timestamp();
 if not found or session.revoked_at is not null then raise invalid_authorization_specification using message='analytics_session_unavailable';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_array(p_page_kind,p_target_id,p_channel,p_source,p_medium,p_link_token)::text,'sha256'),'hex');
 select * into existing from private.store_analytics_events where id=p_event_id;
 if found then
  if existing.session_id<>session.id or existing.payload_hash<>fingerprint then raise exception using errcode='PT409',message='analytics_event_conflict';end if;
  return jsonb_build_object('recorded',true,'replayed',true);
 end if;
 if at_time>=session.last_seen_at+interval '30 minutes' or at_time>=session.created_at+interval '24 hours'
  or (at_time at time zone 'Asia/Seoul')::date<>(session.created_at at time zone 'Asia/Seoul')::date then
  raise invalid_authorization_specification using message='analytics_session_expired';end if;
 if session.event_count>=2000 then raise exception using errcode='P0429',message='analytics_rate_limited';end if;
 target:=private.store_analytics_page(p_page_kind,p_target_id,at_time);
 if target is null then raise no_data_found using message='analytics_page_unavailable';end if;
 if p_link_token is not null then
  select * into linked from private.marketing_links where token=p_link_token;
  if not found or not private.marketing_link_available(linked)
   or not((linked.source='home' and p_page_kind='home') or(linked.source='good' and p_page_kind='good' and linked.good_id=p_target_id)
    or(linked.source='story' and p_page_kind='story' and linked.story_id::text=p_target_id)
    or(linked.source='category' and p_page_kind='shop' and linked.category_id::text=p_target_id)) then
   raise invalid_parameter_value using message='analytics_link_target_mismatch';end if;
  landing:=linked.id;
 end if;
 perform private.store_analytics_rate('events',10000,at_time);
 perform private.store_analytics_rate('session:'||session.id::text,120,at_time);
 -- Direct/internal navigation keeps the most recent measured acquisition.
 if session.event_count=0 or landing is not null or p_channel not in ('direct','internal') then
  session.channel:=p_channel;session.source:=p_source;session.medium:=p_medium;session.last_link_id:=landing;
 end if;
 insert into private.store_analytics_events(id,session_id,observed_at,page_kind,target_id,ip_id,category_id,channel,source,medium,link_id,landing_link_id,payload_hash)
 values(p_event_id,session.id,at_time,p_page_kind,p_target_id,target->>'ipId',(target->>'categoryId')::uuid,
  session.channel,session.source,session.medium,session.last_link_id,landing,fingerprint);
 update private.store_analytics_sessions set last_seen_at=at_time,event_count=event_count+1,
  channel=session.channel,source=session.source,medium=session.medium,last_link_id=session.last_link_id,last_page_kind=p_page_kind,last_page_target=p_target_id where id=session.id;
 insert into private.store_analytics_health(minute,observed_at) values(date_trunc('minute',at_time),at_time) on conflict(minute) do nothing;
 return jsonb_build_object('recorded',true,'replayed',false);
end $$;
revoke all on function public.record_store_analytics_event(text,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_store_analytics_event(text,uuid,text,text,text,text,text,text) to service_role;

create function public.bind_store_analytics_order(p_token_hash text,p_order_id uuid,p_user_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare session private.store_analytics_sessions; target public.orders; previous private.store_analytics_order_bindings; at_time timestamptz;
begin
 perform private.store_analytics_require_service();
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_order_id is null or p_user_id is null then
  raise invalid_parameter_value using message='analytics_invalid_binding';end if;
 -- Account -> settings -> session -> order. The service boundary supplies the
 -- authenticated actor; this argument is never accepted from a browser body.
 perform private.lock_operator_subjects(array[p_user_id]);
 if private.is_account_write_fenced(p_user_id) or not exists(select 1 from public.profiles where id=p_user_id and role='user' and suspended_at is null) then
  raise insufficient_privilege using message='analytics_order_unavailable';end if;
 perform 1 from private.store_analytics_settings where id and enabled for share;
 if not found then return false;end if;
 select * into session from private.store_analytics_sessions where token_hash=p_token_hash for update;
 at_time:=clock_timestamp();
 if not found or session.revoked_at is not null or session.event_count=0
  or at_time>=session.last_seen_at+interval '30 minutes' or at_time>=session.created_at+interval '24 hours'
  or(at_time at time zone 'Asia/Seoul')::date<>(session.created_at at time zone 'Asia/Seoul')::date then return false;end if;
 select * into target from public.orders where id=p_order_id for update;
 if not found or target.user_id<>p_user_id then raise insufficient_privilege using message='analytics_order_unavailable';end if;
 select * into previous from private.store_analytics_order_bindings where order_id=p_order_id;
 if found then
  if previous.session_id<>session.id then raise exception using errcode='PT409',message='analytics_order_binding_conflict';end if;
  return true;
 end if;
 if target.status<>'pending' or target.created_at<session.created_at or target.created_at<at_time-interval '2 minutes'
  or target.payment_method<>'card' or target.total<=0 then return false;end if;
 insert into private.store_analytics_order_bindings(order_id,session_id,bound_at,channel,source,medium,link_id,page_kind,page_target)
 values(target.id,session.id,at_time,session.channel,session.source,session.medium,session.last_link_id,session.last_page_kind,session.last_page_target);
 return true;
end $$;
revoke all on function public.bind_store_analytics_order(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.bind_store_analytics_order(text,uuid,uuid) to service_role;

-- Financial facts come only from the existing service-finalized ledger. No
-- callback, client event or guessed order timestamp can create a conversion.
create function private.store_analytics_paid_orders(p_from timestamptz,p_until timestamptz)
returns table(order_id uuid,session_id uuid,bound_at timestamptz,channel text,source text,medium text,link_id uuid,page_kind text,
 paid_at timestamptz,gross_amount bigint,refund_amount bigint)
language sql stable security invoker set search_path='' as $$
 select b.order_id,b.session_id,b.bound_at,b.channel,b.source,b.medium,b.link_id,b.page_kind,
  proof.confirmed_at,p.amount,coalesce((select sum(r.amount) from public.refunds r where r.payment_id=p.id and r.status='done'),0)::bigint
 from private.store_analytics_order_bindings b join private.store_analytics_sessions s on s.id=b.session_id and s.revoked_at is null
 join public.orders o on o.id=b.order_id
 join public.payment_attempts a on a.purpose='order' and a.ref_id=o.id and a.user_id=o.user_id and a.state in ('approved','canceled')
 join public.payments p on p.id=a.payment_id and p.purpose='order' and p.ref_id=o.id and p.user_id=o.user_id
  and p.provider=a.provider and p.amount=a.amount and p.amount=o.total and p.amount>0 and p.status in ('paid','canceled','refunded')
 join lateral(select min(coalesce(e.approved_at,e.recorded_at)) as confirmed_at from private.payment_provider_evidence e
  where e.payment_attempt_id=a.id and e.evidence_kind='confirm_approved') proof on proof.confirmed_at>=b.bound_at and proof.confirmed_at<b.bound_at+interval '7 days'
 where s.created_at>=p_from and s.created_at<p_until and a.provider in ('toss','korpay') and o.payment_method='card';
$$;
revoke all on function private.store_analytics_paid_orders(timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function private.store_analytics_raw_rows(p_day date)
returns table(dimension text,key text,page_views bigint,product_views bigint,sessions bigint,link_landings bigint,
 orders bigint,converted_sessions bigint,gross_amount bigint,refund_amount bigint)
language sql stable security invoker set search_path='' as $$
 with events as materialized(
  select e.* from private.store_analytics_events e join private.store_analytics_sessions s on s.id=e.session_id and s.revoked_at is null
  where e.observed_at>=p_day::timestamp at time zone 'Asia/Seoul' and e.observed_at<(p_day+1)::timestamp at time zone 'Asia/Seoul'),
 event_groups as (
  select d.dimension,d.key,e.session_id,count(*)::bigint views,count(*) filter(where e.page_kind='good')::bigint product_views,
   count(*) filter(where e.landing_link_id is not null)::bigint landings
  from events e cross join lateral(values
   ('total','all'),('channel',e.channel||'/'||e.source||'/'||e.medium),('page',e.page_kind),
   ('good',case when e.page_kind='good' then e.target_id end),('ip',e.ip_id),('category',e.category_id::text),('link',e.link_id::text)
  )d(dimension,key) where d.key is not null group by d.dimension,d.key,e.session_id),
 paid as materialized(select * from private.store_analytics_paid_orders(p_day::timestamp at time zone 'Asia/Seoul',(p_day+1)::timestamp at time zone 'Asia/Seoul')),
 paid_dimensions as (
  select p.*,d.dimension,d.key from paid p cross join lateral(values
   ('total','all'),('channel',p.channel||'/'||p.source||'/'||p.medium),('page',p.page_kind),('link',p.link_id::text)
  )d(dimension,key) where d.key is not null
  union all
  select p.*,d.dimension,d.key from paid p cross join lateral(
   select distinct 'good'::text dimension,e.target_id key from events e join public.order_items i on i.good_id=e.target_id and i.order_id=p.order_id
    where e.session_id=p.session_id and e.page_kind='good' and e.observed_at<=p.bound_at
   union select distinct 'ip',e.ip_id from events e join public.order_items i on i.good_id=e.target_id and i.order_id=p.order_id
    where e.session_id=p.session_id and e.page_kind='good' and e.ip_id is not null and e.observed_at<=p.bound_at
   union select distinct 'category',e.category_id::text from events e join public.order_items i on i.good_id=e.target_id and i.order_id=p.order_id
    where e.session_id=p.session_id and e.page_kind='good' and e.category_id is not null and e.observed_at<=p.bound_at
  )d),
 payment_groups as (
  select dimension,key,session_id,count(*)::bigint orders,sum(gross_amount)::bigint gross_amount,sum(refund_amount)::bigint refund_amount
  from paid_dimensions group by dimension,key,session_id)
 select e.dimension,e.key,sum(e.views)::bigint,sum(e.product_views)::bigint,count(*)::bigint,sum(e.landings)::bigint,
  sum(coalesce(p.orders,0))::bigint,count(*) filter(where p.orders>0)::bigint,
  case when e.dimension in ('total','channel','link') then sum(coalesce(p.gross_amount,0))::bigint end,
  case when e.dimension in ('total','channel','link') then sum(coalesce(p.refund_amount,0))::bigint end
 from event_groups e left join payment_groups p on p.dimension=e.dimension and p.key=e.key and p.session_id=e.session_id
 group by e.dimension,e.key;
$$;
revoke all on function private.store_analytics_raw_rows(date) from public,anon,authenticated,service_role;

create function private.store_analytics_day_coverage(p_day date,p_at timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare began timestamptz; ended timestamptz; expected integer; observed integer; first_at timestamptz; state_value text; archived private.store_analytics_daily_coverage; collection_enabled boolean;
begin
 if p_day>(p_at at time zone 'Asia/Seoul')::date then return jsonb_build_object('state','future','expectedMinutes',0,'observedMinutes',0,'archived',false);end if;
 if p_day<((p_at at time zone 'Asia/Seoul')::date-interval '13 months')::date then return jsonb_build_object('state','expired','expectedMinutes',0,'observedMinutes',0,'archived',false);end if;
 select * into archived from private.store_analytics_daily_coverage where day=p_day;
 if found then return jsonb_build_object('state',archived.state,'expectedMinutes',archived.expected_minutes,'observedMinutes',archived.observed_minutes,'archived',true,'observedUntil',archived.observed_until);end if;
 select activated_at,enabled into first_at,collection_enabled from private.store_analytics_settings where id;
 if first_at is null or p_day<(first_at at time zone 'Asia/Seoul')::date then
  return jsonb_build_object('state','unmeasured','expectedMinutes',0,'observedMinutes',0,'archived',false);end if;
 began:=p_day::timestamp at time zone 'Asia/Seoul';ended:=least((p_day+1)::timestamp at time zone 'Asia/Seoul',date_trunc('minute',p_at));
 select floor(coalesce(sum(greatest(0,extract(epoch from (least(coalesce(w.ended_at,p_at),ended)-greatest(w.started_at,began)))))/60,0))::integer
 into expected from private.store_analytics_windows w where w.started_at<ended and coalesce(w.ended_at,p_at)>began;
 select count(*)::integer into observed from private.store_analytics_health h where h.minute>=began and h.minute<ended;
 if p_day=(p_at at time zone 'Asia/Seoul')::date and collection_enabled then state_value:='collecting';
 elsif expected=0 then state_value:='paused';
 elsif expected>=1440 and observed>=expected then state_value:='observed';
 else state_value:='partial';end if;
 return jsonb_build_object('state',state_value,'expectedMinutes',expected,'observedMinutes',observed,'archived',false,'observedUntil',p_at);
end $$;
revoke all on function private.store_analytics_day_coverage(date,timestamptz) from public,anon,authenticated,service_role;

create function private.store_analytics_period_rows(p_from date,p_to date)
returns table(day date,dimension text,key text,page_views bigint,product_views bigint,sessions bigint,link_landings bigint,
 orders bigint,converted_sessions bigint,gross_amount bigint,refund_amount bigint,archived boolean,observed_until timestamptz)
language sql stable security invoker set search_path='' as $$
 select d.day,d.dimension,d.key,d.page_views,d.product_views,d.sessions,d.link_landings,d.orders,d.converted_sessions,d.gross_amount,d.refund_amount,true,d.observed_until
 from private.store_analytics_daily d where d.day between p_from and p_to
  and d.day>=((statement_timestamp() at time zone 'Asia/Seoul')::date-interval '13 months')::date
 union all
 select d.day::date,r.*,false,statement_timestamp() from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d(day)
 cross join lateral private.store_analytics_raw_rows(d.day::date) r
 where not exists(select 1 from private.store_analytics_daily_coverage c where c.day=d.day::date)
  and d.day::date>=(statement_timestamp() at time zone 'Asia/Seoul')::date-89;
$$;
revoke all on function private.store_analytics_period_rows(date,date) from public,anon,authenticated,service_role;

create function public.process_store_analytics_retention() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare at_time timestamptz:=clock_timestamp(); cutoff date; first_day date; day_value date; coverage jsonb; archived_count integer:=0; enabled_value boolean;
begin
 perform private.store_analytics_require_service();
 if not pg_try_advisory_xact_lock(hashtextextended('store-analytics:retention',0)) then return jsonb_build_object('busy',true);end if;
 select enabled,(activated_at at time zone 'Asia/Seoul')::date into enabled_value,first_day from private.store_analytics_settings where id for share;
 if enabled_value then
  insert into private.store_analytics_health(minute,observed_at) values(date_trunc('minute',at_time),at_time) on conflict(minute) do nothing;
 end if;
 -- Keep exactly the latest 90 Korean calendar dates, including today.
 cutoff:=(at_time at time zone 'Asia/Seoul')::date-89;
 if first_day is not null then
  for day_value in select day::date from generate_series(greatest(first_day,((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date)::timestamp,
   (cutoff-1)::timestamp,interval '1 day') days(day)
   where not exists(select 1 from private.store_analytics_daily_coverage where day=days.day::date) order by day limit 7 loop
   -- Revocation either completes before this snapshot or waits until all raw
   -- identifiers have been removed. Anonymous archived totals cannot be relinked.
   perform id from private.store_analytics_sessions where created_at>=day_value::timestamp at time zone 'Asia/Seoul'
    and created_at<(day_value+1)::timestamp at time zone 'Asia/Seoul' order by id for update;
   coverage:=private.store_analytics_day_coverage(day_value,at_time);
   insert into private.store_analytics_daily(day,dimension,key,page_views,product_views,sessions,link_landings,orders,converted_sessions,gross_amount,refund_amount,observed_until)
    select day_value,r.*,at_time from private.store_analytics_raw_rows(day_value) r;
   insert into private.store_analytics_daily_coverage(day,state,expected_minutes,observed_minutes,observed_until)
    values(day_value,coverage->>'state',(coverage->>'expectedMinutes')::integer,(coverage->>'observedMinutes')::integer,at_time);
   delete from private.store_analytics_sessions where created_at>=day_value::timestamp at time zone 'Asia/Seoul' and created_at<(day_value+1)::timestamp at time zone 'Asia/Seoul';
   delete from private.store_analytics_health where minute>=day_value::timestamp at time zone 'Asia/Seoul' and minute<(day_value+1)::timestamp at time zone 'Asia/Seoul';
   archived_count:=archived_count+1;
  end loop;
 end if;
 delete from private.store_analytics_sessions where created_at<(((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date)::timestamp at time zone 'Asia/Seoul';
 delete from private.store_analytics_daily where day<((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date;
 delete from private.store_analytics_daily_coverage where day<((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date;
 delete from private.store_analytics_health where minute<(((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date)::timestamp at time zone 'Asia/Seoul';
 delete from private.store_analytics_rate_buckets where bucket<date_trunc('minute',at_time)-interval '10 minutes';
 return jsonb_build_object('busy',false,'archivedDays',archived_count,'checkedAt',at_time);
end $$;
revoke all on function public.process_store_analytics_retention() from public,anon,authenticated,service_role;
grant execute on function public.process_store_analytics_retention() to service_role;

create function private.store_analytics_label(p_dimension text,p_key text) returns text
language sql stable security invoker set search_path='' as $$
 select case p_dimension
  when 'total' then '전체'
  when 'good' then coalesce((select name from public.goods where id=p_key),'보관된 상품')
  when 'ip' then coalesce((select title from public.ips where id=p_key),'보관된 IP')
  when 'category' then coalesce((select name from public.catalog_categories where id::text=p_key),'보관된 카테고리')
  when 'link' then coalesce((select coalesce(g.name,s.title,c.name,l.original_title) from private.marketing_links l
   left join public.goods g on g.id=l.good_id left join public.shopping_stories s on s.id=l.story_id
   left join public.catalog_categories c on c.id=l.category_id where l.id::text=p_key),'보관된 링크')
  else p_key end;
$$;
revoke all on function private.store_analytics_label(text,text) from public,anon,authenticated,service_role;

create function private.store_analytics_metric_json(p_views bigint,p_product_views bigint,p_sessions bigint,p_landings bigint,
 p_orders bigint,p_converted bigint,p_gross bigint,p_refunds bigint,p_has_observation boolean) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('pageViews',case when p_has_observation then coalesce(p_views,0) end,
  'productViews',case when p_has_observation then coalesce(p_product_views,0) end,
  'sessions',case when p_has_observation then coalesce(p_sessions,0) end,
  'linkLandings',case when p_has_observation then coalesce(p_landings,0) end,
  'orders',case when p_has_observation then coalesce(p_orders,0) end,
  'convertedSessions',case when p_has_observation then coalesce(p_converted,0) end,
  'conversionRate',case when p_has_observation and p_sessions>0 then round(p_converted::numeric*100/p_sessions,2) end,
  'grossAmount',case when p_has_observation then p_gross end,'refundAmount',case when p_has_observation then p_refunds end,
  'netAmount',case when p_has_observation then p_gross-p_refunds end);
$$;
revoke all on function private.store_analytics_metric_json(bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean) from public,anon,authenticated,service_role;

create function public.admin_store_analytics_report(p_from date,p_to date,p_dimension text default 'channel',p_key text default null,
 p_compare text default 'previous',p_grain text default 'day',p_query text default '',p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare compare_from date;compare_to date;result jsonb;at_time timestamptz:=statement_timestamp();
begin
 if not public.has_operator_capability('stats.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>=60 or p_to>(at_time at time zone 'Asia/Seoul')::date
  or p_dimension is null or p_dimension not in ('channel','page','good','ip','category','link')
  or(p_key is not null and(length(p_key) not between 1 and 200 or p_key~'[[:cntrl:]]'))
  or p_compare is null or p_compare not in ('previous','year','none') or p_grain is null or p_grain not in ('day','week','month')
  or p_query is null or length(p_query)>100 or p_page is null or p_page not between 1 and 100000
  or p_page_size is null or p_page_size not in (20,10000) then raise invalid_parameter_value using message='analytics_invalid_filter';end if;
 if p_compare='previous' then compare_to:=p_from-1;compare_from:=p_from-(p_to-p_from+1);
 elsif p_compare='year' then compare_from:=(p_from-interval '1 year')::date;compare_to:=(p_to-interval '1 year')::date;end if;
 with periods as(select 'current'::text period,p_from date_from,p_to date_to
  union all select 'comparison',compare_from,compare_to where compare_from is not null),
 coverage_days as materialized(select p.period,d.day::date,private.store_analytics_day_coverage(d.day::date,at_time) coverage
  from periods p cross join lateral generate_series(p.date_from::timestamp,p.date_to::timestamp,interval '1 day') d(day)),
 period_coverage as(select period,count(*)::integer days,
  count(*) filter(where coverage->>'state'='observed')::integer observed_days,
  count(*) filter(where coverage->>'state' in ('collecting','partial'))::integer partial_days,
  count(*) filter(where coverage->>'state' in ('unmeasured','paused','expired','future'))::integer missing_days,
  count(*) filter(where(coverage->>'archived')::boolean)::integer archived_days,
  coalesce(sum((coverage->>'observedMinutes')::integer),0)::integer observed_minutes,
  coalesce(sum((coverage->>'expectedMinutes')::integer),0)::integer expected_minutes,
  max((coverage->>'observedUntil')::timestamptz) observed_until
  from coverage_days group by period),
 facts as materialized(select p.period,r.* from periods p cross join lateral private.store_analytics_period_rows(p.date_from,p.date_to) r),
 summary as(select p.period,private.store_analytics_metric_json(sum(r.page_views)::bigint,sum(r.product_views)::bigint,sum(r.sessions)::bigint,
  sum(r.link_landings)::bigint,sum(r.orders)::bigint,sum(r.converted_sessions)::bigint,
  case when p_key is null or p_dimension in ('channel','link') then coalesce(sum(r.gross_amount),0)::bigint end,
  case when p_key is null or p_dimension in ('channel','link') then coalesce(sum(r.refund_amount),0)::bigint end,
  count(r.day)>0 or c.observed_days=c.days) metrics
  from periods p join period_coverage c on c.period=p.period left join facts r on r.period=p.period
   and r.dimension=case when p_key is null then 'total' else p_dimension end and r.key=coalesce(p_key,'all')
  group by p.period,c.observed_days,c.days),
 bucket_coverage as(select period,date_trunc(p_grain,day::timestamp)::date bucket,
  bool_and(coverage->>'state'='observed') complete,bool_or((coverage->>'archived')::boolean) archived,
  array_agg(distinct coverage->>'state') states from coverage_days group by period,bucket),
 trend as(select c.period,c.bucket,c.states,c.archived,private.store_analytics_metric_json(sum(r.page_views)::bigint,sum(r.product_views)::bigint,sum(r.sessions)::bigint,
  sum(r.link_landings)::bigint,sum(r.orders)::bigint,sum(r.converted_sessions)::bigint,
  case when p_key is null or p_dimension in ('channel','link') then coalesce(sum(r.gross_amount),0)::bigint end,
  case when p_key is null or p_dimension in ('channel','link') then coalesce(sum(r.refund_amount),0)::bigint end,
  count(r.day)>0 or c.complete) metrics
  from bucket_coverage c left join facts r on r.period=c.period and date_trunc(p_grain,r.day::timestamp)::date=c.bucket
   and r.dimension=case when p_key is null then 'total' else p_dimension end and r.key=coalesce(p_key,'all')
  group by c.period,c.bucket,c.states,c.archived,c.complete),
 detail_keys as(select distinct key from facts where dimension=p_dimension
  union select id::text from private.marketing_links where p_dimension='link'),
 details as(select k.key,private.store_analytics_label(p_dimension,k.key) label,
  private.store_analytics_metric_json(sum(f.page_views) filter(where f.period='current')::bigint,
   sum(f.product_views) filter(where f.period='current')::bigint,sum(f.sessions) filter(where f.period='current')::bigint,
   sum(f.link_landings) filter(where f.period='current')::bigint,sum(f.orders) filter(where f.period='current')::bigint,
   sum(f.converted_sessions) filter(where f.period='current')::bigint,
   case when p_dimension in ('channel','link') then coalesce(sum(f.gross_amount) filter(where f.period='current'),0)::bigint end,
   case when p_dimension in ('channel','link') then coalesce(sum(f.refund_amount) filter(where f.period='current'),0)::bigint end,
   count(f.day) filter(where f.period='current')>0 or(select observed_days=days from period_coverage where period='current')) metrics,
  case when compare_from is not null then private.store_analytics_metric_json(sum(f.page_views) filter(where f.period='comparison')::bigint,
   sum(f.product_views) filter(where f.period='comparison')::bigint,sum(f.sessions) filter(where f.period='comparison')::bigint,
   sum(f.link_landings) filter(where f.period='comparison')::bigint,sum(f.orders) filter(where f.period='comparison')::bigint,
   sum(f.converted_sessions) filter(where f.period='comparison')::bigint,
   case when p_dimension in ('channel','link') then coalesce(sum(f.gross_amount) filter(where f.period='comparison'),0)::bigint end,
   case when p_dimension in ('channel','link') then coalesce(sum(f.refund_amount) filter(where f.period='comparison'),0)::bigint end,
   count(f.day) filter(where f.period='comparison')>0 or(select observed_days=days from period_coverage where period='comparison')) end comparison,
  bool_or(f.archived) archived,max(f.observed_until) observed_until
  from detail_keys k left join facts f on f.key=k.key and f.dimension=p_dimension
  where (p_key is null or k.key=p_key) and (btrim(p_query)='' or strpos(lower(private.store_analytics_label(p_dimension,k.key)),lower(btrim(p_query)))>0 or strpos(k.key,lower(btrim(p_query)))>0)
  group by k.key),
 detail_page as(select * from details order by(metrics->>'sessions')::bigint desc nulls last,label,key limit p_page_size offset(p_page-1)*p_page_size)
 select jsonb_build_object('from',p_from,'to',p_to,'comparisonFrom',compare_from,'comparisonTo',compare_to,
  'dimension',p_dimension,'selectedKey',p_key,'selectedLabel',case when p_key is not null then private.store_analytics_label(p_dimension,p_key) end,
  'summary',(select metrics from summary where period='current'),'comparison',(select metrics from summary where period='comparison'),
  'coverage',(select to_jsonb(c)-'period' from period_coverage c where period='current'),
  'comparisonCoverage',(select to_jsonb(c)-'period' from period_coverage c where period='comparison'),
  'trend',coalesce((select jsonb_agg(jsonb_build_object('date',bucket,'metrics',metrics,'states',states,'archived',archived) order by bucket) from trend where period='current'),'[]'),
  'comparisonTrend',coalesce((select jsonb_agg(jsonb_build_object('date',bucket,'metrics',metrics,'states',states,'archived',archived) order by bucket) from trend where period='comparison'),'[]'),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'metrics',metrics,'comparison',comparison,'archived',coalesce(archived,false),'observedUntil',observed_until)
   order by(metrics->>'sessions')::bigint desc nulls last,label,key) from detail_page),'[]'),'total',(select count(*) from details),
  'collection',(select jsonb_build_object('enabled',enabled,'startedAt',activated_at,'noticeVersion',notice_version,
   'lastHeartbeatAt',(select max(observed_at) from private.store_analytics_health),'rawRetentionDays',90,'aggregateRetentionMonths',13,
   'retentionBacklog',(select count(*) from private.store_analytics_sessions where created_at<(((at_time at time zone 'Asia/Seoul')::date-89)::timestamp at time zone 'Asia/Seoul')))
   from private.store_analytics_settings where id),'observedAt',at_time,'advertisingCost',null,'roas',null)
 into result;
 return result;
end $$;
revoke all on function public.admin_store_analytics_report(date,date,text,text,text,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_store_analytics_report(date,date,text,text,text,text,text,integer,integer) to authenticated;

do $$declare f regprocedure;begin
 perform private.register_operator_rpc_contract('public.admin_store_analytics_report(date,date,text,text,text,text,text,integer,integer)'::regprocedure,'stats.read','read',false);
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
  n.nspname='private' and p.proname like 'store_analytics_%' or n.nspname='public' and p.proname in
   ('get_store_analytics_state','set_store_analytics_collection','start_store_analytics_session','store_analytics_session_status','revoke_store_analytics_session','record_store_analytics_event','bind_store_analytics_order','process_store_analytics_retention')
 loop perform private.register_operator_internal_contract(f);end loop;
end $$;

notify pgrst,'reload schema';

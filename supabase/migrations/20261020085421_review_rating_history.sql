-- Disabled review rating history; existing live reader definitions and privileges are preserved.
set local search_path='';
do $preflight$
begin
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.admin_review_insights(text,text,text,integer,integer)'::regprocedure),'UTF8'),'sha256'),'hex')
  <> '8a3549b60d3d34aa2ed5d188d34763b4aeabdbe41a59bf705ecd3168ab0913c3' then
  raise exception 'review_rating_source_changed';end if;
 if pg_get_userbyid((select proowner from pg_proc where oid='public.admin_review_insights(text,text,text,integer,integer)'::regprocedure))<>'postgres' then
  raise exception 'review_rating_reader_owner_changed';end if;
end $preflight$;

create table private.review_rating_observation_contracts (
 version integer primary key check(version>0),
 source_reader_sha256 text not null check(source_reader_sha256~'^[0-9a-f]{64}$'),
 aggregate_sha256 text not null check(aggregate_sha256~'^[0-9a-f]{64}$'),
 enabled boolean not null default false,
 collection_started_at timestamptz,
 last_success_at timestamptz,
 purged_before_as_of date,
 last_purged_at timestamptz,
 constraint review_rating_collection_started check(not enabled or collection_started_at is not null),
 constraint review_rating_collection_times check((collection_started_at is null or isfinite(collection_started_at))
  and (last_success_at is null or isfinite(last_success_at) and collection_started_at is not null and last_success_at>=collection_started_at)
  and (last_purged_at is null or isfinite(last_purged_at))
  and ((purged_before_as_of is null)=(last_purged_at is null))
  and (purged_before_as_of is null or isfinite(purged_before_as_of)))
);
create unique index review_rating_one_enabled_contract on private.review_rating_observation_contracts((true)) where enabled;
alter table private.review_rating_observation_contracts owner to postgres;
alter table private.review_rating_observation_contracts enable row level security;
revoke all on table private.review_rating_observation_contracts from public,anon,authenticated,service_role;
comment on table private.review_rating_observation_contracts is 'Small collection and completed retention metadata; does not prove every absent day was collected.';

create table private.review_rating_daily_observations (
 version integer not null references private.review_rating_observation_contracts(version),
 as_of date not null,
 observation_day date not null,
 observed_at timestamptz not null check(isfinite(observed_at)),
 six_month_from date not null,
 average_rating numeric,
 six_month_rating numeric,
 eligible_product_count bigint not null check(eligible_product_count>=0),
 rated_product_count bigint not null check(rated_product_count between 0 and eligible_product_count),
 six_month_rated_product_count bigint not null check(six_month_rated_product_count between 0 and rated_product_count),
 review_count bigint not null check(review_count>=rated_product_count),
 six_month_review_count bigint not null check(six_month_review_count between six_month_rated_product_count and review_count),
 fingerprint text not null check(fingerprint~'^[0-9a-f]{64}$'),
 primary key(version,as_of),
 unique(version,observation_day),
 check(as_of=observation_day-1 and observation_day=(observed_at at time zone 'Asia/Seoul')::date
  and six_month_from=(observation_day::timestamp-interval '6 months')::date),
 check((rated_product_count=0 and average_rating is null) or (rated_product_count>0 and average_rating is not null and average_rating between 1 and 5)),
 check((six_month_rated_product_count=0 and six_month_rating is null) or (six_month_rated_product_count>0 and six_month_rating is not null and six_month_rating between 1 and 5)),
 check((review_count=0)=(rated_product_count=0) and (six_month_review_count=0)=(six_month_rated_product_count=0))
);
alter table private.review_rating_daily_observations owner to postgres;
alter table private.review_rating_daily_observations enable row level security;
revoke all on table private.review_rating_daily_observations from public,anon,authenticated,service_role;
comment on table private.review_rating_daily_observations is 'First successful daily observation, immutable through every application RPC; aggregate values only, retained for thirteen calendar months.';

-- Owner-only formula, copied from the fingerprint-bound live reader. Parameter is
-- an observation instant, never accepted by the public collection RPC.
create function private.review_rating_snapshot(p_observed_at timestamptz)
returns table(average_rating numeric,six_month_rating numeric,eligible_product_count bigint,
 rated_product_count bigint,six_month_rated_product_count bigint,review_count bigint,six_month_review_count bigint)
language sql stable security definer set search_path='' as $$
 with cutoff as materialized (
  select date_trunc('day',p_observed_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' day_start
 ), products as materialized (
  select g.id from public.goods g join public.ips i on i.id=g.ip_id
  where g.archived_at is null and g.published_at is not null and i.archived_at is null and i.published_at is not null and g.sale_restriction='none'
 ), visible_reviews as materialized (
  select r.good_id,r.rating,r.created_at from public.reviews r join products p on p.id=r.good_id cross join cutoff c
  where r.status='visible' and r.created_at<c.day_start
 ), reviews_by_product as (
  select r.good_id,avg(r.rating) average_rating,
   avg(r.rating) filter(where r.created_at>=((c.day_start at time zone 'Asia/Seoul')-interval '6 months') at time zone 'Asia/Seoul') six_month_rating,
   count(*) review_count,
   count(*) filter(where r.created_at>=((c.day_start at time zone 'Asia/Seoul')-interval '6 months') at time zone 'Asia/Seoul') six_month_review_count
  from visible_reviews r cross join cutoff c group by r.good_id
 ) select avg(r.average_rating),avg(r.six_month_rating),(select count(*) from products),count(r.average_rating),count(r.six_month_rating),
  coalesce(sum(r.review_count),0)::bigint,coalesce(sum(r.six_month_review_count),0)::bigint from reviews_by_product r;
$$;
alter function private.review_rating_snapshot(timestamptz) owner to postgres;
revoke all on function private.review_rating_snapshot(timestamptz) from public,anon,authenticated,service_role;

insert into private.review_rating_observation_contracts(version,source_reader_sha256,aggregate_sha256)
values(1,'8a3549b60d3d34aa2ed5d188d34763b4aeabdbe41a59bf705ecd3168ab0913c3',
 encode(extensions.digest(convert_to(pg_get_functiondef('private.review_rating_snapshot(timestamptz)'::regprocedure),'UTF8'),'sha256'),'hex'));

create function private.assert_review_rating_contract(p_version integer) returns void
language plpgsql stable security definer set search_path='' as $$
declare contract private.review_rating_observation_contracts;
begin
 select * into strict contract from private.review_rating_observation_contracts where version=p_version;
 if contract.source_reader_sha256<>'8a3549b60d3d34aa2ed5d188d34763b4aeabdbe41a59bf705ecd3168ab0913c3'
  or contract.source_reader_sha256<>encode(extensions.digest(convert_to(pg_get_functiondef('public.admin_review_insights(text,text,text,integer,integer)'::regprocedure),'UTF8'),'sha256'),'hex')
  or contract.aggregate_sha256<>encode(extensions.digest(convert_to(pg_get_functiondef('private.review_rating_snapshot(timestamptz)'::regprocedure),'UTF8'),'sha256'),'hex') then
  raise sqlstate '55000' using message='review_rating_contract_changed';end if;
end $$;
alter function private.assert_review_rating_contract(integer) owner to postgres;
revoke all on function private.assert_review_rating_contract(integer) from public,anon,authenticated,service_role;

create function public.service_observe_review_rating_daily() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare contract private.review_rating_observation_contracts; result jsonb; purge_before date; purge_time timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege using message='review_rating_service_required';end if;
 -- Global lock shared with the reviewed operations SQL; never wait across midnight.
 if not pg_try_advisory_xact_lock(1920168564,1) then
  return jsonb_build_object('status','busy','version',null,'asOf',null,'observedAt',null,'fingerprint',null);end if;
 select * into strict contract from private.review_rating_observation_contracts order by version desc limit 1;
 perform private.assert_review_rating_contract(contract.version);
 if contract.enabled then
  with instant as materialized (select clock_timestamp() observed_at),
  observed as materialized (
   select observed_at,(observed_at at time zone 'Asia/Seoul')::date observation_day,
    (observed_at at time zone 'Asia/Seoul')::time observation_time from instant
  ), needed as materialized (
   select o.* from observed o where o.observation_time>=time '00:05'
    and not exists(select 1 from private.review_rating_daily_observations d where d.version=contract.version and d.as_of=o.observation_day-1)
  ), measured as materialized (
   select n.*,m.* from needed n cross join lateral private.review_rating_snapshot(n.observed_at) m
  ), inserted as (
   insert into private.review_rating_daily_observations(version,as_of,observation_day,observed_at,six_month_from,
    average_rating,six_month_rating,eligible_product_count,rated_product_count,six_month_rated_product_count,review_count,six_month_review_count,fingerprint)
   select contract.version,m.observation_day-1,m.observation_day,m.observed_at,(m.observation_day::timestamp-interval '6 months')::date,
    m.average_rating,m.six_month_rating,m.eligible_product_count,m.rated_product_count,m.six_month_rated_product_count,m.review_count,m.six_month_review_count,
    encode(extensions.digest(convert_to(jsonb_build_object('version',contract.version,'asOf',m.observation_day-1,
     'observedAt',m.observed_at,'sixMonthFrom',(m.observation_day::timestamp-interval '6 months')::date,
     'averageRating',m.average_rating,'sixMonthRating',m.six_month_rating,'eligibleProductCount',m.eligible_product_count,
     'ratedProductCount',m.rated_product_count,'sixMonthRatedProductCount',m.six_month_rated_product_count,
     'reviewCount',m.review_count,'sixMonthReviewCount',m.six_month_review_count)::text,'UTF8'),'sha256'),'hex') from measured m
   returning *
  ) select case when i.version is not null then jsonb_build_object('status','recorded','version',i.version,'asOf',i.as_of,'observedAt',i.observed_at,'fingerprint',i.fingerprint)
   when d.version is not null then jsonb_build_object('status','already_recorded','version',d.version,'asOf',d.as_of,'observedAt',d.observed_at,'fingerprint',d.fingerprint)
   else jsonb_build_object('status','too_early','version',contract.version,'asOf',null,'observedAt',null,'fingerprint',null) end into result
  from observed o left join inserted i on true left join private.review_rating_daily_observations d on d.version=contract.version and d.as_of=o.observation_day-1;
  if result->>'status'='recorded' then
   update private.review_rating_observation_contracts set last_success_at=(result->>'observedAt')::timestamptz where version=contract.version;
  end if;
 else
  result:=jsonb_build_object('status','disabled','version',contract.version,'asOf',null,'observedAt',null,'fingerprint',null);
 end if;
 -- Retention continues while collection is stopped. Boundary metadata records a
 -- completed DELETE range, including empty ranges, not proof of prior collection.
 purge_time:=clock_timestamp();
 purge_before:=((purge_time at time zone 'Asia/Seoul')::date::timestamp-interval '13 months')::date;
 delete from private.review_rating_daily_observations where as_of<purge_before;
 update private.review_rating_observation_contracts set purged_before_as_of=greatest(purged_before_as_of,purge_before),last_purged_at=purge_time
  where collection_started_at is not null;
 return result;
end $$;
alter function public.service_observe_review_rating_daily() owner to postgres;
revoke all on function public.service_observe_review_rating_daily() from public,anon,authenticated,service_role;
grant execute on function public.service_observe_review_rating_daily() to service_role;

create function public.admin_review_rating_comparison(p_as_of date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare contract private.review_rating_observation_contracts; comparison_day date; observation private.review_rating_daily_observations; state text;
begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is null or not public.has_operator_capability('cs.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 if p_as_of is null or not isfinite(p_as_of) then raise invalid_parameter_value using message='invalid_review_rating_date';end if;
 if p_as_of<>(statement_timestamp() at time zone 'Asia/Seoul')::date-1 then
  raise sqlstate 'PT409' using message='review_rating_date_changed';end if;
 select * into strict contract from private.review_rating_observation_contracts order by version desc limit 1;
 perform private.assert_review_rating_contract(contract.version);
 comparison_day:=(p_as_of::timestamp-interval '3 months')::date;
 select * into observation from private.review_rating_daily_observations where version=contract.version and as_of=comparison_day;
 state:=case when found then 'available'
  when contract.collection_started_at is null or comparison_day+1<(contract.collection_started_at at time zone 'Asia/Seoul')::date then 'before_collection_start'
  when comparison_day<contract.purged_before_as_of then 'outside_retention' else 'not_collected' end;
 return jsonb_build_object('version',contract.version,'asOf',p_as_of,'comparisonAsOf',comparison_day,'status',state,
  'enabled',contract.enabled,'collectionStartedAt',contract.collection_started_at,'lastSuccessAt',contract.last_success_at,
  'purgedBeforeAsOf',contract.purged_before_as_of,'lastPurgedAt',contract.last_purged_at,
  'observation',case when state<>'available' then null else jsonb_build_object('version',observation.version,'asOf',observation.as_of,
   'observationDay',observation.observation_day,'observedAt',observation.observed_at,'sixMonthFrom',observation.six_month_from,
   'averageRating',round(observation.average_rating,2),'sixMonthRating',round(observation.six_month_rating,2),
   'eligibleProductCount',observation.eligible_product_count,'ratedProductCount',observation.rated_product_count,
   'sixMonthRatedProductCount',observation.six_month_rated_product_count,'reviewCount',observation.review_count,
   'sixMonthReviewCount',observation.six_month_review_count,'fingerprint',observation.fingerprint) end);
end $$;
alter function public.admin_review_rating_comparison(date) owner to postgres;
revoke all on function public.admin_review_rating_comparison(date) from public,anon,authenticated,service_role;
grant execute on function public.admin_review_rating_comparison(date) to authenticated;

select private.register_operator_rpc_contract('public.admin_review_rating_comparison(date)'::regprocedure,'cs.manage','read',false);
select private.register_operator_internal_contract('private.review_rating_snapshot(timestamptz)'::regprocedure);
select private.register_operator_internal_contract('private.assert_review_rating_contract(integer)'::regprocedure);
select private.register_operator_internal_contract('public.service_observe_review_rating_daily()'::regprocedure);
select private.register_operator_internal_contract('public.admin_review_rating_comparison(date)'::regprocedure);
notify pgrst,'reload schema';

begin;

-- Self-declared gender is optional, separate from marketing/activity consent,
-- and never projected through public profiles or individual operator records.
create table private.customer_demographic_consents (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 choice text not null check(choice in ('accepted','declined')),
 gender text check(gender in ('female','male','other')),
 notice_version text not null check(notice_version='customer-demographics-v1'),
 revision bigint not null check(revision>0),
 accepted_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 check((choice='accepted' and gender is not null and accepted_at is not null)
    or (choice='declined' and gender is null and accepted_at is null))
);
alter table private.customer_demographic_consents owner to postgres;
alter table private.customer_demographic_consents enable row level security;
revoke all on private.customer_demographic_consents from public,anon,authenticated,service_role;

create function public.customer_demographic_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session_value uuid:=(auth.jwt()->>'session_id')::uuid;
 c private.customer_demographic_consents;
begin
 if actor is null or session_value is null or not exists(select 1 from auth.sessions
  where id=session_value and user_id=actor and (not_after is null or not_after>statement_timestamp())) then
  raise insufficient_privilege using message='customer_demographic_auth_changed'; end if;
 if not exists(select 1 from public.profiles p where p.id=actor and p.role='user'
  and p.onboarded_at is not null and p.suspended_at is null
  and p.consents->'terms'='true'::jsonb and p.consents->'privacy'='true'::jsonb
  and p.birth_date<=((statement_timestamp() at time zone 'Asia/Seoul')::date-interval '14 years')::date)
  or exists(select 1 from private.account_action_fences where subject_user_id=actor) then return null; end if;
 select * into c from private.customer_demographic_consents where user_id=actor;
 return jsonb_build_object('actorId',actor,'sessionId',session_value,'choice',coalesce(c.choice,'unset'),
  'gender',c.gender,'revision',coalesce(c.revision,0),'noticeVersion','customer-demographics-v1','acceptedAt',c.accepted_at);
end $$;

create function public.set_customer_demographic_consent(p_choice text,p_gender text,p_expected_revision bigint,
 p_expected_actor uuid,p_expected_session uuid,p_notice_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.customer_demographic_consents;
begin
 -- The shared identity helper locks the live customer, session and deletion
 -- boundary. It does not read or inherit the member-activity consent.
 perform private.require_member_activity_identity(p_expected_actor,p_expected_session);
 if p_choice is null or p_choice not in ('accepted','declined') or p_expected_revision is null or p_expected_revision<0
  or p_notice_version is distinct from 'customer-demographics-v1'
  or (p_choice='accepted' and (p_gender is null or p_gender not in ('female','male','other')))
  or (p_choice='declined' and p_gender is not null) then
  raise invalid_parameter_value using message='invalid_customer_demographic_choice'; end if;
 select * into c from private.customer_demographic_consents where user_id=p_expected_actor for update;
 if coalesce(c.revision,0)<>p_expected_revision then
  -- An immediate identical retry is safe, but an older accept cannot undo a
  -- later withdrawal/change, including an accept->decline->accept sequence.
  if c.revision=p_expected_revision+1 and c.choice=p_choice and c.gender is not distinct from p_gender then
   return public.customer_demographic_state(); end if;
  raise sqlstate 'PT409' using message='customer_demographic_choice_changed'; end if;
 if c.choice is distinct from p_choice or c.gender is distinct from p_gender then
  insert into private.customer_demographic_consents(user_id,choice,gender,notice_version,revision,accepted_at)
   values(p_expected_actor,p_choice,p_gender,p_notice_version,coalesce(c.revision,0)+1,
    case when p_choice='accepted' then clock_timestamp() end)
   on conflict(user_id) do update set choice=excluded.choice,gender=excluded.gender,notice_version=excluded.notice_version,
    revision=excluded.revision,accepted_at=excluded.accepted_at,updated_at=clock_timestamp();
 end if;
 return public.customer_demographic_state();
end $$;

create function private.erase_fenced_customer_demographics() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update private.customer_demographic_consents set choice='declined',gender=null,accepted_at=null,
  revision=revision+1,updated_at=clock_timestamp() where user_id=new.subject_user_id and choice='accepted';
 return new;
end $$;
create trigger erase_fenced_customer_demographics after insert on private.account_action_fences
 for each row execute function private.erase_fenced_customer_demographics();

create function public.admin_customer_demographic_report(p_scope text,p_grain text,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare today date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
 basis date; result jsonb;
begin
 perform private.require_operator_capability('stats.read',false);
 if p_scope is null or p_scope not in ('members','purchasers') then
  raise invalid_parameter_value using message='invalid_customer_demographic_range'; end if;
 if p_scope='members' then
  if p_grain is not null or p_from is not null or p_to is not null then
   raise invalid_parameter_value using message='invalid_customer_demographic_range'; end if;
  basis:=today;
 else
  if p_grain is null or p_grain not in ('week','month') or p_from is null or p_to is null
   or not isfinite(p_from) or not isfinite(p_to) or p_from<date '2010-01-01' or p_from>p_to
   or p_to-p_from+1>366 or p_to>=date_trunc(p_grain,today::timestamp)::date
   or p_from<>date_trunc(p_grain,p_from::timestamp)::date
   or p_to+1<>date_trunc(p_grain,(p_to+1)::timestamp)::date then
   raise invalid_parameter_value using message='invalid_customer_demographic_range'; end if;
  basis:=p_to;
 end if;
 with paid as materialized (
  select o.user_id,max(t.paid_at) paid_at from private.admin_customer_purchase_payment_times() t
  join public.orders o on o.id=t.order_id
  where p_scope='purchasers' and t.paid_at>=p_from::timestamp at time zone 'Asia/Seoul'
   and t.paid_at<(p_to+1)::timestamp at time zone 'Asia/Seoul'
  group by o.user_id
 ), customers as materialized (
  select p.id,extract(year from age(basis,p.birth_date))::integer age,
   case when c.choice='accepted' and (p_scope='members' or c.accepted_at<=paid.paid_at)
    then c.gender else 'undisclosed' end gender
  from public.profiles p left join private.customer_demographic_consents c on c.user_id=p.id
  left join paid on paid.user_id=p.id
  where p.role='user' and p.onboarded_at is not null and p.suspended_at is null
   and p.consents->'terms'='true'::jsonb and p.consents->'privacy'='true'::jsonb
   and not exists(select 1 from private.account_action_fences f where f.subject_user_id=p.id)
   and (p_scope='members' or paid.user_id is not null)
 ), bands(band,low_age,high_age) as (
  values ('14_19',14,19),('20_24',20,24),('25_29',25,29),('30_34',30,34),('35_39',35,39),
   ('40_44',40,44),('45_49',45,49),('50_54',50,54),('55_59',55,59),('60_plus',60,1000)
 ), genders(gender) as (values ('female'),('male'),('other'),('undisclosed')),
 cells as (
  select b.band,b.low_age,g.gender,count(c.id) n from bands b cross join genders g
  left join customers c on c.age between b.low_age and b.high_age and c.gender=g.gender
  group by b.band,b.low_age,g.gender
 ), protected as (
  select *,count(*) filter(where n<10) over() hidden_count,row_number() over(order by n,band,gender) smallest
  from cells
 )
 select jsonb_build_object('scope',p_scope,'grain',p_grain,'from',p_from,'to',p_to,'ageAsOf',basis,
  'minimumCount',10,'asOf',statement_timestamp(),
  -- No row/column totals, percentages, raw denominator or user identifiers.
  -- If only one cell is hidden, also hide the next-smallest cell so a known
  -- overall customer count cannot reveal the suppressed remainder.
  'cells',jsonb_agg(jsonb_build_object('ageBand',band,'gender',gender,
    'count',case when n>=10 and not(hidden_count=1 and smallest=2) then n end)
   order by low_age,gender)) into result from protected;
 return result;
end $$;

alter function public.customer_demographic_state() owner to postgres;
alter function public.set_customer_demographic_consent(text,text,bigint,uuid,uuid,text) owner to postgres;
alter function private.erase_fenced_customer_demographics() owner to postgres;
alter function public.admin_customer_demographic_report(text,text,date,date) owner to postgres;
revoke all on function public.customer_demographic_state(),public.set_customer_demographic_consent(text,text,bigint,uuid,uuid,text),
 private.erase_fenced_customer_demographics(),public.admin_customer_demographic_report(text,text,date,date)
 from public,anon,authenticated,service_role;
grant execute on function public.customer_demographic_state(),public.set_customer_demographic_consent(text,text,bigint,uuid,uuid,text),
 public.admin_customer_demographic_report(text,text,date,date) to authenticated;
select private.register_operator_internal_contract('private.erase_fenced_customer_demographics()'::regprocedure);
select private.register_operator_rpc_contract('public.admin_customer_demographic_report(text,text,date,date)'::regprocedure,'stats.read','read',false);
commit;

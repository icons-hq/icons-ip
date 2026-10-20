-- Review events grant existing KRW store credits after an explicit announcement.
-- No PG, provider wallet or external notification is invoked by this domain.
create table private.review_events (
 id uuid primary key,
 number bigint generated always as identity unique,
 title text not null check(char_length(title) between 1 and 15 and title=btrim(title)),
 description text not null check(char_length(description) between 1 and 30 and description=btrim(description)),
 target_type text not null check(target_type in ('all','goods','categories')),
 starts_on date not null, ends_on date not null, announces_on date not null,
 planned_winners integer not null check(planned_winners between 1 and 1000),
 credit_amount bigint not null check(credit_amount between 1 and 999999999999),
 credit_validity_days integer not null check(credit_validity_days between 1 and 36500),
 banner_style text not null check(banner_style in ('basic','emphasis')),
 revision integer not null default 1 check(revision>0),
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 archived_at timestamptz, announced_at timestamptz, announced_by uuid,
 check(ends_on between starts_on+1 and starts_on+31),
 check(announces_on between ends_on+3 and ends_on+10),
 check(starts_on between date '2000-01-01' and date '2099-12-31'),
 check((announced_at is null)=(announced_by is null))
);
create table private.review_event_goods (
 event_id uuid not null references private.review_events(id),
 good_id text not null references public.goods(id) on update cascade on delete cascade,
 primary key(event_id,good_id)
);
create table private.review_event_categories (
 event_id uuid not null references private.review_events(id),
 category_id uuid not null references public.catalog_categories(id) on update cascade on delete cascade,
 primary key(event_id,category_id)
);
create table private.review_event_entries (
 id uuid primary key default extensions.gen_random_uuid(),
 event_id uuid not null references private.review_events(id),
 source_review_id uuid not null unique,
 review_id uuid references public.reviews(id) on delete set null,
 user_id uuid not null, order_id uuid not null, good_id text not null,
 entered_at timestamptz not null, event_revision integer not null,
 credit_amount bigint not null, credit_validity_days integer not null,
 target_snapshot jsonb not null,
 selected boolean not null default false,
 selected_review_updated_at timestamptz,
 selected_review_fingerprint text,
 selected_by uuid, selected_at timestamptz, selection_reason text,
 check(not selected or (selected_review_updated_at is not null and selected_review_fingerprint is not null and selected_by is not null and selected_at is not null and char_length(selection_reason) between 2 and 500))
);
create index review_event_entries_event on private.review_event_entries(event_id,entered_at,id);
create index review_event_entries_user on private.review_event_entries(user_id,event_id);
create unique index review_event_selected_customer_once on private.review_event_entries(event_id,user_id) where selected;
create table private.review_event_awards (
 entry_id uuid primary key references private.review_event_entries(id),
 event_id uuid not null references private.review_events(id),
 user_id uuid not null, source_review_id uuid not null, order_id uuid not null,
 lot_id uuid not null unique,
 amount bigint not null check(amount>0), expires_at timestamptz not null,
 granted_at timestamptz not null default clock_timestamp(), granted_by uuid not null,
 grant_operation_id uuid not null unique,
 revoke_operation_id uuid not null unique default extensions.gen_random_uuid(),
 revoked_at timestamptz, revoked_by uuid, revoke_reason text,
 unique(event_id,user_id)
);
create index review_event_awards_review on private.review_event_awards(source_review_id);
create index review_event_awards_order on private.review_event_awards(order_id,user_id);
alter table private.review_events enable row level security;
alter table private.review_event_goods enable row level security;
alter table private.review_event_categories enable row level security;
alter table private.review_event_entries enable row level security;
alter table private.review_event_awards enable row level security;
revoke all on private.review_events,private.review_event_goods,private.review_event_categories,private.review_event_entries,private.review_event_awards from public,anon,authenticated,service_role;
revoke all on sequence private.review_events_number_seq from public,anon,authenticated,service_role;

create function private.review_event_state(p_event private.review_events,p_at timestamptz)
returns text language sql immutable set search_path='' as $$
 select case when p_event.archived_at is not null then 'archived'
  when p_event.announced_at is not null then 'announced'
  when (p_at at time zone 'Asia/Seoul')::date<p_event.starts_on then 'scheduled'
  when (p_at at time zone 'Asia/Seoul')::date<=p_event.ends_on then 'active'
  when (p_at at time zone 'Asia/Seoul')::date<p_event.announces_on then 'closed' else 'ready' end;
$$;
revoke all on function private.review_event_state(private.review_events,timestamptz) from public,anon,authenticated,service_role;

create function private.review_event_values_valid(p_values jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb; start_day date; end_day date; announce_day date;
begin
 if jsonb_typeof(p_values) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_values))<>12
  or not p_values ?& array['title','description','targetType','startsOn','endsOn','announcesOn','plannedWinners','creditAmount','creditValidityDays','bannerStyle','goodIds','categoryIds']
  or jsonb_typeof(p_values->'title') is distinct from 'string' or jsonb_typeof(p_values->'description') is distinct from 'string'
  or char_length(p_values->>'title') not between 1 and 15 or char_length(p_values->>'description') not between 1 and 30
  or p_values->>'title'<>btrim(p_values->>'title') or p_values->>'description'<>btrim(p_values->>'description')
  or ((p_values->>'title')||(p_values->>'description')) ~ '[[:cntrl:]]'
  or jsonb_typeof(p_values->'targetType') is distinct from 'string' or p_values->>'targetType' not in ('all','goods','categories')
  or jsonb_typeof(p_values->'bannerStyle') is distinct from 'string' or p_values->>'bannerStyle' not in ('basic','emphasis')
  or jsonb_typeof(p_values->'goodIds') is distinct from 'array' or jsonb_typeof(p_values->'categoryIds') is distinct from 'array'
  or jsonb_array_length(p_values->'goodIds')>500 or jsonb_array_length(p_values->'categoryIds')>500
 then return false;end if;
 foreach item in array array[p_values->'plannedWinners',p_values->'creditAmount',p_values->'creditValidityDays'] loop
  if jsonb_typeof(item) is distinct from 'number' or item::text !~ '^[0-9]+$' then return false;end if;
 end loop;
 if (p_values->>'plannedWinners')::numeric not between 1 and 1000 or (p_values->>'creditAmount')::numeric not between 1 and 999999999999
  or (p_values->>'creditValidityDays')::numeric not between 1 and 36500 then return false;end if;
 for item in select value from jsonb_array_elements(p_values->'goodIds') loop
  if jsonb_typeof(item)<>'string' or item#>>'{}' !~ '^[a-z0-9][a-z0-9-]{0,199}$' then return false;end if;
 end loop;
 for item in select value from jsonb_array_elements(p_values->'categoryIds') loop
  if jsonb_typeof(item)<>'string' or item#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 end loop;
 if (select count(*)<>count(distinct value) from jsonb_array_elements(p_values->'goodIds'))
  or (select count(*)<>count(distinct value) from jsonb_array_elements(p_values->'categoryIds'))
  or p_values->>'targetType'<>'goods' and jsonb_array_length(p_values->'goodIds')>0
  or p_values->>'targetType'<>'categories' and jsonb_array_length(p_values->'categoryIds')>0
  or p_values->>'targetType'='goods' and jsonb_array_length(p_values->'goodIds')=0
  or p_values->>'targetType'='categories' and jsonb_array_length(p_values->'categoryIds')=0 then return false;end if;
 foreach item in array array[p_values->'startsOn',p_values->'endsOn',p_values->'announcesOn'] loop
  if jsonb_typeof(item) is distinct from 'string' or item#>>'{}' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then return false;end if;
 end loop;
 begin start_day:=(p_values->>'startsOn')::date;end_day:=(p_values->>'endsOn')::date;announce_day:=(p_values->>'announcesOn')::date;
 exception when others then return false;end;
 return end_day between start_day+1 and start_day+31 and announce_day between end_day+3 and end_day+10;
end $$;
revoke all on function private.review_event_values_valid(jsonb) from public,anon,authenticated,service_role;

create function private.review_event_target_goods(p_event_id uuid)
returns table(good_id text) language sql stable security definer set search_path='' as $$
 with recursive visible_categories as materialized(select * from public.get_catalog_categories()), descendants as (
  select c.id from visible_categories c join private.review_event_categories target on target.category_id=c.id where target.event_id=p_event_id
  union select c.id from visible_categories c join descendants parent on c.parent_id=parent.id
 ) select g.id from public.goods g join public.ips ip on ip.id=g.ip_id join private.review_events event on event.id=p_event_id
 where g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null
  and (event.target_type='all' or event.target_type='goods' and exists(select 1 from private.review_event_goods target where target.event_id=p_event_id and target.good_id=g.id)
   or event.target_type='categories' and (g.category_id in(select id from descendants)
    or exists(select 1 from public.goods_additional_categories a join descendants c on c.id=a.category_id where a.good_id=g.id)));
$$;
revoke all on function private.review_event_target_goods(uuid) from public,anon,authenticated,service_role;

create function private.review_event_purchase_eligible(p_order_id uuid,p_user_id uuid,p_good_id text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=p_order_id and o.user_id=p_user_id and o.status in ('delivered','done') and o.delivered_at is not null
  and exists(select 1 from public.order_items item where item.order_id=o.id and item.good_id=p_good_id)
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and c.claim_type in ('cancel','return') and (c.status='completed' or c.stage='completed'))
  and exists(select 1 from public.payments p join public.payment_attempts a on a.payment_id=p.id and a.purpose='order' and a.ref_id=o.id
    and a.user_id=o.user_id and a.provider=p.provider and a.amount=p.amount and a.state='approved'
   where p.purpose='order' and p.ref_id=o.id and p.user_id=o.user_id and p.amount=o.total and p.status='paid'
    and (exists(select 1 from private.payment_provider_evidence evidence where evidence.payment_attempt_id=a.id and evidence.approved_at is not null)
     or a.provider='bank_transfer' and exists(select 1 from public.bank_transfer_confirmations b where b.attempt_id=a.id and b.order_id=o.id))));
$$;
revoke all on function private.review_event_purchase_eligible(uuid,uuid,text) from public,anon,authenticated,service_role;

create function private.review_event_entry_problem(p_entry private.review_event_entries)
returns text language plpgsql stable security definer set search_path='' as $$
declare review public.reviews%rowtype;
begin
 select * into review from public.reviews where id=p_entry.review_id;
 if not found then return 'review_deleted';end if;
 if review.status<>'visible' then return 'review_hidden';end if;
 if review.user_id<>p_entry.user_id or review.order_id<>p_entry.order_id or review.good_id<>p_entry.good_id then return 'review_changed';end if;
 if not private.review_event_purchase_eligible(p_entry.order_id,p_entry.user_id,p_entry.good_id) then return 'purchase_ineligible';end if;
 if not exists(select 1 from public.profiles p where p.id=p_entry.user_id and p.suspended_at is null)
  or private.is_account_write_fenced(p_entry.user_id) then return 'customer_unavailable';end if;
 if not exists(select 1 from public.goods g join public.ips ip on ip.id=g.ip_id where g.id=review.good_id
  and g.archived_at is null and g.published_at is not null and g.sale_restriction='none' and ip.archived_at is null and ip.published_at is not null) then return 'good_unavailable';end if;
 return null;
end $$;
revoke all on function private.review_event_entry_problem(private.review_event_entries) from public,anon,authenticated,service_role;

create function private.review_event_review_fingerprint(p_review public.reviews)
returns text language sql immutable set search_path='' as $$
 select md5(jsonb_build_object('id',p_review.id,'body',p_review.body,'rating',p_review.rating,'images',p_review.image_paths,'status',p_review.status)::text);
$$;
revoke all on function private.review_event_review_fingerprint(public.reviews) from public,anon,authenticated,service_role;

create function private.capture_review_event_entry()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare event private.review_events%rowtype; delivery timestamptz;
begin
 if new.status<>'visible' or not private.review_event_purchase_eligible(new.order_id,new.user_id,new.good_id) then return new;end if;
 select delivered_at into delivery from public.orders where id=new.order_id;
 if delivery is null or new.created_at>private.review_write_deadline(delivery) or new.created_at<delivery then return new;end if;
 select e.* into event from private.review_events e where e.archived_at is null and e.announced_at is null
  and (new.created_at at time zone 'Asia/Seoul')::date between e.starts_on and e.ends_on
  and exists(select 1 from private.review_event_target_goods(e.id) g where g.good_id=new.good_id)
 order by e.credit_amount desc,e.starts_on,e.id limit 1 for share of e;
 if not found then return new;end if;
 insert into private.review_event_entries(event_id,source_review_id,review_id,user_id,order_id,good_id,entered_at,event_revision,credit_amount,credit_validity_days,target_snapshot)
 select event.id,new.id,new.id,new.user_id,new.order_id,new.good_id,new.created_at,event.revision,event.credit_amount,event.credit_validity_days,
  jsonb_build_object('targetType',event.target_type,'goodId',new.good_id,'categoryId',g.category_id,
   'additionalCategoryIds',(select coalesce(jsonb_agg(a.category_id order by a.category_id),'[]'::jsonb) from public.goods_additional_categories a where a.good_id=g.id))
 from public.goods g where g.id=new.good_id;
 return new;
end $$;
revoke all on function private.capture_review_event_entry() from public,anon,authenticated,service_role;
create trigger capture_review_event_entry after insert on public.reviews for each row execute function private.capture_review_event_entry();

create function private.review_event_document(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',e.id,'number',e.number,'title',e.title,'description',e.description,'targetType',e.target_type,
  'startsOn',e.starts_on,'endsOn',e.ends_on,'announcesOn',e.announces_on,'plannedWinners',e.planned_winners,'creditAmount',e.credit_amount,
  'creditValidityDays',e.credit_validity_days,'bannerStyle',e.banner_style,'revision',e.revision,'createdAt',e.created_at,'updatedAt',e.updated_at,
  'archivedAt',e.archived_at,'announcedAt',e.announced_at,'state',private.review_event_state(e,statement_timestamp()),
  'goodIds',(select coalesce(jsonb_agg(good_id order by good_id),'[]'::jsonb) from private.review_event_goods where event_id=e.id),
  'categoryIds',(select coalesce(jsonb_agg(category_id order by category_id),'[]'::jsonb) from private.review_event_categories where event_id=e.id),
  'entryCount',(select count(*) from private.review_event_entries where event_id=e.id),
  'selectedCount',(select count(*) from private.review_event_entries where event_id=e.id and selected),
  'awardedCount',(select count(*) from private.review_event_awards where event_id=e.id),
  'revokedCount',(select count(*) from private.review_event_awards where event_id=e.id and revoked_at is not null),
  'canEdit',e.announced_at is null and (statement_timestamp() at time zone 'Asia/Seoul')::date<e.starts_on)
 from private.review_events e where e.id=p_id;
$$;
revoke all on function private.review_event_document(uuid) from public,anon,authenticated,service_role;

create function public.admin_save_review_event(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_values jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing private.review_events%rowtype; request jsonb; receipt jsonb; before_value jsonb; target text; policy private.store_credit_policy;
begin
 perform private.require_actor_operator_capability(actor,'cs.manage',false);
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or private.review_event_values_valid(p_values) is distinct from true then raise invalid_parameter_value using message='invalid_review_event';end if;
 request:=jsonb_build_object('id',p_id,'revision',p_expected_revision,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended('review-event:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_event.saved',request);if receipt is not null then return receipt;end if;
 perform pg_advisory_xact_lock(hashtextextended('review-event:'||p_id::text,0));
 select * into existing from private.review_events where id=p_id for update;
 if found then
  if existing.revision<>p_expected_revision then raise sqlstate 'PT409' using message='review_event_changed';end if;
  if existing.archived_at is not null or existing.announced_at is not null or (clock_timestamp() at time zone 'Asia/Seoul')::date>=existing.starts_on then raise check_violation using message='review_event_terms_locked';end if;
 elsif p_expected_revision<>0 then raise sqlstate 'PT409' using message='review_event_changed';end if;
 if (p_values->>'startsOn')::date<=(clock_timestamp() at time zone 'Asia/Seoul')::date then raise check_violation using message='review_event_start_tomorrow';end if;
 select * into policy from private.store_credit_policy where singleton for share;
 if not policy.enabled or (p_values->>'creditAmount')::bigint>policy.max_balance or (p_values->>'creditValidityDays')::integer>policy.validity_days then raise check_violation using message='review_event_credit_policy';end if;
 before_value:=private.review_event_document(p_id);
 for target in select value from jsonb_array_elements_text(p_values->'goodIds') order by value loop
  perform 1 from public.goods where id=target and archived_at is null for key share;
  if not found then raise no_data_found using message='review_event_target_missing';end if;
 end loop;
 for target in select value from jsonb_array_elements_text(p_values->'categoryIds') order by value loop
  perform 1 from public.catalog_categories where id=target::uuid and archived_at is null for key share;
  if not found then raise no_data_found using message='review_event_target_missing';end if;
 end loop;
 insert into private.review_events(id,title,description,target_type,starts_on,ends_on,announces_on,planned_winners,credit_amount,credit_validity_days,banner_style,created_by)
 values(p_id,p_values->>'title',p_values->>'description',p_values->>'targetType',(p_values->>'startsOn')::date,(p_values->>'endsOn')::date,(p_values->>'announcesOn')::date,
  (p_values->>'plannedWinners')::integer,(p_values->>'creditAmount')::bigint,(p_values->>'creditValidityDays')::integer,p_values->>'bannerStyle',actor)
 on conflict(id) do update set title=excluded.title,description=excluded.description,target_type=excluded.target_type,starts_on=excluded.starts_on,ends_on=excluded.ends_on,
  announces_on=excluded.announces_on,planned_winners=excluded.planned_winners,credit_amount=excluded.credit_amount,credit_validity_days=excluded.credit_validity_days,
  banner_style=excluded.banner_style,revision=private.review_events.revision+1,updated_at=clock_timestamp();
 delete from private.review_event_goods where event_id=p_id;delete from private.review_event_categories where event_id=p_id;
 insert into private.review_event_goods select p_id,value from jsonb_array_elements_text(p_values->'goodIds');
 insert into private.review_event_categories select p_id,value::uuid from jsonb_array_elements_text(p_values->'categoryIds');
 receipt:=private.review_event_document(p_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_event.saved','review_event:'||p_id,jsonb_build_object('request',request,'result',receipt,'before',before_value));
 return receipt;
end $$;
revoke all on function public.admin_save_review_event(uuid,integer,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_review_event(uuid,integer,uuid,jsonb) to authenticated;

create function public.admin_archive_review_event(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_archived boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); event private.review_events%rowtype; request jsonb; receipt jsonb;
begin
 perform private.require_actor_operator_capability(actor,'cs.manage',false);
 if p_id is null or p_expected_revision is null or p_operation_id is null or p_archived is null then raise invalid_parameter_value using message='invalid_review_event';end if;
 request:=jsonb_build_object('id',p_id,'revision',p_expected_revision,'archived',p_archived);
 perform pg_advisory_xact_lock(hashtextextended('review-event:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_event.archived',request);if receipt is not null then return receipt;end if;
 select * into event from private.review_events where id=p_id for update;
 if not found or event.revision<>p_expected_revision then raise sqlstate 'PT409' using message='review_event_changed';end if;
 if (clock_timestamp() at time zone 'Asia/Seoul')::date>=event.starts_on or event.announced_at is not null then raise check_violation using message='review_event_terms_locked';end if;
 update private.review_events set archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) else null end,revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 receipt:=private.review_event_document(p_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_event.archived','review_event:'||p_id,jsonb_build_object('request',request,'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_archive_review_event(uuid,integer,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_archive_review_event(uuid,integer,uuid,boolean) to authenticated;

create function public.admin_select_review_event_entries(p_id uuid,p_expected_revision integer,p_operation_id uuid,p_entries jsonb,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); event private.review_events%rowtype; request jsonb; receipt jsonb; item jsonb; candidate private.review_event_entries%rowtype;
 review public.reviews%rowtype; ids uuid[]:='{}'; item_id uuid; expected_time timestamptz; before_ids jsonb;
begin
 perform private.require_actor_operator_capability(actor,'cs.manage',false);
 if p_id is null or p_expected_revision is null or p_operation_id is null or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>1000
  or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then raise invalid_parameter_value using message='invalid_review_event_selection';end if;
 for item in select value from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>3 or not item ?& array['id','reviewUpdatedAt','reviewFingerprint']
   or jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'reviewUpdatedAt') is distinct from 'string'
   or jsonb_typeof(item->'reviewFingerprint') is distinct from 'string' or item->>'reviewFingerprint' !~ '^[0-9a-f]{32}$' then raise invalid_parameter_value using message='invalid_review_event_selection';end if;
  begin item_id:=(item->>'id')::uuid;expected_time:=(item->>'reviewUpdatedAt')::timestamptz;exception when others then raise invalid_parameter_value using message='invalid_review_event_selection';end;
  if item_id=any(ids) then raise invalid_parameter_value using message='invalid_review_event_selection';end if;
  ids:=array_append(ids,item_id);
 end loop;
 request:=jsonb_build_object('id',p_id,'revision',p_expected_revision,'entries',p_entries,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('review-event:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_event.selected',request);if receipt is not null then return receipt;end if;
 select * into event from private.review_events where id=p_id for update;
 if not found or event.revision<>p_expected_revision then raise sqlstate 'PT409' using message='review_event_changed';end if;
 if event.archived_at is not null or event.announced_at is not null or (clock_timestamp() at time zone 'Asia/Seoul')::date<=event.ends_on then raise check_violation using message='review_event_selection_closed';end if;
 -- Review deletion/status writers lock the review before its entry FK or award.
 perform 1 from public.reviews r join private.review_event_entries entry on entry.review_id=r.id where entry.id=any(ids) order by r.id for share of r;
 for item in select value from jsonb_array_elements(p_entries) order by value->>'id' loop
  select * into candidate from private.review_event_entries where id=(item->>'id')::uuid and event_id=p_id for update;
  if not found or private.review_event_entry_problem(candidate) is not null then raise check_violation using message='review_event_entry_ineligible';end if;
  select * into review from public.reviews where id=candidate.review_id;
  if review.updated_at is distinct from (item->>'reviewUpdatedAt')::timestamptz or private.review_event_review_fingerprint(review) is distinct from item->>'reviewFingerprint'
  then raise sqlstate 'PT409' using message='review_event_review_changed';end if;
 end loop;
 if (select count(*)<>count(distinct user_id) from private.review_event_entries where id=any(ids)) then raise check_violation using message='review_event_customer_once';end if;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into before_ids from private.review_event_entries where event_id=p_id and selected;
 update private.review_event_entries set selected=false,selected_review_updated_at=null,selected_review_fingerprint=null,selected_at=null,selected_by=null,selection_reason=null where event_id=p_id and selected;
 update private.review_event_entries entry set selected=true,selected_review_updated_at=current_review.updated_at,selected_review_fingerprint=private.review_event_review_fingerprint(current_review),selected_at=clock_timestamp(),selected_by=actor,selection_reason=btrim(p_reason)
 from public.reviews current_review where entry.id=any(ids) and current_review.id=entry.review_id;
 update private.review_events set revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 receipt:=private.review_event_document(p_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_event.selected','review_event:'||p_id,jsonb_build_object('request',request,'result',receipt,'before',before_ids));
 return receipt;
end $$;
revoke all on function public.admin_select_review_event_entries(uuid,integer,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_select_review_event_entries(uuid,integer,uuid,jsonb,text) to authenticated;

-- Reverse exactly this award root and its restoration descendants. Outstanding
-- consumption follows the existing credit debt mechanism; PG refunds never change.
create function private.reverse_review_event_award(p_entry_id uuid,p_reason text,p_actor uuid default null)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare award private.review_event_awards%rowtype; lot private.store_credit_lots%rowtype; debt bigint:=0; recovered bigint:=0;
begin
 select * into award from private.review_event_awards where entry_id=p_entry_id;
 if not found then return false;end if;
 perform private.lock_store_credit_account(award.user_id);
 select * into award from private.review_event_awards where entry_id=p_entry_id for update;
 if award.revoked_at is not null then return false;end if;
 perform private.expire_store_credit_lots(award.user_id,clock_timestamp());
 if not exists(select 1 from private.store_credit_lots where id=award.lot_id and root_lot_id=id and user_id=award.user_id and source_kind='admin')
 then raise check_violation using message='review_event_credit_source_mismatch';end if;
 for lot in select * from private.store_credit_lots where root_lot_id=award.lot_id order by id for update loop
  if lot.user_id<>award.user_id then raise check_violation using message='review_event_credit_source_mismatch';end if;
  debt:=debt+lot.reserved_amount+lot.spent_amount+lot.offset_amount;recovered:=recovered+lot.available_amount;
  update private.store_credit_lots set available_amount=0,revoked_amount=revoked_amount+lot.available_amount,revoked_at=clock_timestamp() where id=lot.id;
  insert into public.store_credit_ledger(user_id,kind,amount,available_delta,debt_delta,lot_id,actor_id,operation_id,reason)
   values(award.user_id,'adjustment_debit',-lot.available_amount,-lot.available_amount,lot.reserved_amount+lot.spent_amount+lot.offset_amount,
    lot.id,p_actor,award.revoke_operation_id,'리뷰 이벤트 혜택 회수: '||left(coalesce(p_reason,''),900));
 end loop;
 update private.store_credit_lots set debt_amount=debt_amount+debt where id=award.lot_id;
 update private.review_event_awards set revoked_at=clock_timestamp(),revoked_by=p_actor,revoke_reason=p_reason where entry_id=p_entry_id;
 insert into public.audit_log(id,actor_id,action,target,diff) values(award.revoke_operation_id,p_actor,'review_event.reward.reversed','review_event_entry:'||p_entry_id,
  jsonb_build_object('eventId',award.event_id,'entryId',p_entry_id,'lotId',award.lot_id,'reason',p_reason,'availableRecovered',recovered,'futureOffset',debt));
 return true;
end $$;
revoke all on function private.reverse_review_event_award(uuid,text,uuid) from public,anon,authenticated,service_role;

create function private.reverse_review_event_order_awards(p_order_id uuid,p_reason text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare award record;
begin
 for award in select entry_id from private.review_event_awards where order_id=p_order_id and revoked_at is null order by user_id,entry_id loop
  perform private.reverse_review_event_award(award.entry_id,p_reason,null);
 end loop;
end $$;
revoke all on function private.reverse_review_event_order_awards(uuid,text) from public,anon,authenticated,service_role;

create function private.review_event_review_revocation()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare award record;
begin
 if tg_op='DELETE' or new.status='hidden' then
  for award in select entry_id from private.review_event_awards where source_review_id=old.id and revoked_at is null order by user_id,entry_id loop
   perform private.reverse_review_event_award(award.entry_id,case when tg_op='DELETE' then '리뷰 삭제' else '리뷰 비공개' end,null);
  end loop;
 end if;
 return coalesce(new,old);
end $$;
revoke all on function private.review_event_review_revocation() from public,anon,authenticated,service_role;
create trigger review_event_review_deleted after delete on public.reviews for each row execute function private.review_event_review_revocation();
create trigger review_event_review_hidden after update of status on public.reviews for each row when(old.status is distinct from new.status) execute function private.review_event_review_revocation();

create function private.review_event_purchase_revocation()
returns trigger language plpgsql volatile security definer set search_path='' as $$
begin
 if tg_table_name='orders' then
  if new.status='canceled' then perform private.reverse_review_event_order_awards(new.id,'원주문 취소');end if;
 elsif tg_table_name='payments' then
  if new.purpose='order' and new.status='refunded' then
   -- Wait for an in-flight publisher before scanning its newly committed awards.
   -- Publishing locks original orders before credit accounts, as refund finalizers do.
   perform 1 from public.orders where id=new.ref_id for update;
   perform private.reverse_review_event_order_awards(new.ref_id,'원결제 환불');
  end if;
 elsif new.claim_type in ('cancel','return') and (new.status='completed' or new.stage='completed') then
  perform 1 from public.orders where id=new.order_id for update;
  perform private.reverse_review_event_order_awards(new.order_id,'원주문 취소·반품 완료');
 end if;
 return new;
end $$;
revoke all on function private.review_event_purchase_revocation() from public,anon,authenticated,service_role;
create trigger review_event_order_canceled after update of status on public.orders for each row when(old.status is distinct from new.status) execute function private.review_event_purchase_revocation();
create trigger review_event_payment_refunded after update of status on public.payments for each row when(old.status is distinct from new.status) execute function private.review_event_purchase_revocation();
create trigger review_event_claim_completed after insert or update of status,stage on public.order_cancellation_requests for each row execute function private.review_event_purchase_revocation();

create function public.admin_publish_review_event(p_id uuid,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); event private.review_events%rowtype; request jsonb; receipt jsonb; users uuid[]; current_users uuid[];
 candidate private.review_event_entries%rowtype; policy private.store_credit_policy; current_review public.reviews%rowtype;
 target uuid; grant_operation uuid; root_lot uuid; balance jsonb; expires timestamptz; published_at timestamptz;
begin
 -- Fetch candidates before taking subject fences, then recheck under the event lock.
 select coalesce(array_agg(distinct user_id order by user_id),'{}'::uuid[]) into users from private.review_event_entries where event_id=p_id and selected;
 perform private.lock_operator_subjects(array_append(users,actor));
 perform private.require_operator_capability('marketing.manage',true);
 if p_id is null or p_expected_revision is null or p_operation_id is null then raise invalid_parameter_value using message='invalid_review_event';end if;
 request:=jsonb_build_object('id',p_id,'revision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('review-event:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_event.published',request);if receipt is not null then return receipt;end if;
 select * into event from private.review_events where id=p_id for update;
 if not found or event.revision<>p_expected_revision then raise sqlstate 'PT409' using message='review_event_changed';end if;
 if event.archived_at is not null or event.announced_at is not null or (clock_timestamp() at time zone 'Asia/Seoul')::date<event.announces_on then raise check_violation using message='review_event_publish_not_ready';end if;
 select coalesce(array_agg(distinct user_id order by user_id),'{}'::uuid[]) into current_users from private.review_event_entries where event_id=p_id and selected;
 if users is distinct from current_users then raise sqlstate 'PT409' using message='review_event_changed';end if;
 if cardinality(users)>1000 then raise check_violation using message='invalid_review_event_selection';end if;
 perform 1 from public.reviews r join private.review_event_entries entry on entry.review_id=r.id where entry.event_id=p_id and entry.selected order by r.id for share of r;
 -- Preserve the established order -> credit-account direction used by refunds.
 for target in select distinct order_id from private.review_event_entries where event_id=p_id and selected order by order_id loop
  perform 1 from public.orders where id=target for share;
 end loop;
 select * into policy from private.store_credit_policy where singleton for share;
 if not policy.enabled then raise check_violation using message='review_event_credit_policy';end if;
 foreach target in array users loop perform private.expire_store_credit_lots(target,clock_timestamp());end loop;
 for candidate in select * from private.review_event_entries where event_id=p_id and selected order by user_id,id for update loop
  if private.review_event_entry_problem(candidate) is not null then raise check_violation using message='review_event_entry_ineligible';end if;
  select * into current_review from public.reviews where id=candidate.review_id;
  if current_review.updated_at is distinct from candidate.selected_review_updated_at or private.review_event_review_fingerprint(current_review) is distinct from candidate.selected_review_fingerprint
  then raise sqlstate 'PT409' using message='review_event_review_changed';end if;
  if candidate.credit_validity_days>policy.validity_days then raise check_violation using message='review_event_credit_policy';end if;
  balance:=private.store_credit_balance(candidate.user_id);
  if candidate.credit_amount>(balance->>'debt')::bigint and (balance->>'available')::bigint+(balance->>'reserved')::bigint+candidate.credit_amount-(balance->>'debt')::bigint>policy.max_balance
   then raise check_violation using message='store_credit_balance_limit';end if;
 end loop;
 -- Waiting for locks and validating every recipient must not consume validity.
 published_at:=clock_timestamp();
 for candidate in select * from private.review_event_entries where event_id=p_id and selected order by user_id,id loop
  expires:=published_at+make_interval(days=>candidate.credit_validity_days);grant_operation:=extensions.gen_random_uuid();
  balance:=private.store_credit_balance(candidate.user_id);
  perform public.admin_adjust_store_credit(grant_operation,candidate.user_id,candidate.credit_amount,expires,
   '리뷰 이벤트 선정 혜택: '||event.title,(balance->>'available')::bigint);
  select lot_id into strict root_lot from public.store_credit_ledger where operation_id=grant_operation and kind='adjustment_credit';
  insert into private.review_event_awards(entry_id,event_id,user_id,source_review_id,order_id,lot_id,amount,expires_at,granted_at,granted_by,grant_operation_id)
   values(candidate.id,p_id,candidate.user_id,candidate.source_review_id,candidate.order_id,root_lot,candidate.credit_amount,expires,published_at,actor,grant_operation);
 end loop;
 update private.review_events set announced_at=published_at,announced_by=actor,revision=revision+1,updated_at=clock_timestamp() where id=p_id;
 receipt:=private.review_event_document(p_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_event.published','review_event:'||p_id,
  jsonb_build_object('request',request,'result',receipt,'paidCustomers',cardinality(users),'gross',(select coalesce(sum(amount),0) from private.review_event_awards where event_id=p_id)));
 return receipt;
end $$;
revoke all on function public.admin_publish_review_event(uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_publish_review_event(uuid,integer,uuid) to authenticated;

create function public.admin_revoke_review_event_award(p_entry_id uuid,p_operation_id uuid,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target_user uuid; event_id uuid; request jsonb; receipt jsonb;
begin
 select user_id,a.event_id into target_user,event_id from private.review_event_awards a where entry_id=p_entry_id;
 perform private.lock_operator_subjects(array[actor,target_user]);perform private.require_operator_capability('marketing.manage',true);
 if p_entry_id is null or p_operation_id is null or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then raise invalid_parameter_value using message='invalid_review_event_revoke';end if;
 request:=jsonb_build_object('entryId',p_entry_id,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('review-event:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.review_event.reward_revoked',request);if receipt is not null then return receipt;end if;
 if target_user is null then raise no_data_found using message='review_event_award_missing';end if;
 perform private.reverse_review_event_award(p_entry_id,btrim(p_reason),actor);
 receipt:=private.review_event_document(event_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.review_event.reward_revoked','review_event_entry:'||p_entry_id,jsonb_build_object('request',request,'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_revoke_review_event_award(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_revoke_review_event_award(uuid,uuid,text) to authenticated;

create function public.admin_list_review_events(p_query text default '',p_state text default 'all',p_date_field text default 'created',p_from date default null,p_to date default null,p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_operator_capability(auth.uid(),'cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_state is null or p_state not in ('all','scheduled','active','closed','ready','announced','archived') or p_date_field is null or p_date_field not in ('created','start','end','announce')
  or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not in (20,50,100) or char_length(coalesce(p_query,''))>100
  or p_from is not null and p_to is not null and p_from>p_to then raise invalid_parameter_value using message='invalid_review_event_search';end if;
 return (with candidates as (
  select e.*,private.review_event_state(e,statement_timestamp()) state,
   case p_date_field when 'start' then starts_on when 'end' then ends_on when 'announce' then announces_on else (created_at at time zone 'Asia/Seoul')::date end filter_day
  from private.review_events e where btrim(coalesce(p_query,''))='' or position(lower(btrim(p_query)) in lower(e.title))>0 or e.number::text=btrim(p_query) or e.id::text=btrim(p_query)
 ), filtered as (select * from candidates where (p_state='all' and archived_at is null or state=p_state)
  and (p_from is null or filter_day>=p_from) and (p_to is null or filter_day<=p_to)), page as (
  select id,created_at from filtered order by created_at desc,id limit p_page_size offset (p_page-1)*p_page_size
 ) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(private.review_event_document(id) order by created_at desc,id) from page),'[]'::jsonb)));
end $$;
revoke all on function public.admin_list_review_events(text,text,text,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_review_events(text,text,text,date,date,integer,integer) to authenticated;

create function public.admin_get_review_event(p_id uuid,p_page integer default 1,p_query text default '',p_filter text default 'all')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare document jsonb; can_pay boolean;
begin
 if not private.has_operator_capability(auth.uid(),'cs.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_page is null or p_page not between 1 and 100000 or char_length(coalesce(p_query,''))>100 or p_filter is null or p_filter not in ('all','eligible','selected','awarded','revoked','unavailable') then raise invalid_parameter_value using message='invalid_review_event_search';end if;
 document:=private.review_event_document(p_id);if document is null then return null;end if;
 can_pay:=private.has_operator_capability(auth.uid(),'marketing.manage',true);
 return (with rows as materialized(
  select entry.*,r.body,r.rating,r.image_paths,r.updated_at review_updated_at,private.review_event_review_fingerprint(r) review_fingerprint,r.status review_status,r.created_at review_created_at,
   coalesce(nullif(btrim(profile.nickname),''),'고객') nickname,coalesce(g.name,'삭제된 상품') good_name,
   private.review_event_entry_problem(entry) problem,award.granted_at,award.revoked_at,award.revoke_reason,award.expires_at
  from private.review_event_entries entry left join public.reviews r on r.id=entry.review_id left join public.profiles profile on profile.id=entry.user_id
  left join public.goods g on g.id=entry.good_id left join private.review_event_awards award on award.entry_id=entry.id
  where entry.event_id=p_id
 ), filtered as(
  select * from rows where (btrim(coalesce(p_query,''))='' or position(lower(btrim(p_query)) in lower(nickname||' '||good_name||' '||coalesce(body,'')))>0 or source_review_id::text=btrim(p_query))
   and (p_filter='all' or p_filter='eligible' and problem is null and granted_at is null or p_filter='selected' and selected
    or p_filter='awarded' and granted_at is not null and revoked_at is null or p_filter='revoked' and revoked_at is not null or p_filter='unavailable' and problem is not null)
 ), page as(select * from filtered order by entered_at desc,id limit 50 offset (p_page-1)*50)
 select jsonb_build_object('event',document,'total',(select count(*) from filtered),'page',p_page,'pageSize',50,'canPay',can_pay,
  'creditPolicy',(select jsonb_build_object('enabled',enabled,'maxBalance',max_balance,'validityDays',validity_days) from private.store_credit_policy where singleton),
  'selected',coalesce((select jsonb_agg(jsonb_build_object('id',id,'reviewUpdatedAt',selected_review_updated_at,'reviewFingerprint',selected_review_fingerprint) order by id) from rows where selected),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'reviewId',review_id,'userId',user_id,'goodId',good_id,'goodName',good_name,'nickname',nickname,
   'body',body,'rating',rating,'imagePaths',coalesce(to_jsonb(image_paths),'[]'::jsonb),'enteredAt',entered_at,'reviewUpdatedAt',review_updated_at,'reviewFingerprint',review_fingerprint,
   'selected',selected,'selectionReason',selection_reason,'selectionChanged',selected and (selected_review_updated_at is distinct from review_updated_at or selected_review_fingerprint is distinct from review_fingerprint),
   'problem',problem,'creditAmount',credit_amount,'grantedAt',granted_at,'revokedAt',revoked_at,'revokeReason',revoke_reason,'expiresAt',expires_at) order by entered_at desc,id) from page),'[]'::jsonb)));
end $$;
revoke all on function public.admin_get_review_event(uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_review_event(uuid,integer,text,text) to authenticated;

create function private.review_event_public_period(p_event private.review_events,p_at timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select p_event.archived_at is null and p_at>=(p_event.starts_on-3)::timestamp at time zone 'Asia/Seoul'
  and p_at<((p_event.announces_on+interval '1 year')::date+1)::timestamp at time zone 'Asia/Seoul';
$$;
revoke all on function private.review_event_public_period(private.review_events,timestamptz) from public,anon,authenticated,service_role;

create function private.review_event_public_document(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',e.id,'title',e.title,'description',e.description,'startsOn',e.starts_on,'endsOn',e.ends_on,'announcesOn',e.announces_on,
  'creditAmount',e.credit_amount,'creditValidityDays',e.credit_validity_days,'plannedWinners',e.planned_winners,'bannerStyle',e.banner_style,
  'state',private.review_event_state(e,statement_timestamp()),'announcedAt',e.announced_at,
  'nextChangeAt',(select min(moment) from unnest(array[(e.starts_on-3)::timestamp at time zone 'Asia/Seoul',e.starts_on::timestamp at time zone 'Asia/Seoul',
   (e.ends_on+1)::timestamp at time zone 'Asia/Seoul',e.announces_on::timestamp at time zone 'Asia/Seoul',((e.announces_on+interval '1 year')::date+1)::timestamp at time zone 'Asia/Seoul']) moment where moment>statement_timestamp()))
 from private.review_events e where e.id=p_id;
$$;
revoke all on function private.review_event_public_document(uuid) from public,anon,authenticated,service_role;

create function public.get_review_events(p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_page is null or p_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_review_event_search';end if;
 return (with candidates as materialized(select e.* from private.review_events e where private.review_event_public_period(e,statement_timestamp())
  and exists(select 1 from private.review_event_target_goods(e.id))),page as(select * from candidates order by starts_on desc,id limit 20 offset (p_page-1)*20)
 select jsonb_build_object('total',(select count(*) from candidates),'rows',coalesce((select jsonb_agg(private.review_event_public_document(id) order by starts_on desc,id) from page),'[]'::jsonb),
  'nextChangeAt',(select min(boundary) from private.review_events e cross join lateral unnest(array[(e.starts_on-3)::timestamp at time zone 'Asia/Seoul',
   e.starts_on::timestamp at time zone 'Asia/Seoul',(e.ends_on+1)::timestamp at time zone 'Asia/Seoul',e.announces_on::timestamp at time zone 'Asia/Seoul',
   ((e.announces_on+interval '1 year')::date+1)::timestamp at time zone 'Asia/Seoul']) boundary where e.archived_at is null and boundary>statement_timestamp())));
end $$;
revoke all on function public.get_review_events(integer) from public,anon,authenticated,service_role;
grant execute on function public.get_review_events(integer) to anon,authenticated;

create function public.get_review_event(p_id uuid,p_winner_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare event private.review_events%rowtype;
begin
 if p_winner_page is null or p_winner_page not between 1 and 100000 then raise invalid_parameter_value using message='invalid_review_event_search';end if;
 select * into event from private.review_events where id=p_id;
 if not found or not private.review_event_public_period(event,statement_timestamp()) or not exists(select 1 from private.review_event_target_goods(p_id)) then return null;end if;
 return (with winners as materialized(
  select r.id review_id,r.good_id,g.name good_name,coalesce(nullif(btrim(profile.nickname),''),'구매자') nickname,r.body,award.granted_at
  from private.review_event_awards award join public.reviews r on r.id=award.source_review_id and r.status='visible'
  join public.goods g on g.id=r.good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'
  join public.ips ip on ip.id=g.ip_id and ip.published_at is not null and ip.archived_at is null left join public.public_profiles profile on profile.id=award.user_id
  where award.event_id=p_id and event.announced_at is not null and award.revoked_at is null
 ), page as(select * from winners order by granted_at,review_id limit 50 offset (p_winner_page-1)*50)
 select jsonb_build_object('event',private.review_event_public_document(p_id),'winnerTotal',(select count(*) from winners),'winnerPage',p_winner_page,
  'winners',coalesce((select jsonb_agg(jsonb_build_object('reviewId',review_id,'goodId',good_id,'goodName',good_name,'nickname',nickname,'body',left(body,250)) order by granted_at,review_id) from page),'[]'::jsonb)));
end $$;
revoke all on function public.get_review_event(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_review_event(uuid,integer) to anon,authenticated;

-- The public banner follows the same winning event as insertion into the entry ledger.
create function public.get_goods_review_events(p_good_ids text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_good_ids is null or cardinality(p_good_ids)>500 then raise invalid_parameter_value using message='invalid_review_event_targets';end if;
 return (with matching as materialized(select e.* ,target.good_id from private.review_events e cross join lateral private.review_event_target_goods(e.id) target
   where target.good_id=any(p_good_ids) and e.archived_at is null and e.announced_at is null),selected as(
  select distinct on(good_id) good_id,id event_id from matching
   where (statement_timestamp() at time zone 'Asia/Seoul')::date between starts_on and ends_on
   order by good_id,credit_amount desc,starts_on,id)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('goodId',good_id,'event',private.review_event_public_document(event_id)) order by good_id) from selected),'[]'::jsonb),
   'nextChangeAt',(select min(moment) from matching cross join lateral unnest(array[starts_on::timestamp at time zone 'Asia/Seoul',(ends_on+1)::timestamp at time zone 'Asia/Seoul']) moment where moment>statement_timestamp())));
end $$;
revoke all on function public.get_goods_review_events(text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_goods_review_events(text[]) to anon,authenticated;

create function public.get_review_event_disclosures(p_review_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_review_ids is null or cardinality(p_review_ids)>500 then raise invalid_parameter_value using message='invalid_review_event_targets';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('reviewId',r.id,'eventTitle',e.title,'revoked',a.revoked_at is not null) order by r.id),'[]'::jsonb)
  from private.review_event_awards a join private.review_events e on e.id=a.event_id and e.announced_at is not null
  join public.reviews r on r.id=a.source_review_id and r.status='visible'
  join public.goods g on g.id=r.good_id and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
  join public.ips ip on ip.id=g.ip_id and ip.archived_at is null and ip.published_at is not null where r.id=any(p_review_ids));
end $$;
revoke all on function public.get_review_event_disclosures(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_review_event_disclosures(uuid[]) to anon,authenticated;

create function public.get_my_review_event_entries(p_review_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise sqlstate '28000' using message='auth_required';end if;
 if p_review_ids is null or cardinality(p_review_ids)>500 then raise invalid_parameter_value using message='invalid_review_event_targets';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('reviewId',entry.source_review_id,'eventId',event.id,'title',event.title,'creditAmount',entry.credit_amount,
  'announcesOn',event.announces_on,'state',private.review_event_state(event,statement_timestamp()),'grantedAt',award.granted_at,'revokedAt',award.revoked_at,
  'revokeReason',award.revoke_reason,'expiresAt',award.expires_at) order by entry.entered_at),'[]'::jsonb)
  from private.review_event_entries entry join private.review_events event on event.id=entry.event_id left join private.review_event_awards award on award.entry_id=entry.id
  where entry.user_id=auth.uid() and entry.source_review_id=any(p_review_ids));
end $$;
revoke all on function public.get_my_review_event_entries(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_my_review_event_entries(uuid[]) to authenticated;

-- CS operators only receive target names/codes; the picker exposes no stock, costs or customers.
create function public.admin_search_review_event_targets(p_type text,p_query text default '',p_page integer default 1,p_ids text[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('cs.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_type is null or p_type not in ('goods','categories') or p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 100000 or cardinality(p_ids)>500
 then raise invalid_parameter_value using message='invalid_review_event_targets';end if;
 return (with recursive categories as (
  select c.id,c.name::text path from public.catalog_categories c where c.parent_id is null and c.archived_at is null
  union all select c.id,p.path||' > '||c.name from public.catalog_categories c join categories p on p.id=c.parent_id where c.archived_at is null
 ), targets as (
  select g.id,g.name label,g.code from public.goods g where p_type='goods' and g.archived_at is null
  union all select c.id::text,c.path,'' from categories c where p_type='categories'
 ), filtered as materialized(select * from targets where (p_ids is null or id=any(p_ids)) and (btrim(p_query)='' or position(lower(btrim(p_query)) in lower(label||' '||code||' '||id))>0)),
 page as(select * from filtered order by label,id limit case when p_ids is null then 20 else 500 end offset case when p_ids is null then (p_page-1)*20 else 0 end)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'code',code) order by label,id) from page),'[]'::jsonb)));
end $$;
revoke all on function public.admin_search_review_event_targets(text,text,integer,text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_review_event_targets(text,text,integer,text[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_search_review_event_targets(text,text,integer,text[])','cs.manage','read',false);

select private.register_operator_rpc_contract('public.admin_save_review_event(uuid,integer,uuid,jsonb)','cs.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_archive_review_event(uuid,integer,uuid,boolean)','cs.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_select_review_event_entries(uuid,integer,uuid,jsonb,text)','cs.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_publish_review_event(uuid,integer,uuid)','marketing.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_revoke_review_event_award(uuid,uuid,text)','marketing.manage','manual',true);
select private.register_operator_rpc_contract('public.admin_list_review_events(text,text,text,date,date,integer,integer)','cs.manage','read',false);
select private.register_operator_rpc_contract('public.admin_get_review_event(uuid,integer,text,text)','cs.manage','read',false);
do $$ declare name text;begin
 foreach name in array array[
  'private.review_event_state(private.review_events,timestamptz)','private.review_event_values_valid(jsonb)','private.review_event_target_goods(uuid)',
  'private.review_event_purchase_eligible(uuid,uuid,text)','private.review_event_entry_problem(private.review_event_entries)','private.review_event_review_fingerprint(public.reviews)','private.capture_review_event_entry()',
  'private.review_event_document(uuid)','private.reverse_review_event_award(uuid,text,uuid)','private.reverse_review_event_order_awards(uuid,text)',
  'private.review_event_review_revocation()','private.review_event_purchase_revocation()','private.review_event_public_period(private.review_events,timestamptz)',
  'private.review_event_public_document(uuid)','public.get_review_events(integer)','public.get_review_event(uuid,integer)','public.get_goods_review_events(text[])',
  'public.get_review_event_disclosures(uuid[])','public.get_my_review_event_entries(uuid[])'
 ] loop perform private.register_operator_internal_contract(name::regprocedure);end loop;
end $$;
notify pgrst,'reload schema';

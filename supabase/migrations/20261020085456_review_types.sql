begin;
-- Ordinary review rights remain delivery + 90 days. Monthly creation is opt-in.
-- Existing repeat-purchase labels stay unknown; do not infer past write-time facts.
create table private.review_type_policy (
 singleton boolean primary key default true check(singleton), revision bigint not null default 1 check(revision>0),
 enabled boolean not null default false, basis text not null default 'delivered' check(basis in('delivered','confirmed')),
 start_days integer check(start_days between 30 and 365), end_days integer check(end_days between 30 and 730),
 max_order_days integer check(max_order_days between 1 and 1095), reward_eligible boolean not null default false,
 evidence text not null default '',updated_at timestamptz not null default clock_timestamp(),
 check(start_days is null or end_days is null or end_days>=start_days),
 check(not enabled or start_days is not null and end_days is not null)
);
insert into private.review_type_policy(singleton) values(true);
alter table private.review_type_policy enable row level security;
revoke all on private.review_type_policy from public,anon,authenticated,service_role;
alter table public.reviews add column review_kind text not null default 'ordinary' check(review_kind in('ordinary','month')),
 add column repeat_purchase boolean,add column write_deadline_at timestamptz,add column type_policy_revision bigint,
 add column month_reward_eligible boolean not null default false;
update public.reviews r set write_deadline_at=private.review_write_deadline(o.delivered_at) from public.orders o where o.id=r.order_id;
alter table public.reviews drop constraint reviews_order_good_user_unique;
alter table public.reviews add constraint reviews_order_good_user_kind_unique unique(order_id,good_id,user_id,review_kind);
create index reviews_kind_recent_idx on public.reviews(review_kind,created_at desc,id desc);

create function private.review_type_policy_document() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',revision,'enabled',enabled,'basis',basis,'startDays',start_days,'endDays',end_days,
  'maxOrderDays',max_order_days,'rewardEligible',reward_eligible,'evidence',evidence,'updatedAt',updated_at) from private.review_type_policy where singleton;
$$;
create function public.admin_get_review_type_policy() returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.require_operator_capability('cs.manage',false);return private.review_type_policy_document();end $$;
create function public.admin_save_review_type_policy(p_values jsonb,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare policy private.review_type_policy;prior public.audit_log;request jsonb;result jsonb;k text;begin
 if p_actor is null or p_actor is distinct from auth.uid() or p_session is null or auth.jwt()->>'session_id' is distinct from p_session::text then raise insufficient_privilege;end if;
 perform private.gift_lock_subjects(array[p_actor]);perform private.lock_operator_subjects(array[p_actor]);
 perform private.assert_active_user(p_actor);perform private.require_operator_capability('cs.manage',false);
 perform 1 from auth.sessions where id=p_session and user_id=p_actor and(not_after is null or not_after>clock_timestamp()) for share;
 if not found or private.is_account_write_fenced(p_actor) then raise insufficient_privilege;end if;
 if p_operation is null or p_revision is null or p_revision<1 or not private.transaction_json_keys(p_values,array['enabled','basis','startDays','endDays','maxOrderDays','rewardEligible','evidence','confirmed'])
 or jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or jsonb_typeof(p_values->'rewardEligible') is distinct from 'boolean'
 or coalesce(p_values->>'basis','') not in('delivered','confirmed') or p_values->'confirmed' is distinct from 'true'::jsonb
 or jsonb_typeof(p_values->'evidence') is distinct from 'string' or char_length(btrim(p_values->>'evidence')) not between 2 and 1000
 or (p_values->>'evidence')~'[[:cntrl:]]' then raise invalid_parameter_value;end if;
 foreach k in array array['startDays','endDays','maxOrderDays'] loop
  if p_values->k<>'null'::jsonb and (jsonb_typeof(p_values->k)<>'number' or p_values->>k!~'^[1-9][0-9]*$' or (p_values->>k)::numeric>1095) then raise invalid_parameter_value;end if;
 end loop;
 if (p_values->>'startDays')::integer not between 30 and 365 or (p_values->>'endDays')::integer not between 30 and 730
  or (p_values->>'endDays')::integer<(p_values->>'startDays')::integer
  or p_values->'enabled'='true'::jsonb and (p_values->'startDays'='null'::jsonb or p_values->'endDays'='null'::jsonb) then raise invalid_parameter_value;end if;
 select * into policy from private.review_type_policy where singleton for update;
 request:=jsonb_build_object('values',p_values,'revision',p_revision,'sessionId',p_session);
 select * into prior from public.audit_log where id=p_operation;
 if found then
  if prior.actor_id is distinct from p_actor or prior.action<>'admin.review_type.policy' or prior.diff->'request' is distinct from request then raise sqlstate 'PT409';end if;
  return prior.diff->'result';end if;
 if policy.revision<>p_revision then raise sqlstate 'PT409' using message='review_type_policy_changed';end if;
 if policy.reward_eligible is distinct from (p_values->>'rewardEligible')::boolean then perform private.require_operator_capability('marketing.manage',true);end if;
 update private.review_type_policy set revision=revision+1,enabled=(p_values->>'enabled')::boolean,basis=p_values->>'basis',start_days=(p_values->>'startDays')::integer,
  end_days=(p_values->>'endDays')::integer,max_order_days=(p_values->>'maxOrderDays')::integer,reward_eligible=(p_values->>'rewardEligible')::boolean,
  evidence=btrim(p_values->>'evidence'),updated_at=clock_timestamp() where singleton;
 result:=private.review_type_policy_document();
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation,p_actor,'admin.review_type.policy','review_type',jsonb_build_object('request',request,'result',result));return result;
end $$;

create function private.review_type_window(p_order public.orders,p_kind text) returns table(opens_at timestamptz,deadline_at timestamptz,policy_revision bigint,reward_eligible boolean)
language sql stable security definer set search_path='' as $$
 select case when p_kind='ordinary' then p_order.delivered_at else b.at+make_interval(days=>p.start_days) end,
 case when p_kind='ordinary' then private.review_write_deadline(p_order.delivered_at)
  else least(b.at+make_interval(days=>p.end_days),case when p.max_order_days is not null then p_order.created_at+make_interval(days=>p.max_order_days) end) end,
 case when p_kind='month' then p.revision end,p_kind='month' and p.reward_eligible
 from private.review_type_policy p cross join lateral(select case when p.basis='delivered' then p_order.delivered_at else
  (select confirmed_at from private.order_purchase_confirmations where order_id=p_order.id) end at)b
 where p.singleton and(p_kind='ordinary' or p_kind='month' and p.enabled and b.at is not null);
$$;
create function private.review_type_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare ordered public.orders;w record;begin
 if tg_op='UPDATE' then
  if (new.review_kind,new.repeat_purchase,new.write_deadline_at,new.type_policy_revision,new.month_reward_eligible) is distinct from
     (old.review_kind,old.repeat_purchase,old.write_deadline_at,old.type_policy_revision,old.month_reward_eligible) then raise check_violation using message='review_type_snapshot_immutable';end if;
  return new;
 end if;
 select * into ordered from public.orders where id=new.order_id;
 select * into w from private.review_type_window(ordered,new.review_kind);
 if new.review_kind='month' and (w.opens_at is null or statement_timestamp()<w.opens_at or statement_timestamp()>w.deadline_at) then
  raise check_violation using message='review_month_window_closed';end if;
 new.write_deadline_at:=w.deadline_at;new.type_policy_revision:=w.policy_revision;new.month_reward_eligible:=coalesce(w.reward_eligible,false);
 new.repeat_purchase:=exists(select 1 from public.orders prior join public.order_items i on i.order_id=prior.id
  where prior.id<>ordered.id and prior.user_id=new.user_id and i.good_id=new.good_id and prior.created_at<ordered.created_at
  and prior.status in('delivered','done') and prior.delivered_at between statement_timestamp()-interval '180 days' and statement_timestamp()
  and private.review_event_purchase_eligible(prior.id,new.user_id,new.good_id));
 return new;
end $$;
create trigger review_type_snapshot before insert or update on public.reviews for each row execute function private.review_type_snapshot();

create function public.create_good_review_v2(target_order_id uuid,target_good_id text,target_rating integer,target_body text,target_image_paths text[] default '{}',target_kind text default 'ordinary') returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();ordered public.orders;w record;paths text[];created uuid;begin
 if actor is null then raise invalid_authorization_specification using message='auth_required';end if;
 perform private.gift_lock_subjects(array[actor]);perform private.lock_operator_subjects(array[actor]);
 perform private.assert_active_user(actor);if private.is_account_write_fenced(actor) then raise insufficient_privilege;end if;
 if target_kind is null or target_kind not in('ordinary','month') then raise invalid_parameter_value using message='invalid_review_kind';end if;
 if target_rating is null or target_rating not between 1 and 5 then raise invalid_parameter_value using message='invalid_review_rating';end if;
 if char_length(btrim(coalesce(target_body,''))) not between 5 and 1000 then raise invalid_parameter_value using message='invalid_review_body';end if;
 select * into ordered from public.orders where id=target_order_id and user_id=actor for update;
 if not found then raise no_data_found using message='review_order_not_found';end if;
 if ordered.status not in('delivered','done') or ordered.delivered_at is null then raise check_violation using message='review_order_not_delivered';end if;
 if not exists(select 1 from public.order_items where order_id=ordered.id and good_id=target_good_id) then raise no_data_found using message='review_good_not_in_order';end if;
 if not private.review_event_purchase_eligible(ordered.id,actor,target_good_id) then raise check_violation using message='review_purchase_ineligible';end if;
 -- Share policy after order locks; policy edits never lock orders.
 perform 1 from private.review_type_policy where singleton for share;
 select * into w from private.review_type_window(ordered,target_kind);
 if w.opens_at is null or statement_timestamp()<w.opens_at or statement_timestamp()>w.deadline_at then
  raise check_violation using message=case when target_kind='month' then 'review_month_window_closed' else 'review_window_closed' end;end if;
 paths:=private.assert_own_review_image_paths(target_image_paths,actor);
 begin
  insert into public.reviews(user_id,good_id,order_id,rating,body,image_paths,review_kind) values(actor,target_good_id,ordered.id,target_rating,btrim(target_body),paths,target_kind) returning id into created;
 exception when unique_violation then raise unique_violation using message='review_already_exists';end;
 return created;
end $$;
create or replace function public.create_good_review(target_order_id uuid,target_good_id text,target_rating integer,target_body text,target_image_paths text[] default '{}') returns uuid
language sql security definer set search_path='' as $$select public.create_good_review_v2(target_order_id,target_good_id,target_rating,target_body,target_image_paths,'ordinary');$$;
CREATE OR REPLACE FUNCTION public.update_good_review(target_review_id uuid, target_rating integer, target_body text, target_image_paths text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_body text := btrim(coalesce(target_body, ''));
  v_paths text[];
  v_status text;
  v_order_id uuid;
  v_delivered_at timestamptz;
  v_deadline timestamptz;
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  perform private.gift_lock_subjects(array[v_actor]);
  perform private.lock_operator_subjects(array[v_actor]);
  perform private.assert_active_user(v_actor);
  if private.is_account_write_fenced(v_actor) then raise insufficient_privilege;end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = v_actor
      and profile.suspended_at is not null
  ) then
    raise insufficient_privilege using message = 'account_suspended';
  end if;

  if target_rating is null or target_rating not between 1 and 5 then
    raise invalid_parameter_value using message = 'invalid_review_rating';
  end if;
  if char_length(v_body) not between 5 and 1000 then
    raise invalid_parameter_value using message = 'invalid_review_body';
  end if;

  select order_id into v_order_id from public.reviews where id=target_review_id and user_id=v_actor;
  perform 1 from public.orders where id=v_order_id for update;
  select review.status, review.order_id, review.write_deadline_at
    into v_status, v_order_id, v_deadline
  from public.reviews as review
  where review.id = target_review_id
    and review.user_id = v_actor
  for update;

  if not found then
    raise no_data_found using message = 'review_not_found';
  end if;
  if v_status <> 'visible' then
    raise insufficient_privilege using message = 'review_hidden';
  end if;

  select target.delivered_at
    into v_delivered_at
  from public.orders as target
  where target.id = v_order_id;

  if v_delivered_at is null or now() > coalesce(v_deadline,private.review_write_deadline(v_delivered_at)) then
    raise check_violation using message = 'review_window_closed';
  end if;

  if not exists(select 1 from public.reviews r where r.id=target_review_id and private.review_event_purchase_eligible(r.order_id,r.user_id,r.good_id)) then raise check_violation using message='review_purchase_ineligible';end if;
  v_paths := private.assert_own_review_image_paths(target_image_paths, v_actor);

  update public.reviews
  set
    rating = target_rating::smallint,
    body = v_body,
    image_paths = v_paths,
    edited_at = now()
  where id = target_review_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.my_review_targets(target_order_id uuid DEFAULT NULL::uuid, target_good_id text DEFAULT NULL::text, target_limit integer DEFAULT 50)
 RETURNS TABLE(order_id uuid, good_id text, good_name text, good_bg text, good_image_path text, ordered_at timestamp with time zone, delivered_at timestamp with time zone, deadline_at timestamp with time zone, writable boolean, review_id uuid, review_rating smallint, review_body text, review_image_paths text[], review_status text, review_created_at timestamp with time zone, review_edited_at timestamp with time zone, admin_reply text, admin_reply_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(target_limit, 50), 1), 200);
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  return query
  select
    ordered.id as order_id,
    item.good_id,
    good.name as good_name,
    good.bg as good_bg,
    good.image_path as good_image_path,
    ordered.created_at as ordered_at,
    ordered.delivered_at,
    private.review_write_deadline(ordered.delivered_at) as deadline_at,
    (
      review.id is null
      and ordered.delivered_at is not null
      and now() <= private.review_write_deadline(ordered.delivered_at)
    ) as writable,
    review.id as review_id,
    review.rating as review_rating,
    review.body as review_body,
    review.image_paths as review_image_paths,
    review.status as review_status,
    review.created_at as review_created_at,
    review.edited_at as review_edited_at,
    review.admin_reply,
    review.admin_reply_at
  from public.orders as ordered
  join public.order_items as item on item.order_id = ordered.id
  join public.goods as good on good.id = item.good_id
  left join public.reviews as review
    on review.order_id = ordered.id
    and review.good_id = item.good_id
    and review.user_id = v_actor
    and review.review_kind = 'ordinary'
  where ordered.user_id = v_actor
    and ordered.status in ('delivered', 'done')
    and (target_order_id is null or ordered.id = target_order_id)
    and (target_good_id is null or item.good_id = target_good_id)
  /* 쓸 수 있는 것이 먼저, 그중에서도 기한이 임박한 것이 위로. */
  order by
    case when review.id is null then 0 else 1 end,
    ordered.delivered_at desc nulls last,
    item.good_id
  limit v_limit;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.my_review_targets_v2(target_order_id uuid DEFAULT NULL::uuid, target_good_id text DEFAULT NULL::text, target_limit integer DEFAULT 50)
 RETURNS TABLE(order_id uuid, good_id text, good_name text, good_bg text, good_image_path text, ordered_at timestamp with time zone, delivered_at timestamp with time zone, deadline_at timestamp with time zone, writable boolean, review_id uuid, review_rating smallint, review_body text, review_image_paths text[], review_status text, review_created_at timestamp with time zone, review_edited_at timestamp with time zone, admin_reply text, admin_reply_at timestamp with time zone, review_kind text, opens_at timestamp with time zone, editable boolean, month_reward_eligible boolean, repeat_purchase boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(target_limit, 50), 1), 200);
begin
  if v_actor is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  return query
  select
    ordered.id as order_id,
    item.good_id,
    good.name as good_name,
    good.bg as good_bg,
    good.image_path as good_image_path,
    ordered.created_at as ordered_at,
    ordered.delivered_at,
    coalesce(review.write_deadline_at,w.deadline_at) as deadline_at,
    (
      review.id is null
      and ordered.delivered_at is not null
      and now() between w.opens_at and w.deadline_at
      and private.review_event_purchase_eligible(ordered.id,v_actor,item.good_id)
      and not private.is_account_write_fenced(v_actor)
    ) as writable,
    review.id as review_id,
    review.rating as review_rating,
    review.body as review_body,
    review.image_paths as review_image_paths,
    review.status as review_status,
    review.created_at as review_created_at,
    review.edited_at as review_edited_at,
    review.admin_reply,
    review.admin_reply_at,kind.value,w.opens_at,
    review.id is not null and review.status='visible' and now()<=coalesce(review.write_deadline_at,w.deadline_at) and private.review_event_purchase_eligible(ordered.id,v_actor,item.good_id) and not private.is_account_write_fenced(v_actor),
    coalesce(review.month_reward_eligible,w.reward_eligible,false),review.repeat_purchase
  from public.orders as ordered
  join (select distinct order_id,good_id from public.order_items) as item on item.order_id = ordered.id
  join public.goods as good on good.id = item.good_id
  cross join (values('ordinary'::text),('month'::text)) kind(value)
  left join lateral private.review_type_window(ordered,kind.value)w on true
  left join public.reviews as review
    on review.order_id = ordered.id
    and review.good_id = item.good_id
    and review.user_id = v_actor
    and review.review_kind = kind.value
  where ordered.user_id = v_actor
    and ordered.status in ('delivered', 'done')
    and(kind.value='ordinary' or w.opens_at is not null or review.id is not null)
    and (target_order_id is null or ordered.id = target_order_id)
    and (target_good_id is null or item.good_id = target_good_id)
  /* 쓸 수 있는 것이 먼저, 그중에서도 기한이 임박한 것이 위로. */
  order by
    case when review.id is null then 0 else 1 end,
    ordered.delivered_at desc nulls last,
    item.good_id
  limit v_limit;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.capture_review_event_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare event private.review_events%rowtype; delivery timestamptz;
begin
 if new.review_kind='month' and not new.month_reward_eligible then return new;end if;
 if new.status<>'visible' or not private.review_event_purchase_eligible(new.order_id,new.user_id,new.good_id) then return new;end if;
 select delivered_at into delivery from public.orders where id=new.order_id;
 if delivery is null or new.created_at>coalesce(new.write_deadline_at,private.review_write_deadline(delivery)) or new.created_at<delivery then return new;end if;
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
end $function$
;
CREATE OR REPLACE FUNCTION private.queue_review_best_reward()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare review public.reviews; policy private.customer_reward_policy; credit private.store_credit_policy; snapshot jsonb:='{}';
begin
 select * into review from public.reviews where id=new.review_id;
 if not found then return new;end if;
 select * into policy from private.customer_reward_policy where singleton;
 select * into credit from private.store_credit_policy where singleton;
 if policy.best_enabled and credit.enabled and (review.review_kind='ordinary' or review.month_reward_eligible) then
  snapshot:=jsonb_build_object('enabled',true,'revision',policy.revision,'amount',policy.best_amount,'validityDays',policy.best_validity_days,
   'reversal',policy.best_reversal,'maxBalance',credit.max_balance);
 end if;
 insert into private.review_best_reward_jobs(review_id,order_id,user_id,selection_revision,selected,policy_snapshot,actor_id)
  values(new.review_id,review.order_id,review.user_id,new.revision,new.selected and new.invalidated_at is null,snapshot,new.updated_by) on conflict do nothing;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.get_good_group_reviews_v3(p_good_id text, p_sort text DEFAULT 'recent'::text, p_photo_only boolean DEFAULT false, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_kind text DEFAULT 'all', p_repeat text DEFAULT 'all')
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ids text[];result jsonb;viewer uuid:=private.review_helpful_viewer_id();viewer_active boolean:=private.review_helpful_actor_is_active(viewer);
begin
 if p_kind is null or p_kind not in('all','ordinary','month') or p_repeat is null or p_repeat not in('all','yes','no','unknown') then raise invalid_parameter_value;end if;
 if p_sort is null or p_sort not in('recent','rating_desc','rating_asc','helpful_desc') or p_photo_only is null
  or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 1000000 then
  raise invalid_parameter_value using message='invalid_goods_group_review_page';end if;
 ids:=private.goods_group_review_good_ids(p_good_id);
 with visible as materialized (
  select r.review_kind,r.repeat_purchase,r.id,r.good_id,r.order_id,r.rating,r.body,r.image_paths,r.user_id,r.created_at,r.edited_at,r.admin_reply,r.admin_reply_at,helpful.helpful_count,helpful.helpful_by_me,
   coalesce(nullif(btrim(author.nickname),''),'fan_'||left(r.user_id::text,6)) author_name,
   coalesce((select item.good_name_snapshot from public.order_items item where item.order_id=r.order_id and item.good_id=r.good_id order by item.id limit 1),g.name) good_name,
   coalesce((select array_agg(distinct item.variant_name_snapshot order by item.variant_name_snapshot) from public.order_items item
    where item.order_id=r.order_id and item.good_id=r.good_id and item.variant_name_snapshot is not null),'{}'::text[]) variant_names
  from public.reviews r join public.profiles author on author.id=r.user_id join public.goods g on g.id=r.good_id
  cross join lateral(select count(*)::bigint helpful_count,coalesce(bool_or(v.user_id=viewer),false) helpful_by_me
   from private.review_helpful_votes v where v.review_id=r.id) helpful
  where r.good_id=any(ids) and r.status='visible'
 ), filtered as materialized (
  select * from visible where (not p_photo_only or cardinality(image_paths)>0) and(p_kind='all' or review_kind=p_kind)
  and(p_repeat='all' or p_repeat='yes' and repeat_purchase is true or p_repeat='no' and repeat_purchase is false or p_repeat='unknown' and repeat_purchase is null)
 ), page as (
  select * from filtered order by case when p_sort='helpful_desc' then helpful_count end desc nulls last,case when p_sort='rating_desc' then rating end desc nulls last,
    case when p_sort='rating_asc' then rating end asc nulls last,created_at desc,id desc limit p_limit offset p_offset
 ) select jsonb_build_object('viewerAuthenticated',viewer is not null,'grouped',exists(select 1 from private.goods_group_members where good_id=p_good_id) and cardinality(ids)>0,
  'summary',(select jsonb_build_object('count',count(*),'average',coalesce(round(avg(rating),2),0),
   'distribution',jsonb_build_array(count(*) filter(where rating=1),count(*) filter(where rating=2),count(*) filter(where rating=3),count(*) filter(where rating=4),count(*) filter(where rating=5)),
   'photoCount',count(*) filter(where cardinality(image_paths)>0)) from visible),
  'total',(select count(*) from filtered),
  'reviews',coalesce((select jsonb_agg(jsonb_build_object('kind',review_kind,'repeatPurchase',repeat_purchase,'id',id,'goodId',good_id,'goodName',good_name,'variantNames',to_jsonb(variant_names),
   'rating',rating,'body',body,'imagePaths',to_jsonb(coalesce(image_paths,'{}'::text[])),'authorName',author_name,
   'helpfulCount',helpful_count,'helpfulByMe',helpful_by_me,'canMarkHelpful',viewer_active and user_id<>viewer,'isMine',auth.uid() is not null and user_id=auth.uid(),'createdAt',created_at,'editedAt',edited_at,'adminReply',admin_reply,'adminReplyAt',admin_reply_at)
   order by case when p_sort='helpful_desc' then helpful_count end desc nulls last,case when p_sort='rating_desc' then rating end desc nulls last,
    case when p_sort='rating_asc' then rating end asc nulls last,created_at desc,id desc) from page),'[]'::jsonb)) into result;
 return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_search_reviews_typed(p_review_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_rating integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_has_photo boolean DEFAULT NULL::boolean, p_has_reply boolean DEFAULT NULL::boolean, p_low_rating boolean DEFAULT false, p_query text DEFAULT NULL::text, p_field text DEFAULT 'all'::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_best text DEFAULT 'all'::text,p_kind text DEFAULT 'all',p_repeat text DEFAULT 'all')
 RETURNS TABLE(id uuid, good_id text, good_name text, order_id uuid, user_id uuid, author_name text, author_email text, rating smallint, body text, image_paths text[], status text, hidden_reason text, hidden_at timestamp with time zone, admin_reply text, admin_reply_at timestamp with time zone, reply_author_name text, report_count bigint, open_report_count bigint, created_at timestamp with time zone, edited_at timestamp with time zone, total_count bigint, best_selection jsonb, helpful_count bigint, review_kind text, repeat_purchase boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(coalesce(p_field, '')), ''), 'all');
  v_sort text := coalesce(nullif(btrim(coalesce(p_sort, '')), ''), 'recent');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_operator_capability('cs.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('cs.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if p_status is not null and p_status not in ('visible', 'hidden') then
    raise check_violation using message = 'invalid_review_status_filter';
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    raise check_violation using message = 'invalid_review_rating_filter';
  end if;
  if v_field not in ('all', 'good', 'author', 'body') then
    raise check_violation using message = 'invalid_review_search_field';
  end if;
  if v_sort not in ('recent', 'oldest', 'rating_desc', 'rating_asc', 'good_name_asc', 'photo_count_desc', 'helpful_desc') then
    raise check_violation using message = 'invalid_review_sort';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid_review_date_range';
  end if;
  if v_query is not null and char_length(v_query) > 100 then
    raise check_violation using message = 'review_search_query_too_long';
  end if;

  if p_best is null or p_best not in ('all','selected','not_selected','needs_review') then raise invalid_parameter_value using message='invalid_best_review_filter';end if;
  if p_kind is null or p_kind not in('all','ordinary','month') or p_repeat is null or p_repeat not in('all','yes','no','unknown') then raise invalid_parameter_value;end if;
  return query
  select
    review.id,
    review.good_id,
    good.name as good_name,
    review.order_id,
    review.user_id,
    coalesce(
      nullif(btrim(coalesce(author.nickname, '')), ''),
      'fan_' || left(review.user_id::text, 6)
    ) as author_name,
    author.email as author_email,
    review.rating,
    review.body,
    review.image_paths,
    review.status,
    review.hidden_reason,
    review.hidden_at,
    review.admin_reply,
    review.admin_reply_at,
    replier.nickname as reply_author_name,
    (
      select count(*)
      from public.reports as report
      where report.target_type = 'review'
        and report.target_id = review.id::text
    ) as report_count,
    (
      select count(*)
      from public.reports as report
      where report.target_type = 'review'
        and report.target_id = review.id::text
        and report.status in ('open', 'reviewing')
    ) as open_report_count,
    review.created_at,
    review.edited_at,
    count(*) over()::bigint as total_count,
    private.review_best_state(review) as best_selection,
    helpful.helpful_count,review.review_kind,review.repeat_purchase
  from public.reviews as review
  join public.goods as good on good.id = review.good_id
  cross join lateral(select count(*)::bigint helpful_count from private.review_helpful_votes vote where vote.review_id=review.id) helpful
  join public.profiles as author on author.id = review.user_id
  left join public.profiles as replier on replier.id = review.admin_reply_by
  where(p_kind='all' or review.review_kind=p_kind) and(p_repeat='all' or p_repeat='yes' and review.repeat_purchase is true or p_repeat='no' and review.repeat_purchase is false or p_repeat='unknown' and review.repeat_purchase is null)
    and (p_review_id is null or review.id = p_review_id)
    and (p_best='all' or (p_best='not_selected' and not exists(select 1 from private.review_best_selections selection where selection.review_id=review.id and selection.selected)) or (p_best in ('selected','needs_review') and exists(select 1 from private.review_best_selections selection where selection.review_id=review.id and selection.selected and private.review_best_state(review)->>'state'=p_best)))
    and (p_status is null or review.status = p_status)
    and (p_rating is null or review.rating = p_rating)
    and (not coalesce(p_low_rating, false) or review.rating <= 2)
    and (
      p_has_photo is null
      or (p_has_photo and coalesce(cardinality(review.image_paths),0) > 0)
      or (not p_has_photo and coalesce(cardinality(review.image_paths),0) = 0)
    )
    and (
      p_has_reply is null
      or (p_has_reply and review.admin_reply is not null)
      or (not p_has_reply and review.admin_reply is null)
    )
    and (
      p_from is null
      or review.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or review.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or (
        v_field in ('all', 'good')
        and (
          position(lower(v_query) in lower(good.name)) > 0
          or position(lower(v_query) in lower(review.good_id)) > 0
        )
      )
      or (
        v_field in ('all', 'author')
        and (
          position(lower(v_query) in lower(coalesce(author.nickname, ''))) > 0
          or position(lower(v_query) in lower(coalesce(author.email, ''))) > 0
        )
      )
      or (
        v_field in ('all', 'body')
        and position(lower(v_query) in lower(review.body)) > 0
      )
    )
  order by
    case when v_sort = 'helpful_desc' then helpful.helpful_count end desc nulls last,
    case when v_sort = 'good_name_asc' then good.name end asc nulls last,
    case when v_sort = 'photo_count_desc' then coalesce(cardinality(review.image_paths),0) end desc nulls last,
    case when v_sort = 'rating_desc' then review.rating end desc nulls last,
    case when v_sort = 'rating_asc' then review.rating end asc nulls last,
    case when v_sort = 'oldest' then review.created_at end asc nulls last,
    review.created_at desc,
    review.id desc
  limit v_limit
  offset v_offset;
end;
$function$
;
revoke all on function private.review_type_policy_document() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.review_type_policy_document()'::regprocedure);
revoke all on function private.review_type_window(public.orders,text) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.review_type_window(public.orders,text)'::regprocedure);
revoke all on function private.review_type_snapshot() from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.review_type_snapshot()'::regprocedure);
revoke all on function public.admin_get_review_type_policy() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_review_type_policy() to authenticated;
select private.register_operator_rpc_contract('public.admin_get_review_type_policy()'::regprocedure,'cs.manage','read',false);
revoke all on function public.admin_save_review_type_policy(jsonb,bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_review_type_policy(jsonb,bigint,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_save_review_type_policy(jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'cs.manage','manual',false);
revoke all on function public.create_good_review_v2(uuid,text,integer,text,text[],text) from public,anon,authenticated,service_role;
grant execute on function public.create_good_review_v2(uuid,text,integer,text,text[],text) to authenticated;
revoke all on function public.my_review_targets_v2(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.my_review_targets_v2(uuid,text,integer) to authenticated;
revoke all on function public.get_good_group_reviews_v3(text,text,boolean,integer,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_good_group_reviews_v3(text,text,boolean,integer,integer,text,text) to anon,authenticated;
revoke all on function public.admin_search_reviews_typed(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_reviews_typed(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text,text,text) to authenticated;
select private.register_operator_rpc_contract('public.admin_search_reviews_typed(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text,text,text)'::regprocedure,'cs.manage','read',false);
notify pgrst,'reload schema';
commit;

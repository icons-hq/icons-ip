-- QNA-040(원장 재작업 T14d, 11/11 결정 "상품 단위 일괄 안내"): 예약 상품의 발송 예정일이 바뀌면 그 상품의 미출고 예약 배송 건
-- 일정을 한 번에 바꾸고, 미리보기 뒤 주문 고객에게 앱 알림·이메일로 안내한다. 기존 지연 안내 원장(order_delay_notices)을 그대로 쓴다.
--
-- 이 migration 뒤의 규칙:
--  · 대상 = 그 상품의 예약 품목이 든 미출고 배송 건 전부. 옵션 선택 판매는 옵션 하나로 좁힐 수 있고(기본은 상품 전체),
--    랜덤 판매는 옵션마다 일정이 다르면 배정 옵션이 드러나므로 언제나 상품 전체다(ADR-0027).
--    출고지시·발송·취소된 건, 취소 처리 중인 주문, 이미 같은 날짜인 건은 바꾸지 않고 미리보기에 제외 사유를 보인다.
--    다른 예약 상품과 함께 묶인 배송 건은 그 상품들의 주문 당시 예정일보다 앞당기지 않고, 앞당겨야 하면 제외한다.
--    운영자가 배송 건마다 바꾼 건(개별 변경)은 표시하고 기본 포함한다 — 화면에서 뺄 수 있다.
--  · 확정(admin_apply_goods_preorder_schedule_change)은 요청 UUID 하나로 멱등이다. 같은 요청을 다시 보내면 처음 결과를 돌려주고
--    일정·알림을 다시 만들지 않는다. 미리보기 뒤 대상이 바뀌면(새 주문·배송 건 변경·다른 일괄 변경) 미리보기 지문이 달라져 거절한다.
--  · 배송 건마다 일정 변경 이력(order_shipment_promise_changes.bulk_change_id)과 주문 감사 기록을, 주문마다 지연 안내 원장의 대상 행
--    (kind='preorder_schedule')을 남기고 admin_request_order_delay_notice로 앱 알림·이메일을 요청한다. 이메일 발송 설정이 꺼져
--    있으면 일정도 바꾸지 않는다(두 채널 최초 요청을 막는 지연 안내 계약과 같다).
--  · SMS는 DB 설정(order_delay_notice_delivery_control.sms_enabled)과 앱의 SMS 알림 스위치가 모두 켜졌을 때만 대기열에 넣고,
--    보낼 때 대상 변경·SMS 수신 동의를 다시 확인한다(인증된 번호는 SMS 알림 seam이 확인한다). 둘 다 기본 꺼짐이다.
--    SMS 발송사에는 멱등 키가 없어 한 대상에 한 번만 시도하고, 결과를 모르면 다시 보내지 않는다.
--  · 지연 탭의 '지연 안내 결과'는 발송 지연 안내만 센다. 일정 변경 안내는 지연 안내 이력에는 함께 남는다.
begin;

-- 1) 지연 안내 원장에 안내 종류를 더한다. 일정 변경 안내는 상품의 예약 배송 건 전체를 한 번에 담는다.
alter table private.order_delay_notices add column kind text not null default 'dispatch_delay';
alter table private.order_delay_notices add constraint order_delay_notices_kind_check check (kind in ('dispatch_delay','preorder_schedule'));
alter table private.order_delay_notices drop constraint order_delay_notices_shipment_ids_check;
alter table private.order_delay_notices add constraint order_delay_notices_shipment_ids_check
  check (cardinality(shipment_ids)>=1 and cardinality(shipment_ids)<=case when kind='preorder_schedule' then 2000 else 100 end);

-- 2) SMS 함께 보내기 DB 설정(기본 꺼짐). 앱 SMS 알림 스위치만으로는 켜지지 않는다.
alter table private.order_delay_notice_delivery_control add column sms_enabled boolean not null default false;

-- 3) 상품 단위 예약 일정 일괄 변경 기록. id는 화면이 만든 요청 UUID(멱등 키)다. 고객 문구는 지연 안내 원장에만 둔다.
create table private.goods_preorder_schedule_changes (
  id uuid primary key,
  good_id text not null references public.goods(id) on update cascade on delete restrict,
  variant_id uuid references public.goods_variants(id) on delete restrict,
  to_date date not null,
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  notice_id uuid not null unique references private.order_delay_notices(id) on delete restrict,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{32}$'),
  preview_fingerprint text not null check (preview_fingerprint ~ '^[0-9a-f]{32}$'),
  excluded_shipment_ids uuid[] not null default '{}',
  shipment_count integer not null check (shipment_count between 1 and 2000),
  order_count integer not null check (order_count between 1 and 2000),
  sms_queued boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index goods_preorder_schedule_changes_good on private.goods_preorder_schedule_changes(good_id,created_at desc,id);
alter table private.goods_preorder_schedule_changes enable row level security;
revoke all on private.goods_preorder_schedule_changes from public,anon,authenticated,service_role;

-- 배송 건 일정 변경 이력이 어느 일괄 변경에서 왔는지. 비어 있으면 주문 상세에서 배송 건마다 바꾼 개별 변경이다.
alter table private.order_shipment_promise_changes add column bulk_change_id uuid
  references private.goods_preorder_schedule_changes(id) on delete restrict;
create index order_shipment_promise_changes_bulk on private.order_shipment_promise_changes(bulk_change_id) where bulk_change_id is not null;

-- 4) 일정 변경 안내의 SMS 대기열(대상 행마다 한 번). 본문·번호는 남기지 않는다 — 본문은 안내 대상 행의 고객 문구다.
create table private.order_delay_notice_sms_jobs (
  target_id uuid primary key references private.order_delay_notice_targets(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed','unknown','skipped')),
  reason text check (reason is null or reason in ('sms_disabled','consent_required','no_verified_phone','account_unavailable',
    'target_changed','expired','provider_unavailable','invalid_body','lease_expired')),
  claim_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  check ((status='processing')=(claim_token is not null and lease_until is not null)),
  check ((status='sent')=(sent_at is not null))
);
create index order_delay_notice_sms_queue on private.order_delay_notice_sms_jobs(created_at,target_id) where status in ('queued','processing');
alter table private.order_delay_notice_sms_jobs enable row level security;
revoke all on private.order_delay_notice_sms_jobs from public,anon,authenticated,service_role;

-- 5) 일정 변경 안내 대상의 현재 상태. 발송 지연 안내와 달리 결제 대기 주문·약속일 전 배송 건도 대상이다.
--    결제 상태가 바뀌어도(입금 확인·발주확인) 안내는 유효하고, 배송 건이 나가거나 일정이 다시 바뀌면 낡은 안내가 된다.
create function private.preorder_schedule_notice_snapshot(target_order uuid,target_shipments uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('buyerId',o.user_id,
  'shipments',(select jsonb_agg(jsonb_build_object('id',s.id,'expectedShipDate',s.expected_ship_date) order by s.id)
    from public.order_shipments s where s.order_id=o.id and s.id=any(target_shipments)))
 from public.orders o
 where o.id=target_order and o.status in ('pending','paid','confirmed','shipping')
  and not exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id)
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and c.status in ('requested','processing','needs_review'))
  and cardinality(target_shipments)>0
  and (select count(*) from public.order_shipments s where s.order_id=o.id and s.id=any(target_shipments)
    and s.status='ready' and s.original_expected_ship_date is not null)=cardinality(target_shipments)
$$;
alter function private.preorder_schedule_notice_snapshot(uuid,uuid[]) owner to postgres;
revoke all on function private.preorder_schedule_notice_snapshot(uuid,uuid[]) from public,anon,authenticated,service_role;

-- 지연 안내 원장의 요청·재시도·이메일 결속이 안내 종류에 맞는 스냅샷으로 대상 변경을 판정한다(앵커 1곳).
do $patch$
declare definition text:=pg_get_functiondef('private.order_delay_notice_target_current(uuid)'::regprocedure);
  anchor text:='t.snapshot=private.order_delay_notice_snapshot(t.order_id,t.shipment_ids)';
begin
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'delay_notice_target_current_anchor_changed'; end if;
  execute replace(definition,anchor,'t.snapshot=case when n.kind=''preorder_schedule'' then private.preorder_schedule_notice_snapshot(t.order_id,t.shipment_ids)'
    ||' else private.order_delay_notice_snapshot(t.order_id,t.shipment_ids) end');
end $patch$;

-- 지연 탭의 '지연 안내 결과'·안내여부 필터는 발송 지연 안내만 센다. 약속일 전에 보낸 일정 변경 안내가
-- 그 뒤 다시 늦어진 배송 건의 '미발송'을 가리지 않게 한다(앵커 1곳).
do $patch$
declare definition text:=pg_get_functiondef('private.shipment_delay_notice_summary(uuid)'::regprocedure);
  anchor text:='join private.order_delay_notices n on n.id=t.notice_id and n.requested_at is not null';
begin
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipment_delay_notice_summary_anchor_changed'; end if;
  execute replace(definition,anchor,anchor||' and n.kind=''dispatch_delay''');
end $patch$;

-- 6) 대상 범위 검증. 상품·옵션·날짜가 맞지 않으면 미리보기와 확정 모두 같은 이유로 거절한다.
create function private.goods_preorder_schedule_scope(p_good_id text,p_variant_id uuid,p_to_date date)
returns public.goods language plpgsql stable security definer set search_path='' as $$
declare good public.goods;
begin
  if p_good_id is null or p_to_date is null or p_to_date<(statement_timestamp() at time zone 'Asia/Seoul')::date then
    raise invalid_parameter_value using message='invalid_preorder_schedule_change';
  end if;
  select * into good from public.goods where id=p_good_id;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if p_variant_id is not null then
    if good.option_sale_mode='random' then raise check_violation using message='preorder_schedule_random_whole_good'; end if;
    if not exists(select 1 from public.goods_variants where id=p_variant_id and good_id=good.id) then
      raise no_data_found using message='goods_variant_not_found';
    end if;
  end if;
  return good;
end $$;
alter function private.goods_preorder_schedule_scope(text,uuid,date) owner to postgres;
revoke all on function private.goods_preorder_schedule_scope(text,uuid,date) from public,anon,authenticated,service_role;

-- 7) 대상·제외 계획. 미리보기와 확정(잠근 뒤)이 같은 계산을 쓴다. 지문은 대상 배송 건·버전·새 날짜로 만든다.
--    버전은 세션 시간대와 무관하게 마이크로초 정수로 쓴다.
create function private.goods_preorder_schedule_plan(p_good_id text,p_variant_id uuid,p_to_date date)
returns jsonb language sql stable security definer set search_path='' as $$
 with scoped as (
  select distinct link.shipment_id
  from public.goods_variants v
  join public.order_items item on item.variant_id=v.id and item.good_id=v.good_id
  join public.order_shipment_items link on link.order_id=item.order_id and link.order_item_id=item.id
  where v.good_id=p_good_id and (p_variant_id is null or v.id=p_variant_id) and item.supply_source='preorder'
 ), base as (
  select s.id shipment_id,s.order_id,o.order_number,o.status::text order_status,o.payment_method::text payment_method,
   coalesce(s.shipment_number,upper(right(s.id::text,8))) shipment_label,s.origin_name_snapshot origin_name,
   s.status shipment_status,s.exported_at,s.original_expected_ship_date original_date,s.expected_ship_date current_date_value,
   (extract(epoch from s.updated_at)*1000000)::bigint version,
   (select max(other.preorder_expected_ship_date) from public.order_shipment_items other_link
     join public.order_items other on other.order_id=other_link.order_id and other.id=other_link.order_item_id
     where other_link.shipment_id=s.id and other.supply_source='preorder'
      and not (other.good_id=p_good_id and (p_variant_id is null or other.variant_id=p_variant_id))) other_bound,
   (select change.bulk_change_id is null from private.order_shipment_promise_changes change where change.shipment_id=s.id
     order by change.created_at desc,change.id desc limit 1) individually_changed,
   exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and c.status in ('requested','processing','needs_review'))
    or exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id) cancellation
  from scoped join public.order_shipments s on s.id=scoped.shipment_id join public.orders o on o.id=s.order_id
 ), planned as (
  select b.*,greatest(p_to_date,b.other_bound) new_date,
   case
    when b.order_status='canceled' or b.shipment_status='canceled' then 'canceled'
    when b.shipment_status in ('shipping','delivered') then 'shipped'
    when b.exported_at is not null then 'exported'
    when b.cancellation then 'cancellation_in_progress'
    when b.order_status not in ('pending','paid','confirmed','shipping') or b.original_date is null then 'not_open'
    when greatest(p_to_date,b.other_bound)=b.current_date_value then 'unchanged'
    when b.other_bound is not null and greatest(p_to_date,b.other_bound)<b.current_date_value then 'other_preorder'
   end reason
  from base b
 )
 select jsonb_build_object(
  'targets',coalesce((select jsonb_agg(jsonb_build_object('shipmentId',p.shipment_id,'orderId',p.order_id,'orderNumber',p.order_number,
    'shipmentLabel',p.shipment_label,'originName',p.origin_name,'orderStatus',p.order_status,'paymentMethod',p.payment_method,
    'currentDate',p.current_date_value,'originalDate',p.original_date,'newDate',p.new_date,
    'individuallyChanged',coalesce(p.individually_changed,false),'otherPreorder',p.other_bound is not null,'version',p.version)
    order by p.order_number,p.shipment_label,p.shipment_id) from planned p where p.reason is null),'[]'::jsonb),
  'excluded',coalesce((select jsonb_agg(row_value order by sort_key) from (
    select jsonb_build_object('shipmentId',p.shipment_id,'orderId',p.order_id,'orderNumber',p.order_number,'shipmentLabel',p.shipment_label,
      'originName',p.origin_name,'orderStatus',p.order_status,'currentDate',p.current_date_value,'reason',p.reason) row_value,
      array_position(array['cancellation_in_progress','other_preorder','unchanged','exported','not_open','shipped','canceled'],p.reason)::text
       ||':'||p.order_number||':'||p.shipment_label sort_key
    from planned p where p.reason is not null
    order by array_position(array['cancellation_in_progress','other_preorder','unchanged','exported','not_open','shipped','canceled'],p.reason),
     p.order_number,p.shipment_label limit 500) shown),'[]'::jsonb),
  'excludedCounts',coalesce((select jsonb_object_agg(counted.reason,counted.total) from
    (select p.reason,count(*) total from planned p where p.reason is not null group by p.reason) counted),'{}'::jsonb),
  'excludedTotal',(select count(*) from planned p where p.reason is not null),
  'targetShipments',(select count(*) from planned p where p.reason is null),
  'targetOrders',(select count(distinct p.order_id) from planned p where p.reason is null),
  'fingerprint',md5(coalesce((select string_agg(p.shipment_id::text||':'||p.version::text||':'||p.new_date::text,',' order by p.shipment_id)
    from planned p where p.reason is null),''))
 )
$$;
alter function private.goods_preorder_schedule_plan(text,uuid,date) owner to postgres;
revoke all on function private.goods_preorder_schedule_plan(text,uuid,date) from public,anon,authenticated,service_role;

-- 8) 일괄 변경 결과 문서. 고객 이메일·연락처는 싣지 않는다(이메일이 있는지만).
create function private.goods_preorder_schedule_change_document(p_change_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with changed as (
  select s.order_id,jsonb_agg(jsonb_build_object('shipmentId',pc.shipment_id,
    'label',coalesce(s.shipment_number,upper(right(s.id::text,8))),'originName',s.origin_name_snapshot,
    'fromDate',pc.from_date,'toDate',pc.to_date) order by pc.shipment_id) shipments
  from private.order_shipment_promise_changes pc join public.order_shipments s on s.id=pc.shipment_id
  where pc.bulk_change_id=p_change_id group by s.order_id
 )
 select jsonb_build_object('id',c.id,'goodId',c.good_id,'goodName',g.name,'variantId',c.variant_id,'variantName',v.name,
  'expectedShipDate',c.to_date,'reason',c.reason,'title',n.title,'customerBody',n.customer_body,'actorName',a.nickname,
  'createdAt',c.created_at,'noticeId',c.notice_id,'requestedAt',n.requested_at,
  'emailEnabled',coalesce((select control.enabled from private.order_delay_notice_delivery_control control where control.singleton),false),
  'smsQueued',c.sms_queued,'shipmentCount',c.shipment_count,'orderCount',c.order_count,'excludedCount',cardinality(c.excluded_shipment_ids),
  'targets',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'orderId',t.order_id,'orderNumber',o.order_number,'audience',t.audience,
    'hasEmail',t.recipient_email is not null,'shipments',coalesce(changed.shipments,'[]'::jsonb),'inAppStatus',t.in_app_status,
    'emailStatus',case when i.state in ('accepted','sent','delivered','delayed') then 'sent'
      when i.state in ('bounced','complained','failed') then 'failed' when i.state='suppressed' then 'suppressed' else t.email_status end,
    'emailProviderState',i.state,
    'errorCode',case when i.state in ('bounced','complained','failed') then 'provider_rejected'
      when i.state='suppressed' then 'provider_suppressed' else t.error_code end,
    'retryable',t.retryable and coalesce(i.accepted_at is null,true)
      and coalesce(i.state not in ('needs_review','failed','bounced','complained','suppressed'),true),
    'smsStatus',sms.status,'smsReason',sms.reason) order by o.order_number,t.audience,t.id)
    from private.order_delay_notice_targets t join public.orders o on o.id=t.order_id
    left join changed on changed.order_id=t.order_id
    left join private.email_intents i on i.id=t.email_intent_id
    left join private.order_delay_notice_sms_jobs sms on sms.target_id=t.id
    where t.notice_id=c.notice_id),'[]'::jsonb))
 from private.goods_preorder_schedule_changes c join public.goods g on g.id=c.good_id
 left join public.goods_variants v on v.id=c.variant_id
 join private.order_delay_notices n on n.id=c.notice_id
 left join public.profiles a on a.id=c.actor_id
 where c.id=p_change_id
$$;
alter function private.goods_preorder_schedule_change_document(uuid) owner to postgres;
revoke all on function private.goods_preorder_schedule_change_document(uuid) from public,anon,authenticated,service_role;

-- 9) 미리보기. 아무것도 바꾸지 않는다. 대상·제외 사유·접수 중인 예약 조건(새 주문은 그 날짜로 안내)·채널 준비 상태를 돌려준다.
create function public.admin_preview_goods_preorder_schedule_change(p_good_id text,p_variant_id uuid,p_expected_ship_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare good public.goods; plan jsonb;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if (select auth.uid()) is null then raise insufficient_privilege using message='staff required'; end if;
  good:=private.goods_preorder_schedule_scope(p_good_id,p_variant_id,p_expected_ship_date);
  plan:=private.goods_preorder_schedule_plan(good.id,p_variant_id,p_expected_ship_date);
  return plan||jsonb_build_object('goodId',good.id,'goodName',good.name,'randomSale',good.option_sale_mode='random',
   'variantId',p_variant_id,'variantName',(select name from public.goods_variants where id=p_variant_id),
   'expectedShipDate',p_expected_ship_date,'limit',2000,
   'acceptingPolicies',coalesce((select jsonb_agg(jsonb_build_object('variantId',v.id,'variantName',v.name,
      'expectedShipDate',policy.expected_ship_date,'startsAt',policy.starts_at,'endsAt',policy.ends_at) order by v.sort_order,v.id)
    from public.goods_variants v join private.goods_preorder_policies policy on policy.id=v.preorder_policy_id
    where v.good_id=good.id and (p_variant_id is null or v.id=p_variant_id) and v.archived_at is null
     and policy.state='active' and policy.ends_at>statement_timestamp() and policy.expected_ship_date<>p_expected_ship_date),'[]'::jsonb),
   'emailEnabled',coalesce((select enabled from private.order_delay_notice_delivery_control where singleton),false),
   'smsEnabled',coalesce((select sms_enabled from private.order_delay_notice_delivery_control where singleton),false));
end $$;
alter function public.admin_preview_goods_preorder_schedule_change(text,uuid,date) owner to postgres;
revoke all on function public.admin_preview_goods_preorder_schedule_change(text,uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_goods_preorder_schedule_change(text,uuid,date) to authenticated;

-- 10) 확정. 미리보기에서 본 대상 그대로(운영자가 뺀 배송 건 제외) 일정을 바꾸고 같은 트랜잭션에서 앱 알림·이메일을 요청한다.
create function public.admin_apply_goods_preorder_schedule_change(p_request_id uuid,p_good_id text,p_variant_id uuid,
  p_expected_ship_date date,p_reason text,p_customer_title text,p_customer_body text,p_preview_fingerprint text,
  p_excluded_shipments uuid[] default '{}'::uuid[],p_sms_requested boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); existing private.goods_preorder_schedule_changes%rowtype; good public.goods;
  excluded uuid[]; digest text; plan jsonb; targets jsonb; target_ids uuid[]; order_ids uuid[];
  notice uuid:=extensions.gen_random_uuid(); changed_at timestamptz:=clock_timestamp(); sms boolean; order_total integer;
  g record; v_labels text[]; v_message text; v_date_line text; v_snapshot jsonb; v_buyer uuid; v_email text; v_buyer_name text;
begin
  perform private.require_operator_capability('sales.manage',false);
  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
  if p_request_id is null or p_preview_fingerprint is null or p_preview_fingerprint !~ '^[0-9a-f]{32}$'
   or p_reason is null or length(btrim(p_reason)) not between 1 and 2000
   or p_customer_title is null or length(btrim(p_customer_title)) not between 1 and 80 or p_customer_title ~ '[[:cntrl:]]'
   or p_customer_body is null or length(btrim(p_customer_body)) not between 1 and 350
   or cardinality(coalesce(p_excluded_shipments,'{}'::uuid[]))>2000 or array_position(coalesce(p_excluded_shipments,'{}'::uuid[]),null) is not null
  then raise invalid_parameter_value using message='invalid_preorder_schedule_change'; end if;
  select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into excluded from unnest(coalesce(p_excluded_shipments,'{}'::uuid[])) x;
  digest:=md5(jsonb_build_array(p_good_id,p_variant_id,p_expected_ship_date,btrim(p_reason),btrim(p_customer_title),btrim(p_customer_body),
   p_preview_fingerprint,to_jsonb(excluded),coalesce(p_sms_requested,false))::text);
  perform pg_advisory_xact_lock(hashtextextended('goods_preorder_schedule_change:'||p_request_id::text,0));
  select * into existing from private.goods_preorder_schedule_changes where id=p_request_id;
  if found then
    if existing.actor_id<>actor or existing.request_digest<>digest then
      raise unique_violation using message='preorder_schedule_idempotency_conflict';
    end if;
    return private.goods_preorder_schedule_change_document(p_request_id);
  end if;
  good:=private.goods_preorder_schedule_scope(p_good_id,p_variant_id,p_expected_ship_date);
  if not coalesce((select enabled from private.order_delay_notice_delivery_control where singleton),false) then
    raise check_violation using message='delay_notice_delivery_disabled';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('goods_preorder_schedule_good:'||good.id,0));
  -- 잠글 주문·배송 건을 정한 뒤 지연 안내와 같은 순서(주문 → 구매자 → 배송 건 → 지연 메모)로 잠그고 다시 계산한다.
  plan:=private.goods_preorder_schedule_plan(good.id,p_variant_id,p_expected_ship_date);
  select array_agg(distinct (value->>'orderId')::uuid),array_agg((value->>'shipmentId')::uuid)
   into order_ids,target_ids from jsonb_array_elements(plan->'targets') value;
  if order_ids is null then raise sqlstate 'PT409' using message='preorder_schedule_stale'; end if;
  perform 1 from public.orders where id=any(order_ids) order by id for update;
  perform 1 from public.profiles where id in (select user_id from public.orders where id=any(order_ids)) order by id for share;
  perform 1 from public.order_shipments where id=any(target_ids) order by id for update;
  perform 1 from public.order_dispatch_delays where order_id=any(order_ids) order by order_id for share;
  plan:=private.goods_preorder_schedule_plan(good.id,p_variant_id,p_expected_ship_date);
  if plan->>'fingerprint' is distinct from p_preview_fingerprint then raise sqlstate 'PT409' using message='preorder_schedule_stale'; end if;
  if exists(select 1 from unnest(excluded) x where not exists(select 1 from jsonb_array_elements(plan->'targets') value
    where (value->>'shipmentId')::uuid=x)) then raise invalid_parameter_value using message='invalid_preorder_schedule_change'; end if;
  select coalesce(jsonb_agg(value order by value->>'shipmentId'),'[]'::jsonb) into targets from jsonb_array_elements(plan->'targets') value
   where not ((value->>'shipmentId')::uuid=any(excluded));
  if jsonb_array_length(targets)=0 then raise check_violation using message='preorder_schedule_no_targets'; end if;
  if jsonb_array_length(targets)>2000 then raise check_violation using message='preorder_schedule_too_many'; end if;
  select array_agg((value->>'shipmentId')::uuid order by (value->>'shipmentId')::uuid),count(distinct value->>'orderId')
   into target_ids,order_total from jsonb_array_elements(targets) value;
  sms:=coalesce(p_sms_requested,false) and coalesce((select sms_enabled from private.order_delay_notice_delivery_control where singleton),false);

  insert into private.order_delay_notices(id,kind,actor_id,shipment_ids,title,customer_body,expected_ship_date)
   values(notice,'preorder_schedule',actor,target_ids,btrim(p_customer_title),btrim(p_customer_body),p_expected_ship_date);
  insert into private.goods_preorder_schedule_changes(id,good_id,variant_id,to_date,reason,actor_id,notice_id,request_digest,
   preview_fingerprint,excluded_shipment_ids,shipment_count,order_count,sms_queued,created_at)
   values(p_request_id,good.id,p_variant_id,p_expected_ship_date,btrim(p_reason),actor,notice,digest,p_preview_fingerprint,excluded,
    cardinality(target_ids),order_total,sms,changed_at);
  insert into private.order_shipment_promise_changes(shipment_id,from_date,to_date,reason,actor_id,created_at,bulk_change_id)
   select (value->>'shipmentId')::uuid,(value->>'currentDate')::date,(value->>'newDate')::date,btrim(p_reason),actor,changed_at,p_request_id
   from jsonb_array_elements(targets) value;
  update public.order_shipments s set expected_ship_date=(value->>'newDate')::date,updated_at=changed_at
   from jsonb_array_elements(targets) value where s.id=(value->>'shipmentId')::uuid;
  insert into public.audit_log(actor_id,action,target,diff)
   select actor,'admin.shipment.preorder_promise_changed','order:'||(value->>'orderId'),jsonb_build_object('shipmentId',value->>'shipmentId',
    'originalDate',value->>'originalDate','fromDate',value->>'currentDate','toDate',value->>'newDate','reason',btrim(p_reason),
    'goodId',good.id,'bulkChangeId',p_request_id,'noticeId',notice,'trigger','goods_preorder_bulk')
   from jsonb_array_elements(targets) value order by value->>'orderId',value->>'shipmentId';

  -- 주문마다 구매자(선물 주문은 받는 분도) 안내 대상을 만든다. 문구는 지연 안내처럼 고객 입력 + 날짜 + 배송 건이다.
  for g in select (value->>'orderId')::uuid order_id,array_agg((value->>'shipmentId')::uuid order by (value->>'shipmentId')::uuid) shipment_ids,
    array_agg(distinct (value->>'currentDate')::date) from_dates,array_agg(distinct (value->>'newDate')::date) to_dates
   from jsonb_array_elements(targets) value group by 1 order by 1 loop
   v_snapshot:=private.preorder_schedule_notice_snapshot(g.order_id,g.shipment_ids);
   if v_snapshot is null then raise sqlstate 'PT409' using message='preorder_schedule_stale'; end if;
   select o.user_id,nullif(lower(btrim(p.email)),''),coalesce(nullif(p.nickname,''),'구매자') into v_buyer,v_email,v_buyer_name
    from public.orders o join public.profiles p on p.id=o.user_id where o.id=g.order_id;
   select array_agg(origin_name_snapshot||' · '||coalesce(shipment_number,upper(right(id::text,8))) order by id) into v_labels
    from public.order_shipments where id=any(g.shipment_ids);
   v_date_line:=case when cardinality(g.from_dates)=1 and cardinality(g.to_dates)=1
     then '발송 예정일: '||to_char(g.from_dates[1],'YYYY-MM-DD')||' → '||to_char(g.to_dates[1],'YYYY-MM-DD')
     else '변경된 발송 예정일: '||(select to_char(min(x),'YYYY-MM-DD') from unnest(g.to_dates) x)
      ||case when cardinality(g.to_dates)>1 then ' ~ '||(select to_char(max(x),'YYYY-MM-DD') from unnest(g.to_dates) x) else '' end end;
   v_message:=btrim(p_customer_body)||E'\n\n'||v_date_line||E'\n안내 대상 배송 건: '
    ||(select string_agg(coalesce(s.shipment_number,upper(right(s.id::text,8))),', ' order by s.id) from public.order_shipments s where s.id=any(g.shipment_ids[1:3]))
    ||case when cardinality(g.shipment_ids)>3 then ' 외 '||(cardinality(g.shipment_ids)-3)::text||'건' else '' end;
   insert into private.order_delay_notice_targets(notice_id,order_id,buyer_id,recipient_email,buyer_name,shipment_ids,shipment_labels,snapshot,
    message_body,email_status,error_code)
    values(notice,g.order_id,v_buyer,v_email,v_buyer_name,g.shipment_ids,v_labels,v_snapshot,v_message,
     case when v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'suppressed' else 'prepared' end,
     case when v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'recipient_missing' else null end);
   insert into private.order_delay_notice_targets(notice_id,order_id,buyer_id,recipient_email,buyer_name,shipment_ids,shipment_labels,snapshot,
    message_body,email_status,error_code,audience)
    select notice,g.order_id,p.id,nullif(lower(btrim(p.email)),''),coalesce(nullif(p.nickname,''),'받는 분'),g.shipment_ids,v_labels,v_snapshot,v_message,
     case when p.email is null or btrim(p.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'suppressed' else 'prepared' end,
     case when p.email is null or btrim(p.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'recipient_missing' else null end,'recipient'
    from private.gift_intents gift join public.profiles p on p.id=gift.recipient_id where gift.order_id=g.order_id;
  end loop;

  -- 지연 안내 요청 경로 그대로: 대상 재확인 → 앱 알림 발행 → 이메일 작업 등록 → 감사.
  perform public.admin_request_order_delay_notice(notice);
  if sms then
    insert into private.order_delay_notice_sms_jobs(target_id) select id from private.order_delay_notice_targets where notice_id=notice;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.preorder_schedule_changed','goods:'||good.id,
   jsonb_build_object('changeId',p_request_id,'noticeId',notice,'variantId',p_variant_id,'toDate',p_expected_ship_date,
    'shipments',cardinality(target_ids),'orders',order_total,'excluded',cardinality(excluded),'sms',sms));
  return private.goods_preorder_schedule_change_document(p_request_id);
end $$;
alter function public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean) owner to postgres;
revoke all on function public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean) to authenticated;

-- 11) 결과 다시 읽기와 상품의 최근 일괄 변경 목록(화면을 떠난 뒤 결과·재시도로 돌아온다).
create function public.admin_read_goods_preorder_schedule_change(p_change_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if (select auth.uid()) is null then raise insufficient_privilege using message='staff required'; end if;
  result:=private.goods_preorder_schedule_change_document(p_change_id);
  if result is null then raise no_data_found using message='preorder_schedule_change_not_found'; end if;
  return result;
end $$;
alter function public.admin_read_goods_preorder_schedule_change(uuid) owner to postgres;
revoke all on function public.admin_read_goods_preorder_schedule_change(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_goods_preorder_schedule_change(uuid) to authenticated;

create function public.admin_list_goods_preorder_schedule_changes(p_good_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;
  if (select auth.uid()) is null then raise insufficient_privilege using message='staff required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'expectedShipDate',c.to_date,'variantName',v.name,'createdAt',c.created_at,
    'actorName',a.nickname,'shipmentCount',c.shipment_count,'orderCount',c.order_count,'requestedAt',n.requested_at) order by c.created_at desc,c.id)
   from (select * from private.goods_preorder_schedule_changes where good_id=p_good_id order by created_at desc,id limit 20) c
   left join public.goods_variants v on v.id=c.variant_id left join public.profiles a on a.id=c.actor_id
   join private.order_delay_notices n on n.id=c.notice_id),'[]'::jsonb);
end $$;
alter function public.admin_list_goods_preorder_schedule_changes(text) owner to postgres;
revoke all on function public.admin_list_goods_preorder_schedule_changes(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_goods_preorder_schedule_changes(text) to authenticated;

-- 12) SMS 작업(service role 전용, cron). 보내기 전에 설정·대상 변경·SMS 수신 동의를 다시 확인한다.
create function public.claim_order_delay_sms_jobs(batch_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; enabled boolean;
begin
  if batch_limit is null or batch_limit not between 1 and 50 then raise invalid_parameter_value using message='invalid_delay_sms_batch'; end if;
  -- 잠금이 끝난 처리 중 작업은 보냈는지 알 수 없다. 다시 보내지 않고 결과 불명으로 둔다.
  update private.order_delay_notice_sms_jobs set status='unknown',reason='lease_expired',claim_token=null,lease_until=null,updated_at=now()
   where status='processing' and lease_until<now();
  -- 하루가 지난 대기 작업은 낡은 일정 안내라 보내지 않는다.
  update private.order_delay_notice_sms_jobs set status='skipped',reason='expired',updated_at=now()
   where status='queued' and created_at<now()-interval '24 hours';
  select coalesce(control.sms_enabled,false) into enabled from private.order_delay_notice_delivery_control control where control.singleton;
  if not coalesce(enabled,false) then
    update private.order_delay_notice_sms_jobs set status='skipped',reason='sms_disabled',updated_at=now() where status='queued';
    return '[]'::jsonb;
  end if;
  with picked as (
   select job.target_id from private.order_delay_notice_sms_jobs job where job.status='queued'
   order by job.created_at,job.target_id for update skip locked limit batch_limit
  ), checked as (
   select picked.target_id,coalesce(private.order_delay_notice_target_current(picked.target_id),false) current_target,
    exists(select 1 from private.order_delay_notice_targets t join private.customer_marketing_consents consent
     on consent.user_id=t.buyer_id and consent.channel='sms' and consent.agreed where t.id=picked.target_id) consented
   from picked
  ), skipped as (
   update private.order_delay_notice_sms_jobs job set status='skipped',
    reason=case when not checked.current_target then 'target_changed' else 'consent_required' end,updated_at=now()
   from checked where job.target_id=checked.target_id and not (checked.current_target and checked.consented) returning job.target_id
  ), claimed as (
   update private.order_delay_notice_sms_jobs job set status='processing',claim_token=extensions.gen_random_uuid(),
    lease_until=now()+interval '10 minutes',attempts=job.attempts+1,updated_at=now()
   from checked where job.target_id=checked.target_id and checked.current_target and checked.consented returning job.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',c.target_id,'claimToken',c.claim_token,'userId',t.buyer_id,'orderId',t.order_id,
    'orderNumber',o.order_number,'audience',t.audience,'title',n.title,'body',t.message_body) order by c.created_at,c.target_id),'[]'::jsonb)
   into result
  from claimed c join private.order_delay_notice_targets t on t.id=c.target_id
  join private.order_delay_notices n on n.id=t.notice_id join public.orders o on o.id=t.order_id;
  return result;
end $$;
alter function public.claim_order_delay_sms_jobs(integer) owner to postgres;
revoke all on function public.claim_order_delay_sms_jobs(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_order_delay_sms_jobs(integer) to service_role;

create function public.finish_order_delay_sms_job(p_target_id uuid,p_claim uuid,p_status text,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare job private.order_delay_notice_sms_jobs%rowtype;
begin
  if p_target_id is null or p_claim is null or p_status is null or p_status not in ('sent','failed','skipped')
   or (p_status='sent')<>(p_reason is null)
   or (p_reason is not null and p_reason not in ('sms_disabled','consent_required','no_verified_phone','account_unavailable','provider_unavailable','invalid_body'))
   or (p_status='failed' and p_reason not in ('provider_unavailable','invalid_body'))
   or (p_status='skipped' and p_reason not in ('sms_disabled','consent_required','no_verified_phone','account_unavailable'))
  then raise invalid_parameter_value using message='invalid_delay_sms_result'; end if;
  select * into job from private.order_delay_notice_sms_jobs where target_id=p_target_id for update;
  if not found or job.status<>'processing' or job.claim_token is distinct from p_claim then return false; end if;
  update private.order_delay_notice_sms_jobs set status=p_status,reason=p_reason,claim_token=null,lease_until=null,
   sent_at=case when p_status='sent' then now() end,updated_at=now() where target_id=p_target_id;
  insert into public.audit_log(actor_id,action,target,diff) values(null,'system.order.delay_notice_sms_result','delay_notice_target:'||p_target_id,
   jsonb_build_object('status',p_status,'reason',p_reason));
  return true;
end $$;
alter function public.finish_order_delay_sms_job(uuid,uuid,text,text) owner to postgres;
revoke all on function public.finish_order_delay_sms_job(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_order_delay_sms_job(uuid,uuid,text,text) to service_role;

-- 13) 운영자 계약: 새 화면 RPC 4개를 등록하고, 본문을 바꾼 지연 안내 결과 요약의 내부 계약 지문을 다시 남긴다.
select private.register_operator_rpc_contract('public.admin_preview_goods_preorder_schedule_change(text,uuid,date)'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_apply_goods_preorder_schedule_change(uuid,text,uuid,date,text,text,text,text,uuid[],boolean)'::regprocedure,'sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_read_goods_preorder_schedule_change(uuid)'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_list_goods_preorder_schedule_changes(text)'::regprocedure,'sales.manage','read',false);
do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array ARRAY['private.shipment_delay_notice_summary(uuid)','private.order_delay_notice_target_current(uuid)'] loop
  fn:=signature::regprocedure;registered:=false;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);registered:=true; end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);registered:=true;
  end if;
  if signature='private.shipment_delay_notice_summary(uuid)' and not registered then raise exception 'operational_rpc_contract_missing: %',signature; end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';

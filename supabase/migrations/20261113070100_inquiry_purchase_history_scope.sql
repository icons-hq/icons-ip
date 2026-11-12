-- 1014-103 상담 중 고객의 구매이력.
-- 원래 요청(10/14 회의): "얘가 뭘 샀는지 알아야 돼. 얘랑 상담을 해야 돼. 안 그러면 여기에서 다 뒤져야 돼."
-- 사용자 결정(2026-11-11 묶음 16) "전부 다 아무나 볼 수 있게" → 확인(2026-11-12 묶음 21) "이대로 (Recommended)":
-- 상담 화면을 여는 모든 운영자 역할(부매니저·대행사 포함 — 문의 응대 권한 cs.manage)이 상담 중 고객의 전체 구매이력
-- (금액·상태 포함)을 본다. 열람마다 감사 기록(상담·고객·운영자)을 남긴다.
--
-- 범위는 '그 문의의 고객'이다. 문의 번호로만 부르고 그 문의를 쓴 고객의 주문만 돌려준다. 고객 관리의
-- admin_operator_customer_history(주문 조회 sales.read)는 그대로 두어, 아무 고객 번호로 주문을 읽는 길은 넓히지 않는다.
-- 돌려주는 값은 주문 목록(주문번호·상태·결제 금액·대표 상품·품목 수·주문 시각)과 그 문의에 연결된 주문 요약뿐이다.
-- 배송지·연락처·결제수단·클레임은 싣지 않는다. 연결 주문은 그 고객의 주문일 때만 싣는다.
--
-- 감사: admin.inquiry.purchase_history_viewed(target inquiries:<문의>, diff에 고객·페이지·건수·보여 준 주문 번호).
-- 상담 화면은 새 메시지·재연결마다 화면을 다시 그리므로, 같은 운영자가 같은 문의의 같은 페이지를 10분 안에 다시 읽으면
-- 기록을 겹쳐 남기지 않는다(첫 열람과 다른 페이지 열람은 늘 남는다).
-- 감사 기록을 쓰므로 VOLATILE이다(PostgREST가 STABLE 함수를 읽기 전용 트랜잭션으로 부르기 때문).
create function public.admin_inquiry_purchase_history(target_inquiry_id uuid, target_page integer default 1)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  actor uuid;
  thread public.inquiries;
  total bigint;
  page integer;
  page_size constant integer := 20;
  items jsonb;
  shown uuid[];
  linked jsonb := null;
begin
  actor := private.require_operator_capability('cs.manage');
  if target_inquiry_id is null then
    raise invalid_parameter_value using message = 'inquiry_purchase_history_invalid';
  end if;
  select * into thread from public.inquiries where id = target_inquiry_id;
  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  select count(*) into total from public.orders where user_id = thread.user_id;
  page := least(greatest(coalesce(target_page, 1), 1), greatest(1, (total + page_size - 1) / page_size)::integer);

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'orderNumber', r.order_number, 'status', r.status, 'amount', r.total, 'createdAt', r.created_at,
      'title', coalesce((select i.good_name_snapshot from public.order_items i where i.order_id = r.id order by i.id limit 1), '주문 상품'),
      'itemCount', (select count(*) from public.order_items i where i.order_id = r.id)
    ) order by r.created_at desc, r.id desc), '[]'::jsonb),
    coalesce(array_agg(r.id order by r.created_at desc, r.id desc), '{}'::uuid[])
  into items, shown
  from (
    select o.id, o.order_number, o.status, o.total, o.created_at
    from public.orders o
    where o.user_id = thread.user_id
    order by o.created_at desc, o.id desc
    limit page_size offset (page - 1) * page_size
  ) r;

  if thread.order_id is not null then
    select jsonb_build_object(
      'id', o.id, 'orderNumber', o.order_number, 'status', o.status, 'amount', o.total, 'createdAt', o.created_at,
      'title', coalesce((select i.good_name_snapshot from public.order_items i where i.order_id = o.id order by i.id limit 1), '주문 상품'),
      'quantity', (select coalesce(sum(i.qty), 0) from public.order_items i where i.order_id = o.id))
    into linked
    from public.orders o
    where o.id = thread.order_id and o.user_id = thread.user_id;
  end if;

  if not exists (
    select 1 from public.audit_log a
    where a.target = 'inquiries:' || thread.id::text
      and a.action = 'admin.inquiry.purchase_history_viewed'
      and a.actor_id = actor
      and a.created_at > clock_timestamp() - interval '10 minutes'
      and a.diff->>'page' = page::text
  ) then
    insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'admin.inquiry.purchase_history_viewed', 'inquiries:' || thread.id::text,
      jsonb_build_object('customerId', thread.user_id, 'page', page, 'total', total, 'orderIds', to_jsonb(shown)));
  end if;

  return jsonb_build_object('inquiryId', thread.id, 'customerId', thread.user_id, 'linkedOrder', linked,
    'items', items, 'page', page, 'pageSize', page_size, 'total', total);
end $$;

revoke all on function public.admin_inquiry_purchase_history(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_inquiry_purchase_history(uuid, integer) to authenticated;

select private.register_operator_rpc_contract('public.admin_inquiry_purchase_history(uuid,integer)'::regprocedure, 'cs.manage', 'read', false);

notify pgrst, 'reload schema';

-- 재고 파일 대조(1007-009·1007-011, ADR-0005 보완).
--
-- 운영자가 ERP·창고 재고 파일(ICONS 몫 수량)을 올리면 옵션 할당 재고와의 차이를 미리 보여 주고,
-- 확정하면 행 잠금·멱등·감사 기록으로 반영한다. 자동 연동은 하지 않는다(ADR-0005·0016).
--
-- 파일 수량은 '그 시각(F) 창고에 있던 실물'이다. 사이트 재고수량은 주문 때 빠지고 취소·환불·교환 재출고 때
-- 돌아오지만, 창고 실물은 출고 때 빠지고 회수 때 돌아온다. 둘을 같은 단위로 맞추면
--   창고 실물(지금)   = 파일 − 기준 시각 뒤 출고 + 기준 시각 뒤 회수
--   맞춘 뒤 재고수량 = max(창고 실물(지금) − 출고 대기 − 회수 뒤 재고 미반영, 0)
--   차이             = 파일 − (재고수량 + 출고 대기 + 회수 뒤 재고 미반영 + 기준 시각 뒤 출고 − 기준 시각 뒤 회수)
-- 이다.
--   · 출고 대기: 재고를 뺐지만 아직 창고를 떠나지 않았고 복원되지 않은 주문 품목
--   · 기준 시각 뒤 출고: F 뒤에 창고를 떠난 수량(주문 출고·교환 재출고·그룹상품 교환 재출고, 나중에 반품돼도 포함)
--   · 기준 시각 뒤 회수: F 뒤에 창고로 돌아온 수량(클레임 회수 시각, 회수 기록 없이 재고가 복원된 출고분은 복원 시각)
--   · 회수 뒤 재고 미반영: 회수했지만 아직 환불·교환 재출고 전이라 재고수량에 돌아오지 않은 수량
-- 주문·출고·회수·환불 복원·교환 재출고는 이 항들을 함께 움직여 차이를 바꾸지 않는다. 그래서 확정 때
-- 차이가 미리보기와 같은지만 다시 보면 된다(수동 재고 조정·다른 대조가 끼면 다시 미리보기).
-- 그룹상품 전환(ADR-0022)으로 재고가 승계 옵션으로 옮겨 간 경우 과거 옵션의 주문·회수는 지금 재고를 가진
-- 승계 옵션에 센다(취소·환불 복원과 같은 귀속).
-- 파일 뒤의 입고처럼 기록으로 가를 수 없는 재고 조정은 계산에 넣지 않고 옵션마다 표시만 한다.
--
-- 못 찾은 행·같은 옵션을 가리키는 여러 행·다른 출고지 상품·보관 상품·사용 중지 옵션은 반영하지 않고
-- 미리보기에 사유를 남긴다.
begin;

create table private.stock_reconcile_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  origin_id uuid references public.fulfillment_origins(id) on delete restrict,
  source_label text not null check(char_length(source_label) between 1 and 200 and source_label !~ '[[:cntrl:]]'),
  as_of timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  row_count integer not null check(row_count between 1 and 2000),
  matched_count integer not null check(matched_count>=0),
  issue_count integer not null check(issue_count>=0),
  issues jsonb not null default '[]'::jsonb check(jsonb_typeof(issues)='array'),
  applied_at timestamptz,
  applied_by uuid references public.profiles(id) on delete restrict,
  apply_reason text check(apply_reason is null or (char_length(apply_reason) between 1 and 200 and apply_reason !~ '[[:cntrl:]]')),
  apply_result jsonb check(apply_result is null or jsonb_typeof(apply_result)='object'),
  check(matched_count+issue_count=row_count),
  check((applied_at is null)=(applied_by is null) and (applied_at is null)=(apply_reason is null) and (applied_at is null)=(apply_result is null))
);
create index stock_reconcile_snapshots_recent on private.stock_reconcile_snapshots(created_at desc,id desc);

create table private.stock_reconcile_snapshot_items (
  snapshot_id uuid not null references private.stock_reconcile_snapshots(id) on delete cascade,
  variant_id uuid not null,
  -- 상품 주소(id)가 바뀌면 옵션을 따라 함께 바뀐다(초안 상품 URL 변경).
  good_id text not null,
  source_row integer not null check(source_row>0),
  match_kind text not null check(match_kind in ('option_code','erp_code','barcode','goods_code')),
  file_qty integer not null check(file_qty between 0 and 100000000),
  stock_qty integer not null check(stock_qty>=0),
  pending_qty integer not null check(pending_qty>=0),
  shipped_since_qty integer not null check(shipped_since_qty>=0),
  returned_since_qty integer not null check(returned_since_qty>=0),
  awaiting_return_qty integer not null check(awaiting_return_qty>=0),
  -- 기준 시각 뒤 사람이 바꾼 재고(재고 조정·다른 대조). 계산에 넣지 않고 확인 표시만 한다.
  adjusted_since_count integer not null default 0 check(adjusted_since_count>=0),
  adjusted_since_qty integer not null default 0,
  difference integer not null,
  target_qty integer not null check(target_qty>=0),
  applied_delta integer,
  stock_after integer check(stock_after is null or stock_after>=0),
  primary key(snapshot_id,variant_id),
  foreign key(variant_id,good_id) references public.goods_variants(id,good_id) on update cascade on delete cascade,
  check(target_qty=greatest(stock_qty+difference,0)),
  check((applied_delta is null)=(stock_after is null))
);
-- 출고 전 경고는 옵션마다 가장 최근 파일을 찾는다.
create index stock_reconcile_snapshot_items_variant on private.stock_reconcile_snapshot_items(variant_id,snapshot_id);

alter table private.stock_reconcile_snapshots enable row level security;
alter table private.stock_reconcile_snapshot_items enable row level security;
revoke all on private.stock_reconcile_snapshots,private.stock_reconcile_snapshot_items from public,anon,authenticated,service_role;

-- 그룹상품 전환으로 재고가 옮겨 간 옵션 → 지금 재고를 가진 마지막 승계 옵션(private.resolve_goods_stock_successor와 같은 사슬).
create function private.stock_reconcile_holders()
returns table(source_id uuid,holder_id uuid)
language sql stable security definer set search_path='' as $$
  with recursive chain(source_id,holder_id,depth) as (
    select s.source_variant_id,s.target_variant_id,1 from private.goods_stock_successors s
    union all
    select c.source_id,s.target_variant_id,c.depth+1 from chain c
      join private.goods_stock_successors s on s.source_variant_id=c.holder_id
    where c.depth<128
  )
  select distinct on (c.source_id) c.source_id,c.holder_id from chain c order by c.source_id,c.depth desc;
$$;
revoke all on function private.stock_reconcile_holders() from public,anon,authenticated,service_role;

-- 옵션(지금 재고를 가진 옵션)별 실물 흐름. 위 머리말의 네 항을 돌려준다.
-- 재고를 실제로 뺀 품목만 센다: 재고 판매 품목, 예약판매는 실물을 배정한(allocated·이후 복원된 returned) 품목.
-- 취소 배송 건·디지털 파일은 창고 실물이 아니다. 배송 건이 없으면 주문 상태·시각으로 출고 여부를 본다.
create function private.stock_reconcile_flows(p_variant_ids uuid[],p_as_of timestamptz)
returns table(variant_id uuid,pending_qty bigint,shipped_since_qty bigint,returned_since_qty bigint,awaiting_return_qty bigint)
language sql stable security definer set search_path='' as $$
  with targets as (
    select distinct supplied.id from unnest(p_variant_ids) as supplied(id) where supplied.id is not null
  ), members as (
    select t.id as member_id,t.id as holder_id from targets t
    union
    select h.source_id,h.holder_id from private.stock_reconcile_holders() h join targets t on t.id=h.holder_id
  ), units as (
    select oi.id as item_id,oi.order_id,oi.qty::bigint as qty,m.holder_id,o.status as order_status,
      case when s.id is not null then s.status in ('shipping','delivered') or s.shipped_at is not null
        else o.status in ('shipping','delivered','done') or o.shipped_at is not null end as left_warehouse,
      case when s.id is not null then coalesce(s.shipped_at,s.delivered_at) else coalesce(o.shipped_at,o.delivered_at) end as left_at
    from public.order_items oi
    join members m on m.member_id=oi.variant_id
    join public.orders o on o.id=oi.order_id
    left join public.order_shipment_items si on si.order_item_id=oi.id
    left join public.order_shipments s on s.id=si.shipment_id
    where (s.id is null or (s.status<>'canceled' and s.fulfillment_partition<>'digital'))
      and (oi.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations r
        where r.order_item_id=oi.id and r.state in ('allocated','returned')))
  ), restorations as (
    -- 취소·환불의 재고 복원 기록(private.restore_order_item_supply). 품목마다 한 번이다.
    select u.item_id,u.left_warehouse,u.left_at,a.created_at as restored_at,(a.diff->>'delta')::bigint as qty,
      (a.diff->>'variantId')::uuid as restored_variant_id,u.order_id
    from units u
    join public.audit_log a on a.target='order:'||u.order_id::text and a.action='order.option_stock_restored'
      and a.diff->>'orderItemId'=u.item_id::text
  ), reshipped as (
    -- 교환 재출고: 재출고 시각에 재고를 빼고 바로 보낸다. 그룹상품 교환은 별도 배정 원장에 남는다.
    select m.holder_id,ri.qty::bigint as qty,c.reshipped_at as left_at
    from public.order_claim_reshipment_items ri
    join public.order_cancellation_requests c on c.id=ri.claim_id
    join members m on m.member_id=ri.variant_id
    where c.reshipped_at is not null
    union all
    select m.holder_id,a.qty::bigint,c.reshipped_at
    from private.group_claim_reshipment_allocations a
    join public.order_cancellation_requests c on c.id=a.claim_id
    join members m on m.member_id=a.target_variant_id
    where c.reshipped_at is not null
  ), member_items as (
    -- 구매·교환 재출고·회수로 이 옵션들의 실물이었던 적이 있는 품목만 회수 옵션을 계산한다.
    select oi.id from public.order_items oi join members m on m.member_id=oi.variant_id
    union
    select ri.order_item_id from public.order_claim_reshipment_items ri join members m on m.member_id in (ri.variant_id,ri.source_variant_id)
    union
    select a.order_item_id from private.group_claim_reshipment_allocations a join members m on m.member_id in (a.target_variant_id,a.returned_variant_id)
  ), collected as (
    -- 회수한 클레임의 실물(주문 단위 클레임이라 그 주문에서 창고를 떠난 품목 전부). 회수 옵션은 교환 재출고가 끝났으면
    -- 기록된 회수 옵션, 아니면 그 클레임 전의 실물 단위다. 복원 여부: 교환은 재출고, 취소·반품은 주문 취소·완료.
    select c.collected_at,oi.qty::bigint as qty,
      coalesce(
        (select ri.source_variant_id from public.order_claim_reshipment_items ri where ri.claim_id=c.id and ri.order_item_id=oi.id),
        (select a.returned_variant_id from private.group_claim_reshipment_allocations a where a.claim_id=c.id and a.order_item_id=oi.id),
        (select p.variant_id from private.order_item_physical_unit(oi.id) p)) as returned_variant_id,
      case when c.claim_type='exchange' then c.reshipped_at is not null else o.status='canceled' or c.stage='completed' end as restored
    from public.order_cancellation_requests c
    join public.orders o on o.id=c.order_id
    join public.order_items oi on oi.order_id=c.order_id
    where c.collected_at is not null and c.stage not in ('rejected','withdrawn') and oi.id in (select mi.id from member_items mi)
      and (oi.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations r
        where r.order_item_id=oi.id and r.state in ('allocated','returned')))
      and coalesce((select (s.status in ('shipping','delivered') or s.shipped_at is not null) and s.fulfillment_partition<>'digital'
          from public.order_shipment_items si join public.order_shipments s on s.id=si.shipment_id where si.order_item_id=oi.id),
        o.shipped_at is not null)
  ), returned as (
    select m.holder_id,c.qty,c.collected_at,c.restored
    from collected c join members m on m.member_id=c.returned_variant_id
    union all
    -- 회수 클레임 없이 재고가 복원된 출고분은 복원 시각에 돌아온 것으로 본다.
    select m.holder_id,r.qty,r.restored_at,true
    from restorations r join members m on m.member_id=r.restored_variant_id
    where r.left_warehouse and (r.left_at is null or r.left_at<=r.restored_at)
      and not exists(select 1 from public.order_cancellation_requests c where c.order_id=r.order_id
        and c.collected_at is not null and c.stage not in ('rejected','withdrawn'))
  )
  select t.id,
    coalesce((select sum(u.qty) from units u where u.holder_id=t.id and u.order_status<>'canceled' and not u.left_warehouse
      and not exists(select 1 from restorations r where r.item_id=u.item_id)),0)::bigint,
    (coalesce((select sum(u.qty) from units u where u.holder_id=t.id and u.left_warehouse and u.left_at>p_as_of),0)
      +coalesce((select sum(r.qty) from reshipped r where r.holder_id=t.id and r.left_at>p_as_of),0))::bigint,
    coalesce((select sum(r.qty) from returned r where r.holder_id=t.id and r.collected_at>p_as_of),0)::bigint,
    coalesce((select sum(r.qty) from returned r where r.holder_id=t.id and not r.restored),0)::bigint
  from targets t;
$$;
revoke all on function private.stock_reconcile_flows(uuid[],timestamptz) from public,anon,authenticated,service_role;

-- 기준 시각 뒤 사람이 바꾼 재고(재고 조정·다른 재고 대조 반영). 파일 뒤 입고인지 실사 보정인지 가를 수 없어
-- 계산에는 넣지 않고 옵션마다 건수·합계를 보여 준다.
create function private.stock_reconcile_adjustments(p_variant_ids uuid[],p_as_of timestamptz)
returns table(variant_id uuid,adjusted_count integer,adjusted_qty bigint)
language sql stable security definer set search_path='' as $$
  select v.id,count(a.id)::integer,coalesce(sum((a.diff->>'delta')::bigint),0)::bigint
  from public.goods_variants v
  left join public.audit_log a on a.target='goods:'||v.good_id and a.created_at>p_as_of
    and a.action in ('admin.good.stock_adjusted','admin.good.stock_reconciled')
    and a.diff->>'variantId'=v.id::text and (a.diff->>'delta') ~ '^-?[0-9]{1,10}$'
  where v.id=any(p_variant_ids)
  group by v.id;
$$;
revoke all on function private.stock_reconcile_adjustments(uuid[],timestamptz) from public,anon,authenticated,service_role;

-- 파일 행 → 옵션. 관리코드 → ERP 코드 → 바코드 → (사용 옵션이 하나뿐인) 판매자상품코드 순으로 찾는다.
-- 찾은 키끼리 다른 옵션을 가리키거나 판매자상품코드가 다른 상품이면 'conflict'다. 등록되지 않은 보조 키
-- (예: 아직 넣지 않은 바코드)는 무시한다. 같은 옵션을 가리키는 행이 둘 이상이면 모두 'duplicate'로 뺀다.
create function private.stock_reconcile_resolve(p_rows jsonb,p_origin_id uuid)
returns table(source_row integer,match_key text,file_qty integer,variant_id uuid,good_id text,match_kind text,issue text)
language sql stable security definer set search_path='' as $$
  with input as (
    select (x->>'row')::integer as source_row,
      nullif(upper(btrim(x->>'goodsCode')),'') as goods_code,
      nullif(upper(btrim(x->>'optionCode')),'') as option_code,
      nullif(btrim(x->>'erpCode'),'') as erp_code,
      nullif(btrim(x->>'barcode'),'') as barcode,
      (x->>'qty')::integer as file_qty
    from jsonb_array_elements(p_rows) x
  ), looked as (
    select i.*,
      (select v.id from public.goods_variants v where v.code=i.option_code) as by_option,
      (select e.variant_id from private.goods_variant_external_identity e where lower(e.erp_code)=lower(i.erp_code)) as by_erp,
      (select e.variant_id from private.goods_variant_external_identity e where lower(e.barcode)=lower(i.barcode)) as by_barcode,
      (select g.id from public.goods g where g.code=i.goods_code) as goods_id,
      coalesce(i.option_code,i.erp_code,i.barcode,i.goods_code) as match_key
    from input i
  ), picked as (
    select l.*,
      (select count(distinct candidate) from unnest(array[l.by_option,l.by_erp,l.by_barcode]) candidate where candidate is not null) as key_hits,
      case when l.goods_id is null then null else
        (select case when count(*)=1 then min(v.id::text)::uuid end from public.goods_variants v
          where v.good_id=l.goods_id and v.archived_at is null) end as by_goods
    from looked l
  ), chosen as (
    select p.*,coalesce(p.by_option,p.by_erp,p.by_barcode,p.by_goods) as candidate,
      case when p.by_option is not null then 'option_code' when p.by_erp is not null then 'erp_code'
        when p.by_barcode is not null then 'barcode' when p.by_goods is not null then 'goods_code' end as kind
    from picked p
  ), classified as (
    select c.source_row,c.match_key,c.file_qty,v.good_id,c.kind,
      case
        when c.key_hits>1 or (c.goods_id is not null and c.candidate is not null and v.good_id<>c.goods_id) then 'conflict'
        when c.candidate is null and c.goods_id is not null then 'option_required'
        when c.candidate is null then 'not_found'
        when g.archived_at is not null then 'goods_archived'
        when v.archived_at is not null then 'option_stopped'
        when p_origin_id is not null and g.origin_id is distinct from p_origin_id then 'other_origin'
      end as issue,
      c.candidate
    from chosen c
    left join public.goods_variants v on v.id=c.candidate
    left join public.goods g on g.id=v.good_id
  ), counted as (
    select k.*,count(*) filter(where k.issue is null) over(partition by k.candidate) as same_option_rows
    from classified k
  )
  select c.source_row,c.match_key,c.file_qty,
    case when c.issue is null and c.same_option_rows=1 then c.candidate end,
    case when c.issue is null and c.same_option_rows=1 then c.good_id end,
    case when c.issue is null and c.same_option_rows=1 then c.kind end,
    case when c.issue is null and c.same_option_rows>1 then 'duplicate' else c.issue end
  from counted c;
$$;
revoke all on function private.stock_reconcile_resolve(jsonb,uuid) from public,anon,authenticated,service_role;

-- 화면 문서. 반영할 옵션(맞춘 뒤 재고수량이 다른 옵션)을 차이가 큰 순서로 먼저 둔다. 상품은 옵션의 지금 상품으로 찾는다.
create function private.stock_reconcile_document(p_snapshot_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',s.id,'originId',s.origin_id,'originName',o.name,'sourceLabel',s.source_label,'asOf',s.as_of,
    'createdAt',s.created_at,'createdByName',coalesce(creator.nickname,''),
    'rowCount',s.row_count,'matchedCount',s.matched_count,'issueCount',s.issue_count,
    'changedCount',(select count(*) from private.stock_reconcile_snapshot_items i where i.snapshot_id=s.id and i.target_qty<>i.stock_qty),
    'appliedAt',s.applied_at,'appliedByName',applier.nickname,'applyReason',s.apply_reason,'applyResult',s.apply_result,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
        'variantId',i.variant_id,'goodId',v.good_id,'goodsCode',g.code,'goodsName',g.name,'optionName',v.name,'optionCode',v.code,
        'sourceRow',i.source_row,'matchKind',i.match_kind,'fileQty',i.file_qty,'stockQty',i.stock_qty,'pendingQty',i.pending_qty,
        'shippedSinceQty',i.shipped_since_qty,'returnedSinceQty',i.returned_since_qty,'awaitingReturnQty',i.awaiting_return_qty,
        'adjustedSinceCount',i.adjusted_since_count,'adjustedSinceQty',i.adjusted_since_qty,
        'difference',i.difference,'targetQty',i.target_qty,
        'appliedDelta',i.applied_delta,'stockAfter',i.stock_after,'preorder',v.preorder_policy_id is not null)
      order by (i.target_qty<>i.stock_qty) desc,abs(i.difference) desc,g.name,v.sort_order,i.variant_id)
      from private.stock_reconcile_snapshot_items i
      join public.goods_variants v on v.id=i.variant_id
      join public.goods g on g.id=v.good_id
      where i.snapshot_id=s.id),'[]'::jsonb),
    'issues',s.issues)
  from private.stock_reconcile_snapshots s
  left join public.fulfillment_origins o on o.id=s.origin_id
  left join public.profiles creator on creator.id=s.created_by
  left join public.profiles applier on applier.id=s.applied_by
  where s.id=p_snapshot_id;
$$;
revoke all on function private.stock_reconcile_document(uuid) from public,anon,authenticated,service_role;

-- 미리보기: 파일 행을 검사·매칭하고 그 시점의 재고수량과 실물 흐름을 기록한다. 재고는 바꾸지 않는다.
-- 기준 시각은 7일 안만 받는다 — 파일이 오래될수록 기록으로 가를 수 없는 입고·조정이 끼기 쉽다.
create function public.admin_preview_stock_reconcile(p_origin_id uuid,p_as_of timestamptz,p_source_label text,p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;label text;snapshot uuid;resolved jsonb;matched integer;issues jsonb;variant_ids uuid[];now_at timestamptz:=clock_timestamp();
begin
  actor:=private.require_operator_capability('catalog.manage',false);
  label:=btrim(coalesce(p_source_label,''),E' \t\n\r\f\v');
  if p_as_of is null or p_as_of>now_at+interval '5 minutes' or p_as_of<now_at-interval '7 days' then
    raise invalid_parameter_value using message='invalid_stock_reconcile_as_of';
  end if;
  if char_length(label) not between 1 and 200 or label ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message='invalid_stock_reconcile_label';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise invalid_parameter_value using message='invalid_stock_reconcile_rows';
  end if;
  -- CASE로 순서를 고정한다(OR는 평가 순서를 보장하지 않아 객체가 아닌 값에 jsonb_each·형 변환이 먼저 돌 수 있다).
  if exists(select 1 from jsonb_array_elements(p_rows) x where case
      when jsonb_typeof(x) is distinct from 'object' then true
      when jsonb_typeof(x->'row') is distinct from 'number' or (x->>'row')!~'^[1-9][0-9]{0,8}$' then true
      when jsonb_typeof(x->'qty') is distinct from 'number' or (x->>'qty')!~'^(0|[1-9][0-9]{0,8})$' then true
      when (x->>'qty')::bigint>100000000 then true
      when not (x ? 'goodsCode' or x ? 'optionCode' or x ? 'erpCode' or x ? 'barcode') then true
      else exists(select 1 from jsonb_each(x) field where field.key not in ('row','qty','goodsCode','optionCode','erpCode','barcode')
        or (field.key<>'row' and field.key<>'qty' and case when jsonb_typeof(field.value) is distinct from 'string' then true
          else char_length(btrim(field.value#>>'{}')) not between 1 and 200 or (field.value#>>'{}') ~ '[[:cntrl:]]' end))
    end)
    or (select count(distinct x->>'row') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then
    raise invalid_parameter_value using message='invalid_stock_reconcile_rows';
  end if;
  if p_origin_id is not null and not exists(select 1 from public.fulfillment_origins where id=p_origin_id) then
    raise no_data_found using message='fulfillment_origin_not_found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.source_row),'[]'::jsonb) into resolved
  from private.stock_reconcile_resolve(p_rows,p_origin_id) r;
  select count(*) into matched from jsonb_to_recordset(resolved) as r(issue text) where r.issue is null;
  select coalesce(jsonb_agg(jsonb_build_object('row',r.source_row,'key',r.match_key,'fileQty',r.file_qty,'reason',r.issue) order by r.source_row),'[]'::jsonb)
    into issues from jsonb_to_recordset(resolved) as r(source_row integer,match_key text,file_qty integer,issue text) where r.issue is not null;
  variant_ids:=array(select (e->>'variant_id')::uuid from jsonb_array_elements(resolved) e where e->>'issue' is null);

  insert into private.stock_reconcile_snapshots(origin_id,source_label,as_of,created_by,created_at,row_count,matched_count,issue_count,issues)
  values(p_origin_id,label,p_as_of,actor,now_at,jsonb_array_length(p_rows),matched,jsonb_array_length(issues),issues)
  returning id into snapshot;

  insert into private.stock_reconcile_snapshot_items(snapshot_id,variant_id,good_id,source_row,match_kind,file_qty,stock_qty,
    pending_qty,shipped_since_qty,returned_since_qty,awaiting_return_qty,adjusted_since_count,adjusted_since_qty,difference,target_qty)
  select snapshot,r.variant_id,v.good_id,r.source_row,r.match_kind,r.file_qty,v.stock_qty,
    f.pending_qty::integer,f.shipped_since_qty::integer,f.returned_since_qty::integer,f.awaiting_return_qty::integer,
    adj.adjusted_count,adj.adjusted_qty::integer,
    (r.file_qty::bigint-(v.stock_qty::bigint+f.pending_qty+f.awaiting_return_qty+f.shipped_since_qty-f.returned_since_qty))::integer,
    greatest(r.file_qty::bigint-f.pending_qty-f.awaiting_return_qty-f.shipped_since_qty+f.returned_since_qty,0)::integer
  from jsonb_to_recordset(resolved) as r(source_row integer,variant_id uuid,good_id text,match_kind text,file_qty integer,issue text)
  join public.goods_variants v on v.id=r.variant_id
  join private.stock_reconcile_flows(variant_ids,p_as_of) f on f.variant_id=r.variant_id
  join private.stock_reconcile_adjustments(variant_ids,p_as_of) adj on adj.variant_id=r.variant_id
  where r.issue is null;

  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.stock_reconcile.previewed','stock_reconcile:'||snapshot,
    jsonb_build_object('originId',p_origin_id,'asOf',p_as_of,'sourceLabel',label,'rows',jsonb_array_length(p_rows),
      'matched',matched,'issues',jsonb_array_length(issues)));
  return private.stock_reconcile_document(snapshot);
end $$;
revoke all on function public.admin_preview_stock_reconcile(uuid,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_preview_stock_reconcile(uuid,timestamptz,text,jsonb) to authenticated;

-- 확정: 미리보기에서 바뀌는 옵션만, 차이가 그대로일 때 한 번에 반영한다. 하나라도 달라졌으면 아무것도 바꾸지 않고
-- 달라진 옵션을 돌려준다. 같은 미리보기의 재확정은 처음 결과를 돌려준다(응답 유실 재시도).
-- 잠금 순서는 재고 조정·주문과 같다: 상품(id 순) → 옵션(id 순). 상품은 옵션의 지금 상품이다.
create function public.admin_apply_stock_reconcile(p_snapshot_id uuid,p_expected_changes integer,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;reason text;snap private.stock_reconcile_snapshots;item record;conflicts jsonb:='[]'::jsonb;
  preview_changes integer;changed_ids uuid[];now_difference bigint;target bigint;delta integer;increased integer:=0;decreased integer:=0;
  shortages integer:=0;total_delta bigint:=0;result jsonb;
begin
  actor:=private.require_operator_capability('catalog.manage',false);
  reason:=btrim(coalesce(p_reason,''),E' \t\n\r\f\v');
  if p_snapshot_id is null or p_expected_changes is null or p_expected_changes<0 then
    raise invalid_parameter_value using message='invalid_stock_reconcile_apply';
  end if;
  if char_length(reason) not between 1 and 200 or reason ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message='invalid_stock_reconcile_reason';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stock_reconcile:'||p_snapshot_id::text,0));
  select * into snap from private.stock_reconcile_snapshots where id=p_snapshot_id for update;
  if not found then raise no_data_found using message='stock_reconcile_not_found';end if;
  if snap.applied_at is not null then
    if snap.applied_by=actor and snap.apply_reason=reason and (snap.apply_result->>'expectedChanges')::integer=p_expected_changes then
      return jsonb_build_object('status','applied','replayed',true,'snapshot',private.stock_reconcile_document(snap.id));
    end if;
    raise sqlstate 'PT409' using message='stock_reconcile_already_applied';
  end if;
  if snap.created_at<clock_timestamp()-interval '24 hours' then
    raise check_violation using message='stock_reconcile_expired';
  end if;
  changed_ids:=array(select i.variant_id from private.stock_reconcile_snapshot_items i where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty);
  preview_changes:=cardinality(changed_ids);
  if preview_changes<>p_expected_changes then raise sqlstate 'PT409' using message='stock_reconcile_preview_mismatch';end if;

  perform 1 from public.goods g where g.id in(select v.good_id from public.goods_variants v where v.id=any(changed_ids)) order by g.id for update;
  perform 1 from public.goods_variants v where v.id=any(changed_ids) order by v.id for update;

  for item in
    select i.*,v.good_id as current_good_id,v.stock_qty as current_stock,v.archived_at as variant_archived_at,g.archived_at as goods_archived_at,
      g.name as goods_name,v.name as option_name,v.code as option_code,f.pending_qty as now_pending,f.shipped_since_qty as now_shipped,
      f.returned_since_qty as now_returned,f.awaiting_return_qty as now_awaiting
    from private.stock_reconcile_snapshot_items i
    join public.goods_variants v on v.id=i.variant_id
    join public.goods g on g.id=v.good_id
    join private.stock_reconcile_flows(changed_ids,snap.as_of) f on f.variant_id=i.variant_id
    where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty
    order by v.good_id,i.variant_id
  loop
    now_difference:=item.file_qty::bigint-(item.current_stock::bigint+item.now_pending+item.now_awaiting+item.now_shipped-item.now_returned);
    if now_difference<>item.difference or item.variant_archived_at is not null or item.goods_archived_at is not null then
      conflicts:=conflicts||jsonb_build_object('variantId',item.variant_id,'goodsName',item.goods_name,'optionName',item.option_name,
        'optionCode',item.option_code,'previewDifference',item.difference,'currentDifference',now_difference,
        'reason',case when item.goods_archived_at is not null then 'goods_archived' when item.variant_archived_at is not null then 'option_stopped' else 'changed' end);
    end if;
  end loop;
  if jsonb_array_length(conflicts)>0 then
    return jsonb_build_object('status','conflict','conflicts',conflicts);
  end if;

  for item in
    select i.*,v.good_id as current_good_id,v.stock_qty as current_stock from private.stock_reconcile_snapshot_items i
    join public.goods_variants v on v.id=i.variant_id
    where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty
    order by v.good_id,i.variant_id
  loop
    target:=greatest(item.current_stock::bigint+item.difference,0);
    delta:=(target-item.current_stock)::integer;
    if delta<>0 then
      perform private.change_goods_variant_stock(item.current_good_id,item.variant_id,delta::bigint);
    end if;
    update private.stock_reconcile_snapshot_items set applied_delta=delta,stock_after=target::integer
      where snapshot_id=snap.id and variant_id=item.variant_id;
    if delta>0 then increased:=increased+1;elsif delta<0 then decreased:=decreased+1;end if;
    if item.current_stock::bigint+item.difference<0 then shortages:=shortages+1;end if;
    total_delta:=total_delta+delta;
    insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.stock_reconciled','goods:'||item.current_good_id,
      jsonb_build_object('snapshotId',snap.id,'variantId',item.variant_id,'from',item.current_stock,'delta',delta,'to',target,
        'fileQty',item.file_qty,'pendingQty',item.pending_qty,'shippedSinceQty',item.shipped_since_qty,
        'returnedSinceQty',item.returned_since_qty,'awaitingReturnQty',item.awaiting_return_qty,'asOf',snap.as_of,'reason',reason));
  end loop;

  result:=jsonb_build_object('expectedChanges',p_expected_changes,'changed',increased+decreased,'increased',increased,
    'decreased',decreased,'shortages',shortages,'totalDelta',total_delta);
  update private.stock_reconcile_snapshots set applied_at=clock_timestamp(),applied_by=actor,apply_reason=reason,apply_result=result
    where id=snap.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.stock_reconcile.applied','stock_reconcile:'||snap.id,
    result||jsonb_build_object('originId',snap.origin_id,'asOf',snap.as_of,'sourceLabel',snap.source_label,'reason',reason));
  return jsonb_build_object('status','applied','replayed',false,'snapshot',private.stock_reconcile_document(snap.id));
end $$;
revoke all on function public.admin_apply_stock_reconcile(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_apply_stock_reconcile(uuid,integer,text) to authenticated;

create function public.admin_get_stock_reconcile(p_snapshot_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare document jsonb;
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
  if p_snapshot_id is null then raise invalid_parameter_value using message='invalid_stock_reconcile_snapshot';end if;
  document:=private.stock_reconcile_document(p_snapshot_id);
  if document is null then raise no_data_found using message='stock_reconcile_not_found';end if;
  return document;
end $$;
revoke all on function public.admin_get_stock_reconcile(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_stock_reconcile(uuid) to authenticated;

create function public.admin_list_stock_reconciles(p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_operator_capability('catalog.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
  if p_limit is null or p_limit not between 1 and 50 then raise invalid_parameter_value using message='invalid_stock_reconcile_limit';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'originName',o.name,'sourceLabel',s.source_label,'asOf',s.as_of,
      'createdAt',s.created_at,'createdByName',coalesce(creator.nickname,''),'rowCount',s.row_count,'matchedCount',s.matched_count,
      'issueCount',s.issue_count,
      'changedCount',(select count(*) from private.stock_reconcile_snapshot_items i where i.snapshot_id=s.id and i.target_qty<>i.stock_qty),
      'appliedAt',s.applied_at,'appliedByName',applier.nickname,'applyResult',s.apply_result) order by s.created_at desc,s.id desc)
    from (select * from private.stock_reconcile_snapshots order by created_at desc,id desc limit p_limit) s
    left join public.fulfillment_origins o on o.id=s.origin_id
    left join public.profiles creator on creator.id=s.created_by
    left join public.profiles applier on applier.id=s.applied_by),'[]'::jsonb);
end $$;
revoke all on function public.admin_list_stock_reconciles(integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_stock_reconciles(integer) to authenticated;

-- 출고지시 전 경고. 지금 출고를 기다리는 옵션(결제·발주확인된 주문의 미출고 배송 건, 그룹상품 전환 뒤에는
-- 지금 재고를 가진 승계 옵션)마다 가장 최근 재고 파일을 기준으로 지금 다시 대조하면 생길 차이를 계산한다.
--   창고 예상 수량 = 파일 − 기준 시각 뒤 출고 + 기준 시각 뒤 회수 − 회수 뒤 재고 미반영(보낼 수 있는 실물)
--   부족 = 출고 대기 > 창고 예상 수량(창고가 다 보낼 수 없다), 차이 = 위 대조 공식
-- 파일이 없는 옵션은 '대조 기록 없음'으로 따로 센다.
create function public.admin_stock_dispatch_warnings(p_origin_id uuid,p_min_difference integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
  if p_min_difference is null or p_min_difference not between 1 and 1000000 then
    raise invalid_parameter_value using message='invalid_stock_dispatch_warning_threshold';
  end if;
  with holders as (
    select h.source_id,h.holder_id from private.stock_reconcile_holders() h
  ), batch as (
    select distinct coalesce(h.holder_id,oi.variant_id) as variant_id
    from public.order_shipments s
    join public.orders o on o.id=s.order_id
    join public.order_shipment_items si on si.shipment_id=s.id
    join public.order_items oi on oi.id=si.order_item_id
    left join holders h on h.source_id=oi.variant_id
    where s.status='ready' and o.status in ('paid','confirmed','shipping') and s.fulfillment_partition<>'digital'
      and (p_origin_id is null or s.origin_id=p_origin_id)
      and (oi.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations r
        where r.order_item_id=oi.id and r.state='allocated'))
  ), latest as (
    select distinct on (i.variant_id) i.variant_id,i.file_qty,s.as_of,s.created_at,s.id as snapshot_id
    from private.stock_reconcile_snapshot_items i
    join private.stock_reconcile_snapshots s on s.id=i.snapshot_id
    where i.variant_id in(select variant_id from batch)
    order by i.variant_id,s.as_of desc,s.created_at desc,s.id desc
  ), latest_flows as (
    -- 흐름은 기준 시각이 같은 옵션끼리 한 번에 센다.
    select grouped.as_of,f.* from (select l.as_of,array_agg(l.variant_id) as ids from latest l group by l.as_of) grouped
    cross join lateral private.stock_reconcile_flows(grouped.ids,grouped.as_of) f
  ), measured as (
    select l.*,v.stock_qty,v.name as option_name,v.code as option_code,g.id as good_id,g.code as goods_code,g.name as goods_name,
      f.pending_qty,f.shipped_since_qty,f.returned_since_qty,f.awaiting_return_qty,
      l.file_qty::bigint-f.shipped_since_qty+f.returned_since_qty-f.awaiting_return_qty as expected_qty,
      l.file_qty::bigint-(v.stock_qty::bigint+f.pending_qty+f.awaiting_return_qty+f.shipped_since_qty-f.returned_since_qty) as difference
    from latest l
    join latest_flows f on f.variant_id=l.variant_id and f.as_of=l.as_of
    join public.goods_variants v on v.id=l.variant_id
    join public.goods g on g.id=v.good_id
  ), unreconciled_ids as (
    select b.variant_id from batch b where not exists(select 1 from latest l where l.variant_id=b.variant_id)
  ), unreconciled as (
    select u.variant_id,v.name as option_name,v.code as option_code,g.name as goods_name,f.pending_qty
    from unreconciled_ids u
    join private.stock_reconcile_flows(array(select ui.variant_id from unreconciled_ids ui),clock_timestamp()) f on f.variant_id=u.variant_id
    join public.goods_variants v on v.id=u.variant_id
    join public.goods g on g.id=v.good_id
  )
  select jsonb_build_object(
    'originId',p_origin_id,'minDifference',p_min_difference,'checkedAt',clock_timestamp(),
    'batchVariantCount',(select count(*) from batch),
    'latestAsOf',(select max(as_of) from latest),
    'warnings',coalesce((select jsonb_agg(jsonb_build_object('variantId',m.variant_id,'goodId',m.good_id,'goodsCode',m.goods_code,
        'goodsName',m.goods_name,'optionName',m.option_name,'optionCode',m.option_code,
        'kind',case when m.pending_qty>m.expected_qty then 'shortage' else 'mismatch' end,
        'snapshotId',m.snapshot_id,'asOf',m.as_of,'fileQty',m.file_qty,'stockQty',m.stock_qty,'pendingQty',m.pending_qty,
        'shippedSinceQty',m.shipped_since_qty,'returnedSinceQty',m.returned_since_qty,'awaitingReturnQty',m.awaiting_return_qty,
        'expectedQty',m.expected_qty,'difference',m.difference,'shortageQty',greatest(m.pending_qty-m.expected_qty,0))
      order by (m.pending_qty>m.expected_qty) desc,abs(m.difference) desc,m.goods_name,m.option_code)
      from measured m where m.pending_qty>m.expected_qty or abs(m.difference)>=p_min_difference),'[]'::jsonb),
    'unreconciledCount',(select count(*) from unreconciled),
    'unreconciled',coalesce((select jsonb_agg(jsonb_build_object('variantId',u.variant_id,'goodsName',u.goods_name,
        'optionName',u.option_name,'optionCode',u.option_code,'pendingQty',u.pending_qty) order by u.goods_name,u.option_code)
      from (select * from unreconciled order by goods_name,option_code limit 20) u),'[]'::jsonb))
  into result;
  return result;
end $$;
revoke all on function public.admin_stock_dispatch_warnings(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_stock_dispatch_warnings(uuid,integer) to authenticated;

select private.register_operator_rpc_contract('public.admin_preview_stock_reconcile(uuid,timestamptz,text,jsonb)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_apply_stock_reconcile(uuid,integer,text)'::regprocedure,'catalog.manage','write',false);
select private.register_operator_rpc_contract('public.admin_get_stock_reconcile(uuid)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_list_stock_reconciles(integer)'::regprocedure,'catalog.read','read',false);
select private.register_operator_rpc_contract('public.admin_stock_dispatch_warnings(uuid,integer)'::regprocedure,'sales.read','read',false);

commit;
notify pgrst,'reload schema';

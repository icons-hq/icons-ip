-- 재고 대조 반영 재계산(QA 라운드 1 운영 S-T07-01, 오케스트레이터 결정 a안).
--
-- 지금까지 확정은 '차이'(파일 − 재고수량·실물 흐름의 합)만 다시 봤다. 주문·취소·출고·회수는 차이를 바꾸지 않으므로, 미리보기 뒤
-- 고객 주문이 들어오면 '10 → 맞춘 뒤 7'로 확인한 옵션이 알림 없이 6으로 반영됐고, 결과 표·감사는 미리보기 시점의 재고수량·출고 대기를
-- 그대로 보여 계산이 맞지 않았다(반영 전 10 · 출고 대기 0 · 반영 뒤 6, 감사 pendingQty 0).
--
-- 바꾼 규칙: 운영자가 미리보기에서 확인한 숫자 그대로만 재고를 바꾼다(T18 ERP 반영의 '잠금 뒤 재계산해 다르면 전부 거절'과 같은 규칙).
--   · 잠금(상품 → 옵션) 뒤 미리보기한 옵션 전부의 재고수량·실물 흐름을 다시 잰다.
--   · 바뀌는 옵션은 '맞춘 뒤' 재고수량이 미리보기와 같고(다르면 출고 대기 변동 — 미리보기 뒤 주문·취소·출고·회수) 차이도 같아야
--     한다(다르면 재고 변동 — 재고 조정·다른 대조). 상품 보관·옵션 사용 중지도 거절한다(기존).
--   · 같은 옵션(반영할 것이 없던 옵션)은 지금도 반영할 것이 없어야 한다. 주문으로 재고수량과 맞춘 뒤 값이 함께 움직인 것은 괜찮다.
--   · 하나라도 어긋나면 아무것도 바꾸지 않고 바뀐 옵션(미리보기 값·지금 값·이유)을 돌려준다. 화면은 다시 미리보기로 잇는다.
--   · 통과하면 미리보기한 '맞춘 뒤' 값으로 반영하고, 반영 시점 값(반영 전 재고수량·출고 대기·기준 시각 뒤 출고·회수·회수 뒤 미반영)을
--     옵션마다 기록한다. 결과 표·옵션별 감사는 이 값을 쓴다(미리보기 값은 감사에 previewStockQty·previewPendingQty로 함께 남긴다).
-- 멱등(같은 확정 재전송은 처음 결과)·이중 반영 방지(다른 사유 재확정 거절)·기대 건수 대조·24시간 만료는 그대로다.
-- 20261112160000은 웨이브 1 통합에 있어 고치지 않는다. 다른 수정과 겹치면 바로 알 수 있게 앵커 치환으로 필요한 곳만 바꾼다(각 앵커 정확히 1회).
begin;

alter table private.stock_reconcile_snapshot_items
  add column stock_before integer check(stock_before is null or stock_before>=0),
  add column applied_pending_qty integer check(applied_pending_qty is null or applied_pending_qty>=0),
  add column applied_shipped_since_qty integer check(applied_shipped_since_qty is null or applied_shipped_since_qty>=0),
  add column applied_returned_since_qty integer check(applied_returned_since_qty is null or applied_returned_since_qty>=0),
  add column applied_awaiting_return_qty integer check(applied_awaiting_return_qty is null or applied_awaiting_return_qty>=0),
  add constraint stock_reconcile_snapshot_items_applied_values_check check(
    (stock_before is null)=(applied_pending_qty is null) and (stock_before is null)=(applied_shipped_since_qty is null)
    and (stock_before is null)=(applied_returned_since_qty is null) and (stock_before is null)=(applied_awaiting_return_qty is null));
comment on column private.stock_reconcile_snapshot_items.stock_before is
  '반영할 때 잠금 뒤 다시 잰 반영 전 재고수량. applied_* 열과 함께 결과 표·옵션별 감사가 쓰는 반영 시점 값이다(이 열 전 반영 기록은 비어 있음).';

-- 한 함수의 앵커를 차례로 바꾼다. 각 앵커는 바꾸기 전 정의에 정확히 한 번 있어야 한다.
create function pg_temp.patch_stock_reconcile(p_function regprocedure,p_label text,p_anchors text[],p_replacements text[])
returns void language plpgsql as $$
declare definition text:=pg_get_functiondef(p_function);i integer;
begin
  for i in 1..cardinality(p_anchors) loop
    if (length(definition)-length(replace(definition,p_anchors[i],'')))/length(p_anchors[i])<>1 then
      raise exception '%_anchor_%_changed',p_label,i;
    end if;
    definition:=replace(definition,p_anchors[i],p_replacements[i]);
  end loop;
  execute definition;
end $$;

select pg_temp.patch_stock_reconcile('public.admin_apply_stock_reconcile(uuid,integer,text)'::regprocedure,'stock_reconcile_apply',array[
$a$  shortages integer:=0;total_delta bigint:=0;result jsonb;$a$,
$a$  for item in
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
  end if;$a$,
$a$  for item in
    select i.*,v.good_id as current_good_id,v.stock_qty as current_stock from private.stock_reconcile_snapshot_items i
    join public.goods_variants v on v.id=i.variant_id
    where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty
    order by v.good_id,i.variant_id
  loop
    target:=greatest(item.current_stock::bigint+item.difference,0);$a$,
$a$        'fileQty',item.file_qty,'pendingQty',item.pending_qty,'shippedSinceQty',item.shipped_since_qty,
        'returnedSinceQty',item.returned_since_qty,'awaitingReturnQty',item.awaiting_return_qty,'asOf',snap.as_of,'reason',reason));$a$
],array[
$r$  shortages integer:=0;total_delta bigint:=0;result jsonb;
  matched_ids uuid[];now_target bigint;flow_changed boolean;stock_changed boolean;
  checked_ids uuid[]:='{}';checked_stock integer[]:='{}';checked_pending integer[]:='{}';checked_shipped integer[]:='{}';
  checked_returned integer[]:='{}';checked_awaiting integer[]:='{}';$r$,
$r$  -- 잠금 뒤 미리보기한 옵션 전부를 다시 잰다(QA1 S-T07-01). 운영자가 확인한 숫자 그대로만 재고를 바꾼다.
  --   · 바뀌는 옵션: 맞춘 뒤 재고수량(출고 대기 등 실물 흐름이 바뀌면 달라진다)과 차이(재고수량을 직접 바꾸면 달라진다)가
  --     미리보기와 같아야 한다. 상품 보관·옵션 사용 중지도 거절한다.
  --   · 같은 옵션: 지금도 반영할 것이 없어야 한다(주문으로 재고수량과 맞춘 뒤 값이 함께 움직인 것은 괜찮다).
  -- 하나라도 어긋나면 아무것도 바꾸지 않고 바뀐 옵션을 돌려준다. 통과하면 반영 시점 값을 기록한다(결과 표·감사가 쓴다).
  matched_ids:=array(select s.variant_id from private.stock_reconcile_snapshot_items s where s.snapshot_id=snap.id);
  for item in
    select i.*,v.good_id as current_good_id,v.stock_qty as current_stock,v.archived_at as variant_archived_at,g.archived_at as goods_archived_at,
      g.name as goods_name,v.name as option_name,v.code as option_code,f.pending_qty as now_pending,f.shipped_since_qty as now_shipped,
      f.returned_since_qty as now_returned,f.awaiting_return_qty as now_awaiting
    from private.stock_reconcile_snapshot_items i
    join public.goods_variants v on v.id=i.variant_id
    join public.goods g on g.id=v.good_id
    join private.stock_reconcile_flows(matched_ids,snap.as_of) f on f.variant_id=i.variant_id
    where i.snapshot_id=snap.id
    order by v.good_id,i.variant_id
  loop
    now_difference:=item.file_qty::bigint-(item.current_stock::bigint+item.now_pending+item.now_awaiting+item.now_shipped-item.now_returned);
    now_target:=greatest(item.file_qty::bigint-item.now_pending-item.now_awaiting-item.now_shipped+item.now_returned,0);
    flow_changed:=item.now_pending+item.now_awaiting+item.now_shipped-item.now_returned
      <>item.pending_qty::bigint+item.awaiting_return_qty+item.shipped_since_qty-item.returned_since_qty;
    stock_changed:=now_difference<>item.difference;
    if (item.target_qty<>item.stock_qty and (item.variant_archived_at is not null or item.goods_archived_at is not null))
      or stock_changed
      or (item.target_qty<>item.stock_qty and now_target<>item.target_qty)
      or (item.target_qty=item.stock_qty and now_target<>item.current_stock) then
      conflicts:=conflicts||jsonb_build_object('variantId',item.variant_id,'goodsName',item.goods_name,'optionName',item.option_name,
        'optionCode',item.option_code,'previewStockQty',item.stock_qty,'currentStockQty',item.current_stock,
        'previewPendingQty',item.pending_qty,'currentPendingQty',item.now_pending,'previewTargetQty',item.target_qty,'currentTargetQty',now_target,
        'previewDifference',item.difference,'currentDifference',now_difference,
        'reason',case when item.target_qty<>item.stock_qty and item.goods_archived_at is not null then 'goods_archived'
          when item.target_qty<>item.stock_qty and item.variant_archived_at is not null then 'option_stopped'
          when flow_changed and stock_changed then 'pending_and_stock_changed'
          when stock_changed then 'stock_changed' else 'pending_changed' end);
    end if;
    checked_ids:=array_append(checked_ids,item.variant_id);
    checked_stock:=array_append(checked_stock,item.current_stock);
    checked_pending:=array_append(checked_pending,item.now_pending::integer);
    checked_shipped:=array_append(checked_shipped,item.now_shipped::integer);
    checked_returned:=array_append(checked_returned,item.now_returned::integer);
    checked_awaiting:=array_append(checked_awaiting,item.now_awaiting::integer);
  end loop;
  if jsonb_array_length(conflicts)>0 then
    return jsonb_build_object('status','conflict','conflicts',conflicts);
  end if;
  update private.stock_reconcile_snapshot_items i set stock_before=c.stock_before,applied_pending_qty=c.pending_qty,
    applied_shipped_since_qty=c.shipped_since_qty,applied_returned_since_qty=c.returned_since_qty,applied_awaiting_return_qty=c.awaiting_return_qty
  from unnest(checked_ids,checked_stock,checked_pending,checked_shipped,checked_returned,checked_awaiting)
    as c(variant_id,stock_before,pending_qty,shipped_since_qty,returned_since_qty,awaiting_return_qty)
  where i.snapshot_id=snap.id and i.variant_id=c.variant_id;$r$,
$r$  for item in
    select i.*,v.good_id as current_good_id,v.stock_qty as current_stock from private.stock_reconcile_snapshot_items i
    join public.goods_variants v on v.id=i.variant_id
    where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty
    order by v.good_id,i.variant_id
  loop
    -- 잠금 뒤 다시 잰 맞춘 뒤 재고수량이 미리보기와 같음을 위에서 확인했다. 운영자가 확인한 그 값으로 맞춘다.
    target:=item.target_qty;$r$,
$r$        'fileQty',item.file_qty,'pendingQty',item.applied_pending_qty,'shippedSinceQty',item.applied_shipped_since_qty,
        'returnedSinceQty',item.applied_returned_since_qty,'awaitingReturnQty',item.applied_awaiting_return_qty,
        'previewStockQty',item.stock_qty,'previewPendingQty',item.pending_qty,'asOf',snap.as_of,'reason',reason));$r$
]);

-- 화면 문서: 반영 시점 값을 함께 싣는다(반영 전 미리보기는 모두 null).
select pg_temp.patch_stock_reconcile('private.stock_reconcile_document(uuid)'::regprocedure,'stock_reconcile_document',array[
$a$'appliedDelta',i.applied_delta,'stockAfter',i.stock_after,'preorder',v.preorder_policy_id is not null)$a$
],array[
$r$'appliedDelta',i.applied_delta,'stockAfter',i.stock_after,'preorder',v.preorder_policy_id is not null,
        'stockBefore',i.stock_before,'appliedPendingQty',i.applied_pending_qty,'appliedShippedSinceQty',i.applied_shipped_since_qty,
        'appliedReturnedSinceQty',i.applied_returned_since_qty,'appliedAwaitingReturnQty',i.applied_awaiting_return_qty)$r$
]);

-- 바꾼 RPC의 계약 지문을 같은 능력·가드로 다시 등록한다(operator_capability_coverage drift 방지).
do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array array['public.admin_apply_stock_reconcile(uuid,integer,text)'] loop
  fn:=signature::regprocedure;registered:=false;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);registered:=true;end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);registered:=true;
  end if;
  if not registered then raise exception 'operational_rpc_contract_missing: %',signature;end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';

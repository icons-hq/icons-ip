-- 재고 파일 대조(1007-009·1007-011, ADR-0005 보완).
--
-- 운영자가 ERP·창고 재고 파일(ICONS 몫 수량)을 올리면 옵션 할당 재고와의 차이를 미리 보여 주고,
-- 확정하면 행 잠금·멱등·감사 기록으로 반영한다. 자동 연동은 하지 않는다(ADR-0005·0016).
--
-- 파일 수량은 '그 시각 창고에 있던 실물'이다. 사이트 재고는 주문을 받을 때 이미 빠졌으므로
-- 아직 창고를 떠나지 않은 주문 수량(출고 대기)과 파일 기준 시각 뒤에 떠난 수량(기준 시각 뒤 출고)을
-- 더해야 파일과 같은 단위가 된다. 그래서
--   차이 = 파일 수량 − (재고수량 + 출고 대기 + 기준 시각 뒤 출고)
--   맞춘 뒤 재고수량 = max(재고수량 + 차이, 0) = max(파일 수량 − 출고 대기 − 기준 시각 뒤 출고, 0)
-- 이다. 주문 접수·취소·출고는 세 항을 함께 움직여 차이를 바꾸지 않는다. 그래서 확정 때 차이가
-- 미리보기와 같은지만 다시 보면 된다(수동 재고 조정·다른 대조가 끼면 다시 미리보기).
-- 파일 수량보다 출고 대기가 많으면 맞춘 뒤 재고수량은 0이고 '부족'으로 표시한다(창고가 보낼 수 없는 주문).
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
  variant_id uuid not null references public.goods_variants(id) on delete cascade,
  good_id text not null,
  source_row integer not null check(source_row>0),
  match_kind text not null check(match_kind in ('option_code','erp_code','barcode','goods_code')),
  file_qty integer not null check(file_qty between 0 and 100000000),
  stock_qty integer not null check(stock_qty>=0),
  pending_qty integer not null check(pending_qty>=0),
  shipped_since_qty integer not null check(shipped_since_qty>=0),
  difference integer not null,
  target_qty integer not null check(target_qty>=0),
  applied_delta integer,
  stock_after integer check(stock_after is null or stock_after>=0),
  primary key(snapshot_id,variant_id),
  check(target_qty=greatest(stock_qty+difference,0)),
  check((applied_delta is null)=(stock_after is null))
);
-- 출고 전 경고는 옵션마다 가장 최근 파일을 찾는다.
create index stock_reconcile_snapshot_items_variant on private.stock_reconcile_snapshot_items(variant_id,snapshot_id);

alter table private.stock_reconcile_snapshots enable row level security;
alter table private.stock_reconcile_snapshot_items enable row level security;
revoke all on private.stock_reconcile_snapshots,private.stock_reconcile_snapshot_items from public,anon,authenticated,service_role;

-- 옵션별 출고 대기·기준 시각 뒤 출고 수량. 재고를 이미 뺀 주문 품목만 센다:
--   재고 판매 품목, 예약판매는 실물을 배정(allocated)한 품목만. 취소 주문·취소 배송 건·디지털 파일은 제외한다.
--   배송 건이 아직 없으면(선물 수락 전 등) 창고를 떠나지 않은 것으로 본다.
-- 교환 재출고는 재출고 시각에 재고를 빼고 바로 보내므로 기준 시각 뒤 재출고분만 더한다.
-- 반품·교환 회수분이 기준 시각 뒤에 들어와 재고로 돌아온 경우는 세지 않는다(차이가 줄어드는 쪽, 런북 참고).
create function private.stock_reconcile_outbound(p_variant_ids uuid[],p_as_of timestamptz)
returns table(variant_id uuid,pending_qty bigint,shipped_since_qty bigint)
language sql stable security definer set search_path='' as $$
  with units as (
    select oi.variant_id,oi.qty::bigint as qty,
      (s.id is not null and (s.status in ('shipping','delivered') or s.shipped_at is not null)) as left_warehouse,
      coalesce(s.shipped_at,s.delivered_at) as left_at
    from public.order_items oi
    join public.orders o on o.id=oi.order_id
    left join public.order_shipment_items si on si.order_item_id=oi.id
    left join public.order_shipments s on s.id=si.shipment_id
    where oi.variant_id=any(p_variant_ids)
      and o.status<>'canceled'
      and (s.id is null or (s.status<>'canceled' and s.fulfillment_partition<>'digital'))
      and (oi.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations r
        where r.order_item_id=oi.id and r.state='allocated'))
    union all
    select ri.variant_id,ri.qty::bigint,true,c.reshipped_at
    from public.order_claim_reshipment_items ri
    join public.order_cancellation_requests c on c.id=ri.claim_id
    where ri.variant_id=any(p_variant_ids) and c.reshipped_at is not null
  )
  select target.id,
    coalesce(sum(u.qty) filter(where not u.left_warehouse),0)::bigint,
    coalesce(sum(u.qty) filter(where u.left_warehouse and u.left_at>p_as_of),0)::bigint
  from (select distinct id from unnest(p_variant_ids) as supplied(id) where id is not null) target
  left join units u on u.variant_id=target.id
  group by target.id;
$$;
revoke all on function private.stock_reconcile_outbound(uuid[],timestamptz) from public,anon,authenticated,service_role;

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

-- 화면 문서. 반영할 옵션(맞춘 뒤 재고수량이 다른 옵션)을 차이가 큰 순서로 먼저 둔다.
create function private.stock_reconcile_document(p_snapshot_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',s.id,'originId',s.origin_id,'originName',o.name,'sourceLabel',s.source_label,'asOf',s.as_of,
    'createdAt',s.created_at,'createdByName',coalesce(creator.nickname,''),
    'rowCount',s.row_count,'matchedCount',s.matched_count,'issueCount',s.issue_count,
    'changedCount',(select count(*) from private.stock_reconcile_snapshot_items i where i.snapshot_id=s.id and i.target_qty<>i.stock_qty),
    'appliedAt',s.applied_at,'appliedByName',applier.nickname,'applyReason',s.apply_reason,'applyResult',s.apply_result,
    'items',coalesce((select jsonb_agg(jsonb_build_object(
        'variantId',i.variant_id,'goodId',i.good_id,'goodsCode',g.code,'goodsName',g.name,'optionName',v.name,'optionCode',v.code,
        'sourceRow',i.source_row,'matchKind',i.match_kind,'fileQty',i.file_qty,'stockQty',i.stock_qty,'pendingQty',i.pending_qty,
        'shippedSinceQty',i.shipped_since_qty,'difference',i.difference,'targetQty',i.target_qty,
        'appliedDelta',i.applied_delta,'stockAfter',i.stock_after,'preorder',v.preorder_policy_id is not null)
      order by (i.target_qty<>i.stock_qty) desc,abs(i.difference) desc,g.name,v.sort_order,i.variant_id)
      from private.stock_reconcile_snapshot_items i
      join public.goods_variants v on v.id=i.variant_id
      join public.goods g on g.id=i.good_id
      where i.snapshot_id=s.id),'[]'::jsonb),
    'issues',s.issues)
  from private.stock_reconcile_snapshots s
  left join public.fulfillment_origins o on o.id=s.origin_id
  left join public.profiles creator on creator.id=s.created_by
  left join public.profiles applier on applier.id=s.applied_by
  where s.id=p_snapshot_id;
$$;
revoke all on function private.stock_reconcile_document(uuid) from public,anon,authenticated,service_role;

-- 미리보기: 파일 행을 검사·매칭하고 그 시점의 재고·출고 대기를 기록한다. 재고는 바꾸지 않는다.
create function public.admin_preview_stock_reconcile(p_origin_id uuid,p_as_of timestamptz,p_source_label text,p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;label text;snapshot uuid;resolved jsonb;matched integer;issues jsonb;now_at timestamptz:=clock_timestamp();
begin
  actor:=private.require_operator_capability('catalog.manage',false);
  label:=btrim(coalesce(p_source_label,''),E' \t\n\r\f\v');
  if p_as_of is null or p_as_of>now_at+interval '5 minutes' or p_as_of<now_at-interval '31 days' then
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

  insert into private.stock_reconcile_snapshots(origin_id,source_label,as_of,created_by,created_at,row_count,matched_count,issue_count,issues)
  values(p_origin_id,label,p_as_of,actor,now_at,jsonb_array_length(p_rows),matched,jsonb_array_length(issues),issues)
  returning id into snapshot;

  insert into private.stock_reconcile_snapshot_items(snapshot_id,variant_id,good_id,source_row,match_kind,file_qty,stock_qty,
    pending_qty,shipped_since_qty,difference,target_qty)
  select snapshot,r.variant_id,r.good_id,r.source_row,r.match_kind,r.file_qty,v.stock_qty,
    o.pending_qty::integer,o.shipped_since_qty::integer,
    (r.file_qty::bigint-(v.stock_qty::bigint+o.pending_qty+o.shipped_since_qty))::integer,
    greatest(r.file_qty::bigint-o.pending_qty-o.shipped_since_qty,0)::integer
  from jsonb_to_recordset(resolved) as r(source_row integer,variant_id uuid,good_id text,match_kind text,file_qty integer,issue text)
  join public.goods_variants v on v.id=r.variant_id
  join private.stock_reconcile_outbound(array(select (e->>'variant_id')::uuid from jsonb_array_elements(resolved) e
    where e->>'issue' is null),p_as_of) o on o.variant_id=r.variant_id
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
-- 잠금 순서는 재고 조정·주문과 같다: 상품(id 순) → 옵션(id 순).
create function public.admin_apply_stock_reconcile(p_snapshot_id uuid,p_expected_changes integer,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;reason text;snap private.stock_reconcile_snapshots;item record;conflicts jsonb:='[]'::jsonb;
  preview_changes integer;now_difference bigint;target bigint;delta integer;increased integer:=0;decreased integer:=0;
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
  select count(*) into preview_changes from private.stock_reconcile_snapshot_items where snapshot_id=snap.id and target_qty<>stock_qty;
  if preview_changes<>p_expected_changes then raise sqlstate 'PT409' using message='stock_reconcile_preview_mismatch';end if;

  perform 1 from public.goods g where g.id in(select i.good_id from private.stock_reconcile_snapshot_items i
    where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty) order by g.id for update;
  perform 1 from public.goods_variants v where v.id in(select i.variant_id from private.stock_reconcile_snapshot_items i
    where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty) order by v.id for update;

  for item in
    select i.*,v.stock_qty as current_stock,v.archived_at as variant_archived_at,g.archived_at as goods_archived_at,
      g.name as goods_name,v.name as option_name,v.code as option_code,o.pending_qty as current_pending,o.shipped_since_qty as current_shipped
    from private.stock_reconcile_snapshot_items i
    join public.goods_variants v on v.id=i.variant_id
    join public.goods g on g.id=i.good_id
    join private.stock_reconcile_outbound(array(select x.variant_id from private.stock_reconcile_snapshot_items x
      where x.snapshot_id=snap.id and x.target_qty<>x.stock_qty),snap.as_of) o on o.variant_id=i.variant_id
    where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty
    order by i.good_id,i.variant_id
  loop
    now_difference:=item.file_qty::bigint-(item.current_stock::bigint+item.current_pending+item.current_shipped);
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
    select i.*,v.stock_qty as current_stock from private.stock_reconcile_snapshot_items i
    join public.goods_variants v on v.id=i.variant_id
    where i.snapshot_id=snap.id and i.target_qty<>i.stock_qty
    order by i.good_id,i.variant_id
  loop
    target:=greatest(item.current_stock::bigint+item.difference,0);
    delta:=(target-item.current_stock)::integer;
    if delta<>0 then
      perform private.change_goods_variant_stock(item.good_id,item.variant_id,delta::bigint);
    end if;
    update private.stock_reconcile_snapshot_items set applied_delta=delta,stock_after=target::integer
      where snapshot_id=snap.id and variant_id=item.variant_id;
    if delta>0 then increased:=increased+1;elsif delta<0 then decreased:=decreased+1;end if;
    if item.current_stock::bigint+item.difference<0 then shortages:=shortages+1;end if;
    total_delta:=total_delta+delta;
    insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.good.stock_reconciled','goods:'||item.good_id,
      jsonb_build_object('snapshotId',snap.id,'variantId',item.variant_id,'from',item.current_stock,'delta',delta,'to',target,
        'fileQty',item.file_qty,'pendingQty',item.pending_qty,'shippedSinceQty',item.shipped_since_qty,'asOf',snap.as_of,'reason',reason));
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

-- 출고지시 전 경고. 지금 출고를 기다리는 옵션(결제·발주확인된 주문의 미출고 배송 건)마다
-- 가장 최근 재고 파일을 기준으로 지금 다시 대조하면 생길 차이를 계산한다.
--   창고 예상 수량 = 파일 수량 − 기준 시각 뒤 출고
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
  with batch as (
    select distinct oi.variant_id
    from public.order_shipments s
    join public.orders o on o.id=s.order_id
    join public.order_shipment_items si on si.shipment_id=s.id
    join public.order_items oi on oi.id=si.order_item_id
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
  ), measured as (
    select l.*,v.stock_qty,v.name as option_name,v.code as option_code,g.id as good_id,g.code as goods_code,g.name as goods_name,
      o.pending_qty,o.shipped_since_qty,
      l.file_qty::bigint-o.shipped_since_qty as expected_qty,
      l.file_qty::bigint-(v.stock_qty::bigint+o.pending_qty+o.shipped_since_qty) as difference
    from latest l
    join public.goods_variants v on v.id=l.variant_id
    join public.goods g on g.id=v.good_id
    cross join lateral private.stock_reconcile_outbound(array[l.variant_id],l.as_of) o
  ), unreconciled as (
    select b.variant_id,v.name as option_name,v.code as option_code,g.name as goods_name,o.pending_qty
    from batch b
    join public.goods_variants v on v.id=b.variant_id
    join public.goods g on g.id=v.good_id
    cross join lateral private.stock_reconcile_outbound(array[b.variant_id],clock_timestamp()) o
    where not exists(select 1 from latest l where l.variant_id=b.variant_id)
  )
  select jsonb_build_object(
    'originId',p_origin_id,'minDifference',p_min_difference,'checkedAt',clock_timestamp(),
    'batchVariantCount',(select count(*) from batch),
    'latestAsOf',(select max(as_of) from latest),
    'warnings',coalesce((select jsonb_agg(jsonb_build_object('variantId',m.variant_id,'goodId',m.good_id,'goodsCode',m.goods_code,
        'goodsName',m.goods_name,'optionName',m.option_name,'optionCode',m.option_code,
        'kind',case when m.pending_qty>m.expected_qty then 'shortage' else 'mismatch' end,
        'snapshotId',m.snapshot_id,'asOf',m.as_of,'fileQty',m.file_qty,'stockQty',m.stock_qty,'pendingQty',m.pending_qty,
        'shippedSinceQty',m.shipped_since_qty,'expectedQty',m.expected_qty,'difference',m.difference,
        'shortageQty',greatest(m.pending_qty-m.expected_qty,0))
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

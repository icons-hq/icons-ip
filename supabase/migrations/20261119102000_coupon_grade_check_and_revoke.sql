-- ============================================================================
-- ICONS · 쿠폰 등급 확인(코드 입력)과 잘못 발급한 쿠폰 개별 회수 (실운영 시나리오 원장 PAY-028·PAY-034)
--
-- ## 1. 코드 입력은 등급을 묻는다 (PAY-028)
--
-- 등급 혜택 쿠폰(coupons.grade_benefit)은 늘 코드 발급형이다. 그런데 코드 입력 발급
-- (claim_coupon_code·apply_cart_coupon_code → private.issue_coupon_code 'code_entry')은 회원 등급을
-- 묻지 않아, 코드를 아는 하위 등급 회원이 받아 썼다(20261023050000 머리말이 빈틈을 적어 둔 곳).
-- 이제 'code_entry'로 등급 혜택 쿠폰을 받으려는 회원의 현재 등급(profiles.loyalty_grade)이 쿠폰 등급보다
-- 낮으면 coupon_grade_required 로 거절한다.
--   - 이미 보유한 쿠폰을 돌려주는 경로(보유 판정)는 그대로다 — 승급·월간 지급으로 받은 쿠폰은 코드를 다시
--     넣어도 같은 한 장이고, 강등돼도 이미 받은 쿠폰은 그대로 쓴다(기존 계약).
--   - 승급 지급·월간 지급은 issue_coupon_code 를 거치지 않고 직접 넣으므로 영향이 없다. 운영자 지정 발급
--     ('admin_grant')·카카오('kakao_channel')도 등급을 묻지 않는다 — 운영자가 정한 대상이다.
--   - 등급은 캐시(profiles.loyalty_grade)로 판정한다. 승급 지급·월간 지급이 쓰는 같은 값이고 코드 입력이
--     승급 알림·쿠폰 지급 같은 부수 효과를 만들지 않게 재산정은 부르지 않는다.
--
-- ## 2. 지정 발급 쿠폰 개별 회수 (PAY-034)
--
-- 엉뚱한 고객에게 발급한 쿠폰을 개별로 회수할 길이 없었다(쿠폰 정의 중지는 정상 대상자까지 막는다).
--   - 표현: 행을 지우지 않고 status 값도 늘리지 않는다. user_coupons 에 revoked_at·revoked_by·revoke_reason 을
--     더하고 같은 줄에서 expires_at 을 지난 시각으로 당겨, 평가·결제·장바구니 선택이 이미 쓰는 만료 판정으로
--     쓰지 못하게 막는다(행 삭제는 coupon_redemptions FK·발급 장수 집계를 깨고, status 값 추가는 consume 의
--     status<>'used' 판정과 충돌한다). 만료 시각은 회수 시각보다 1분 앞으로 둔다 — 회수와 동시에 시작한
--     평가가 회수 직전 시각으로 비교해 통과하는 틈을 없앤다.
--   - 회수 가능: 미사용(active)만. 결제 대기 주문이 잡은 쿠폰을 포함한 사용(used)은 in_use 로 줄을
--     거절한다 — 주문을 취소하면 active 로 돌아오니 그 뒤 다시 회수한다.
--   - 회원 잠금(결제와 같은 lock_goods_transaction_actor) → user_coupons FOR UPDATE(id 순)로 결제와 같은 방향이다.
--     회수와 결제가 겹치면 한쪽이 먼저 끝나고 다른 쪽이 그 결과를 본다(결제가 먼저면 in_use, 회수가 먼저면 만료).
--   - 회수한 쿠폰은 같은 코드로 다시 받을 수 없다: 보유 판정이 회수된 행을 만나면 coupon_revoked 로 거절하고,
--     운영자 지정 발급 확인도 그 고객을 '회수한 쿠폰'으로 막는다. 발급 장수(issued_count)는 돌려주지 않는다
--     (한도는 소비된 채 — 더 필요하면 쿠폰 발급 한도를 올린다). 정상 재발급이 필요하면 새 쿠폰을 만든다.
--   - 회수한 쿠폰은 고객 쿠폰함·장바구니에서 사라진다(RLS: 본인 행은 revoked_at is null 만, 운영자는 전부).
--     결제 대기 주문 안내(get_my_unpaid_order_coupons)는 used 만 보므로 영향이 없다.
--   - 감사: 회수한 줄이 있으면 audit_log 'admin.coupon.revoked' 한 건(id = 작업 ID — 같은 작업 ID 재시도는
--     저장된 결과를 돌려주고, 내용이 다르면 충돌로 거절한다).
--   - 어드민 화면: 지정 발급 작업 결과 줄(발급 문서에 보유 상태 추가)과 고객 상세 쿠폰 탭(회수됨 상태 추가).
--
-- 기존 함수는 pg_get_functiondef + 앵커 치환으로 바꿀 줄만 바꾼다(앵커가 정확히 한 번이 아니면 멈춘다).
-- ============================================================================

begin;

create function private.o3b_patch_function(p_signature text,p_anchor text,p_replacement text)
returns void language plpgsql volatile set search_path='' as $$
declare body text; found_count integer;
begin
  body:=pg_get_functiondef(p_signature::regprocedure);
  found_count:=(length(body)-length(replace(body,p_anchor,'')))/length(p_anchor);
  if found_count<>1 then raise exception 'o3b_anchor_changed: % (found %)',p_signature,found_count; end if;
  execute replace(body,p_anchor,p_replacement);
end $$;
revoke all on function private.o3b_patch_function(text,text,text) from public,anon,authenticated,service_role;

-- ── 1. 회수 칸 ────────────────────────────────────────────────────────────────

alter table public.user_coupons
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.profiles(id) on delete set null,
  add column revoke_reason text;

alter table public.user_coupons
  add constraint user_coupons_revoke_shape check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and status = 'active' and char_length(btrim(revoke_reason)) between 2 and 500)
  );

comment on column public.user_coupons.revoked_at is
  '운영자가 잘못 발급한 쿠폰을 회수한 시각. 회수하면 expires_at 을 지난 시각으로 당겨 만료 판정으로 쓰지 못하게 막고, 고객 쿠폰함에서는 숨긴다. 미사용(active)만 회수한다.';

-- 고객은 회수되지 않은 본인 쿠폰만 본다. 운영자(marketing.manage)는 회수 이력까지 본다.
drop policy user_coupons_select_own_or_staff on public.user_coupons;
create policy user_coupons_select_own_or_staff on public.user_coupons for select
  using (
    (user_id = (select auth.uid()) and revoked_at is null)
    or (select public.has_operator_capability('marketing.manage'))
  );

-- ── 2. 코드 입력 등급 확인 + 회수된 보유 쿠폰 ────────────────────────────────

select private.o3b_patch_function('private.issue_coupon_code(text,uuid,text)',
  $a$order by (status='active') desc,issued_at desc,id limit 1;$a$,
  $n$order by (revoked_at is null) desc,(status='active') desc,issued_at desc,id limit 1;$n$);

select private.o3b_patch_function('private.issue_coupon_code(text,uuid,text)',
  $a$if held_id is not null then return held_id;end if;$a$,
  $n$if held_id is not null then
    -- 운영자가 회수한 쿠폰은 같은 코드로 다시 받을 수 없다(사용 가능한 다른 장이 있으면 위에서 그 장을 골랐다).
    if exists(select 1 from public.user_coupons where id=held_id and revoked_at is not null) then raise check_violation using message='coupon_revoked';end if;
    return held_id;
  end if;$n$);

select private.o3b_patch_function('private.issue_coupon_code(text,uuid,text)',
  $a$if p_source='code_entry' and coupon.issuance_mode='targeted' then raise check_violation using message='coupon_designated_recipient_required';end if;$a$,
  $n$if p_source='code_entry' and coupon.issuance_mode='targeted' then raise check_violation using message='coupon_designated_recipient_required';end if;
  -- 등급 혜택 쿠폰은 그 등급 이상 회원만 코드로 받는다(보유 쿠폰 반환은 위에서 끝났다).
  if p_source='code_entry' and coupon.grade_benefit is not null
    and coupon.grade_benefit>coalesce((select profile.loyalty_grade from public.profiles profile where profile.id=p_user_id),'welcome'::public.loyalty_grade)
    then raise check_violation using message='coupon_grade_required';end if;$n$);

-- ── 3. 운영자 지정 발급: 회수한 고객은 다시 발급하지 않는다 ───────────────────

select private.o3b_patch_function('private.coupon_issue_rows(public.coupons,uuid[])',
  $a$order by (status='active') desc,issued_at desc,id limit 1) held_id,$a$,
  $n$order by (revoked_at is null) desc,(status='active') desc,issued_at desc,id limit 1) held_id,$n$);

select private.o3b_patch_function('private.coupon_issue_rows(public.coupons,uuid[])',
  $a$case when p.id is null or p.role not in$a$,
  $n$case when exists(select 1 from public.user_coupons rv where rv.coupon_code=p_coupon.code and rv.user_id=ids.id and rv.revoked_at is not null
      and not exists(select 1 from public.user_coupons ok where ok.coupon_code=rv.coupon_code and ok.user_id=rv.user_id and ok.revoked_at is null)) then 'coupon_revoked'
    when p.id is null or p.role not in$n$);

-- 발급 작업 결과 줄에 그 쿠폰의 지금 상태(보유·사용·회수)를 싣는다.
select private.o3b_patch_function('private.coupon_issue_batch_document(uuid)',
  $a$left join public.profiles p on p.id=(row.value->>'userId')::uuid)$a$,
  $n$left join public.profiles p on p.id=(row.value->>'userId')::uuid
   left join public.user_coupons held on held.id=nullif(row.value->>'userCouponId','')::uuid)$n$);

select private.o3b_patch_function('private.coupon_issue_batch_document(uuid)',
  $a$row.value||jsonb_build_object('nickname',coalesce(p.nickname,'현재 고객 정보 없음'))$a$,
  $n$row.value||jsonb_build_object('nickname',coalesce(p.nickname,'현재 고객 정보 없음'),'heldStatus',held.status,'heldIssuedAt',held.issued_at,'revokedAt',held.revoked_at)$n$);

-- ── 4. 고객 상세 쿠폰 탭: 회수됨 상태 ─────────────────────────────────────────

select private.o3b_patch_function('public.admin_customer_detail(uuid,text,integer)',
  $a$'status',case when r.status='used' then 'used'$a$,
  $n$'status',case when r.revoked_at is not null then 'revoked' when r.status='used' then 'used'$n$);

select private.o3b_patch_function('public.admin_customer_detail(uuid,text,integer)',
  $a$least(h.expires_at,c.ends_at) as expires_at,h.used_order_id$a$,
  $n$least(h.expires_at,c.ends_at) as expires_at,h.used_order_id,h.revoked_at$n$);

drop function private.o3b_patch_function(text,text,text);

-- ── 5. 개별 회수 RPC ─────────────────────────────────────────────────────────

create function public.admin_revoke_user_coupons(p_user_coupon_ids uuid[],p_reason text,p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  reason text := btrim(coalesce(p_reason,''));
  ids uuid[];
  request jsonb;
  previous public.audit_log;
  revoke_at timestamptz;
  member uuid;
  target_id uuid;
  held public.user_coupons;
  line jsonb;
  lines jsonb := '[]'::jsonb;
  revoked_count integer := 0;
  result jsonb;
begin
  actor := private.require_operator_capability('marketing.manage', false);
  if p_operation_id is null then raise invalid_parameter_value using message = 'coupon_revoke_operation_required'; end if;
  if p_user_coupon_ids is null or cardinality(p_user_coupon_ids) = 0 or cardinality(p_user_coupon_ids) > 500
    or array_position(p_user_coupon_ids, null) is not null then
    raise invalid_parameter_value using message = 'coupon_revoke_targets_invalid';
  end if;
  if char_length(reason) not between 2 and 500 then raise invalid_parameter_value using message = 'coupon_revoke_reason_invalid'; end if;
  select array_agg(distinct target.id order by target.id) into ids from unnest(p_user_coupon_ids) as target(id);
  request := jsonb_build_object('userCouponIds', to_jsonb(ids), 'reason', reason);

  -- 회원 잠금(결제·코드 입력과 같은 키) → 쿠폰 행 순서. 회원은 id 순으로 잡아 겹치는 회수끼리 서로 기다리지 않는다.
  for member in select distinct held_row.user_id from public.user_coupons held_row where held_row.id = any(ids) order by held_row.user_id loop
    perform private.lock_goods_transaction_actor(member);
  end loop;

  select * into previous from public.audit_log where id = p_operation_id;
  if found then
    if previous.action is distinct from 'admin.coupon.revoked' or previous.actor_id is distinct from actor
      or previous.diff->'request' is distinct from request then
      raise check_violation using message = 'coupon_revoke_operation_conflict';
    end if;
    return (previous.diff->'result') || jsonb_build_object('replayed', true);
  end if;

  revoke_at := clock_timestamp();
  perform 1 from public.user_coupons where id = any(ids) order by id for update;

  foreach target_id in array ids loop
    select * into held from public.user_coupons where id = target_id;
    if not found then
      line := jsonb_build_object('userCouponId', target_id, 'status', 'not_found');
    elsif held.revoked_at is not null then
      line := jsonb_build_object('userCouponId', target_id, 'status', 'already_revoked', 'couponCode', held.coupon_code, 'userId', held.user_id);
    elsif held.status = 'used' then
      line := jsonb_build_object('userCouponId', target_id, 'status', 'in_use', 'couponCode', held.coupon_code, 'userId', held.user_id, 'usedOrderId', held.used_order_id);
    else
      update public.user_coupons
      set revoked_at = revoke_at, revoked_by = actor, revoke_reason = reason,
          expires_at = least(coalesce(expires_at, revoke_at - interval '1 minute'), revoke_at - interval '1 minute')
      where id = target_id;
      delete from public.cart_coupon_selections where user_coupon_id = target_id;
      revoked_count := revoked_count + 1;
      line := jsonb_build_object('userCouponId', target_id, 'status', 'revoked', 'couponCode', held.coupon_code, 'userId', held.user_id,
        'issuedSource', held.issued_source, 'issuedAt', held.issued_at,
        'issueBatchId', (select b.id from private.coupon_issue_batches b
          where b.coupon_code = held.coupon_code and b.status = 'completed'
            and b.result->'rows' @> jsonb_build_array(jsonb_build_object('userCouponId', held.id::text))
          order by b.finished_at, b.id limit 1));
    end if;
    lines := lines || jsonb_build_array(line);
  end loop;

  result := jsonb_build_object('operationId', p_operation_id, 'requestedCount', cardinality(ids), 'revokedCount', revoked_count, 'lines', lines);
  if revoked_count > 0 then
    insert into public.audit_log(id, actor_id, action, target, diff)
    values (p_operation_id, actor, 'admin.coupon.revoked', 'coupon_revoke:' || p_operation_id,
      jsonb_build_object('request', request, 'reason', reason, 'result', result));
  end if;
  return result;
end $$;

revoke all on function public.admin_revoke_user_coupons(uuid[],text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_revoke_user_coupons(uuid[],text,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_revoke_user_coupons(uuid[],text,uuid)'::regprocedure, 'marketing.manage', 'write', false);

-- ── 6. 운영자 계약 지문 재등록(본문을 바꾼 등록 함수) ─────────────────────────

select private.register_operator_internal_contract('private.issue_coupon_code(text,uuid,text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_customer_detail(uuid,text,integer)'::regprocedure, 'platform.manage', 'read', false);

notify pgrst, 'reload schema';

commit;

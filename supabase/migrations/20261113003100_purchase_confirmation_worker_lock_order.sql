begin;
-- 1014-079 후속(오케스트레이터 판단 ④, 2026-11-12): 자동 구매확정을 운영에서 배송완료 후 8일로 켜면 매일 KST 03:00
-- 자동 작업(settle_delivered_orders)이 결제 확정·선물·리뷰·[구매확정] 경로와 같은 고객을 함께 잠근다.
-- 지금 작업은 후보를 고르는 조회 안에서 고객마다 계정 작업 잠금을 기다려 잡고 배치가 끝날 때까지 쥔다. 결제·선물 경로는
-- 행위자 → 계정 작업 → 프로필(선물은 두 고객을 id 순서로) 순서라, 여러 고객이 엇갈리면 교착하고 결제 쪽이 희생될 수 있다.
--
-- 고친 뒤:
--  - 후보 조회는 아무것도 잠그지 않는다(purchase_confirmation_candidate — 계정 차단만 잠그지 않고 읽는 eligible 쌍둥이).
--  - 주문마다 하위 트랜잭션에서 결제·선물·리뷰 경로와 같은 순서(행위자 → 계정 작업 → 프로필 → 주문 → 확정 행)로,
--    기다리지 않고(try-lock·SKIP LOCKED) 잡는다. 하나라도 못 잡거나 확정할 수 없으면 그 주문의 잠금을 모두 풀고 건너뛴다.
--  - 확정 뒤 trigger(적립금 등)가 다른 트랜잭션을 기다리면 lock_timeout 100ms(교착 검사 1초보다 짧다)에서 그 주문만 되돌린다.
--  - 건너뛴 주문의 기한·자격은 그대로라 다음 실행이 다시 확정한다(누락 없이 지연만). 자동 작업은 남을 기다리며 쥐고 있지
--    않으므로, 결제·선물·리뷰 경로가 이 작업 때문에 교착 희생자가 되지 않는다.
-- 정책 값·확정 조건·확정 이력·적립금 지급은 바꾸지 않는다.

-- 후보용 자격: purchase_confirmation_eligible 본문에서 계정 차단 확인만 잠그지 않는 읽기로 바꾼 쌍둥이.
-- 확정 직전에는 잠근 뒤 원래 eligible로 다시 판정한다. 두 본문이 갈라지면 purchase_confirmation.sql이 알린다.
do $$
declare source text;anchor text:='not private.is_account_write_fenced(o.user_id)';header text:='FUNCTION private.purchase_confirmation_eligible(';
begin
 source:=pg_get_functiondef('private.purchase_confirmation_eligible(uuid)'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 or strpos(source,header)=0 then
  raise exception 'purchase_confirmation_candidate_source_changed';end if;
 source:=replace(source,header,'FUNCTION private.purchase_confirmation_candidate(');
 execute replace(source,anchor,'not exists(select 1 from private.account_action_fences fence where fence.subject_user_id=o.user_id)');
end $$;
revoke all on function private.purchase_confirmation_candidate(uuid) from public,anon,authenticated,service_role;

-- 앵커마다 정확한 등장 횟수를 확인하고, 모든 치환을 끝낸 본문을 한 번에 다시 만든다(중간 본문은 문법이 맞지 않는다).
create function pg_temp.settle_anchor(source text,anchor text,replacement text,expected integer default 1) returns text language plpgsql as $$
begin
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>expected then
  raise exception 'settle_delivered_orders_anchor_changed: %',anchor;end if;
 return replace(source,anchor,replacement);
end $$;
do $$
declare source text:=pg_get_functiondef('public.settle_delivered_orders()'::regprocedure);
begin
 source:=pg_temp.settle_anchor(source,'and private.purchase_confirmation_eligible(o.id)','and private.purchase_confirmation_candidate(o.id)');
 source:=pg_temp.settle_anchor(source,'perform 1 from public.profiles where id=item.user_id and suspended_at is null for no key update skip locked;',
$p$begin
  -- 주문마다 하위 트랜잭션. 결제·선물·리뷰 경로와 같은 순서(행위자 → 계정 작업 → 프로필 → 주문 → 확정 행)로 기다리지 않고
  -- 잡는다(키는 gift_lock_subjects·lock_account_action_subject와 같다). 못 잡거나 확정할 수 없으면 PC001로 이 주문만 되돌린다.
  if not pg_try_advisory_xact_lock(hashtextextended(item.user_id::text,0))
   or not pg_try_advisory_xact_lock(hashtextextended('account-action:'||item.user_id::text,0)) then raise sqlstate 'PC001';end if;
  perform 1 from public.profiles where id=item.user_id and suspended_at is null for no key update skip locked;$p$);
 source:=pg_temp.settle_anchor(source,'if not found then continue;end if;','if not found then raise sqlstate ''PC001'';end if;',2);
 source:=pg_temp.settle_anchor(source,'select * into confirmation from private.order_purchase_confirmations where order_id=item.id for update;',
$p$select * into confirmation from private.order_purchase_confirmations where order_id=item.id for update skip locked;
  if not found then raise sqlstate 'PC001';end if;$p$);
 source:=pg_temp.settle_anchor(source,'or not private.purchase_confirmation_eligible(item.id) then continue;end if;',
  'or not private.purchase_confirmation_eligible(item.id) then raise sqlstate ''PC001'';end if;');
 source:=pg_temp.settle_anchor(source,'n:=n+1;',
$p$n:=n+1;
  exception when sqlstate 'PC001' or lock_not_available or deadlock_detected then
   -- 경합(잠금 실패, 확정 뒤 trigger의 lock_timeout 초과)이나 자격 변화: 이 주문의 잠금·변경을 모두 되돌리고 다음 실행에 맡긴다.
   null;
  end;$p$);
 execute source;
end $$;
-- 확정 뒤 trigger가 남을 기다리는 시간을 교착 검사(deadlock_timeout 1초)보다 훨씬 짧게 묶는다. 후보 조회는 잠그지 않는다.
alter function public.settle_delivered_orders() set lock_timeout='100ms';
revoke all on function public.settle_delivered_orders() from public,anon,authenticated,service_role;
grant execute on function public.settle_delivered_orders() to service_role;
commit;

begin;
-- 1014-079(2026-11-12 사용자 결정): "리뷰 쓰며 함께 확정으로 진행하되 구매확정만 누를 수 있어야 하며,
-- 일정 기간이 지나면 자동으로 확정되는것도 켜놔야함". 리뷰는 늘 구매확정된 주문에만 남는다.
--  - 미확정(배송완료) 주문의 리뷰 등록은 확정 안내 확인을 받아 같은 트랜잭션에서 구매확정한다.
--    확정 자체는 [구매확정] 버튼과 같은 private.change_purchase_confirmation(구매자 직접 확정)을 그대로 부른다 —
--    done 전이·적립금 지급 trigger·이력·감사·잠금 순서를 복제하지 않는다.
--  - 리뷰 없이 [구매확정]만 누르는 confirm_my_purchase 길과 자동 구매확정 작업은 바꾸지 않는다.
--    자동 구매확정 정책 값(기본 꺼짐)도 이 migration이 켜지 않는다 — 운영값은 배포 뒤 어드민에서 저장한다.
--  - 이미 쓴 리뷰가 있는 미확정 주문은 소급 확정하지 않는다(과거 기록 불변). 리뷰 수정·삭제는 확정하지 않는다.

-- 구매확정을 막는 이유. 막을지 말지는 purchase_confirmation_eligible + 보류 하나로만 정하고, 여기서는 막힌 이유만 고른다
-- (판정이 두 군데로 갈라지지 않게 eligible이 참이면 보류 말고는 막지 않는다). null = 확정할 수 있거나 이미 확정됨.
create function private.purchase_confirmation_block_reason(p_order_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare target public.orders; on_hold boolean;
begin
 select * into target from public.orders where id=p_order_id;
 if not found then return 'order_missing';end if;
 if target.status='done' then return null;end if;
 if target.status<>'delivered' then return 'not_delivered';end if;
 select c.held into on_hold from private.order_purchase_confirmations c where c.order_id=target.id;
 if private.purchase_confirmation_eligible(target.id) then return case when coalesce(on_hold,false) then 'held' end;end if;
 if exists(select 1 from public.order_cancellation_requests r where r.order_id=target.id and r.status in('requested','processing','needs_review'))
  or exists(select 1 from public.order_cancellation_claims k where k.order_id=target.id) then return 'claim_in_progress';end if;
 if not private.order_all_items_delivered(target.id) then return 'not_all_delivered';end if;
 if private.is_account_write_fenced(target.user_id) then return 'account_restricted';end if;
 return 'unavailable';
end $$;
revoke all on function private.purchase_confirmation_block_reason(uuid) from public,anon,authenticated,service_role;

-- 기존 리뷰 작성 함수는 확정 안내를 거치지 않으므로 미확정 주문에는 리뷰를 남기지 않는다.
-- 다른 자격 오류(기간·중복·결제 원본)가 먼저 나오도록 저장 직전에 검사한다. create_good_review(v1)도 이 함수를 거친다.
do $$
declare signature regprocedure:='public.create_good_review_v2(uuid,text,integer,text,text[],text)'::regprocedure;
 source text; anchor text:='paths:=private.assert_own_review_image_paths(target_image_paths,actor);';
begin
 source:=pg_get_functiondef(signature);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'review_confirms_purchase_create_source_changed';end if;
 execute replace(source,anchor,
  '-- 1014-079: 리뷰는 구매확정된 주문에만 남는다. 미확정 주문은 create_good_review_v3가 확정한 뒤 이 함수를 부른다.
 if ordered.status=''delivered'' then raise check_violation using message=''review_purchase_confirmation_required'';end if;
 '||anchor);
end $$;

-- 리뷰 등록 = 구매확정. 미확정 주문이면 확인 체크(p_acknowledged)를 받아 구매확정한 뒤 같은 트랜잭션에서 리뷰를 저장한다.
-- 리뷰 저장이 어떤 이유로든 실패하면 구매확정도 함께 되돌아간다. 이미 확정된 주문은 확인 없이 리뷰만 저장한다.
-- 같은 리뷰를 다시 보내면 review_already_exists로 끝나며 확정·적립은 늘지 않는다(주문당 확정 1회, 주문×굿즈×유형당 리뷰 1개).
create function public.create_good_review_v3(target_order_id uuid,target_good_id text,target_rating integer,target_body text,target_image_paths text[],target_kind text,
 p_acknowledged boolean,p_actor uuid,p_session uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();ordered public.orders;confirmation_revision bigint;reason text;created uuid;confirmed boolean:=false;
begin
 if actor is null then raise invalid_authorization_specification using message='auth_required';end if;
 -- 잠금 순서: 행위자 잠금(결제·선물·리뷰 경로 공통의 첫 잠금) → 구매확정 세션 검사(프로필 NO KEY UPDATE → 계정 작업 잠금)
 -- → 주문 → 확정 행. 계정 작업 잠금보다 프로필을 먼저 잡아야 [구매확정] 버튼·자동 작업(프로필 → 계정 작업)과 엇갈리지 않고,
 -- 행위자 잠금을 먼저 잡아 결제·선물 경로(행위자 → 계정 작업 → 프로필)와도 엇갈리지 않는다.
 -- 뒤에 부르는 create_good_review_v2의 계정 잠금(gift_lock_subjects·lock_operator_subjects)은 이미 쥔 잠금을 다시 잡을 뿐이다.
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 perform private.purchase_confirmation_identity(p_actor,p_session,false);
 select * into ordered from public.orders where id=target_order_id and user_id=actor for update;
 if not found then raise no_data_found using message='review_order_not_found';end if;
 if ordered.status='delivered' then
  if p_acknowledged is distinct from true then raise invalid_parameter_value using message='review_purchase_confirmation_ack_required';end if;
  reason:=private.purchase_confirmation_block_reason(ordered.id);
  if reason is not null then raise check_violation using message='review_purchase_confirmation_blocked',detail=reason;end if;
  -- 정책 저장의 소급 기한 채우기도 확정 행 revision을 올리므로, 확정 행을 잠근 뒤의 revision으로 확정한다.
  select c.revision into confirmation_revision from private.order_purchase_confirmations c where c.order_id=ordered.id for update;
  perform private.change_purchase_confirmation(ordered.id,'confirm','리뷰 등록과 함께 확정',coalesce(confirmation_revision,0),gen_random_uuid(),p_actor,p_session,false);
  confirmed:=true;
 end if;
 created:=public.create_good_review_v2(target_order_id,target_good_id,target_rating,target_body,coalesce(target_image_paths,'{}'::text[]),target_kind);
 return jsonb_build_object('reviewId',created,'purchaseConfirmed',confirmed);
end $$;
revoke all on function public.create_good_review_v3(uuid,text,integer,text,text[],text,boolean,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_good_review_v3(uuid,text,integer,text,text[],text,boolean,uuid,uuid) to authenticated;

-- 리뷰 대상 + 구매확정 상태. v2 행을 그대로 두고 확정 필요 여부·막힌 이유를 붙인다.
-- 미확정 주문은 구매확정할 수 있을 때만 작성 가능하다. 보류 사유는 관리자가 고객에게 보이려고 적은 문구다.
create function public.my_review_targets_v3(target_order_id uuid default null,target_good_id text default null,target_limit integer default 50)
returns table(order_id uuid,good_id text,good_name text,good_bg text,good_image_path text,ordered_at timestamptz,delivered_at timestamptz,deadline_at timestamptz,
 writable boolean,review_id uuid,review_rating smallint,review_body text,review_image_paths text[],review_status text,review_created_at timestamptz,
 review_edited_at timestamptz,admin_reply text,admin_reply_at timestamptz,review_kind text,opens_at timestamptz,editable boolean,month_reward_eligible boolean,
 repeat_purchase boolean,order_number text,purchase_confirmation_required boolean,purchase_confirmation_block text,purchase_confirmation_hold_reason text)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise invalid_authorization_specification using message='auth_required';end if;
 return query
 select source.order_id,source.good_id,source.good_name,source.good_bg,source.good_image_path,source.ordered_at,source.delivered_at,source.deadline_at,
  source.writable and gate.reason is null,source.review_id,source.review_rating,source.review_body,source.review_image_paths,source.review_status,
  source.review_created_at,source.review_edited_at,source.admin_reply,source.admin_reply_at,source.review_kind,source.opens_at,source.editable,
  source.month_reward_eligible,source.repeat_purchase,source.order_number,purchase.status='delivered',gate.reason,
  case when gate.reason='held' then confirmation.hold_reason end
 from public.my_review_targets_v2(target_order_id,target_good_id,target_limit) with ordinality source
 join public.orders purchase on purchase.id=source.order_id
 left join private.order_purchase_confirmations confirmation on confirmation.order_id=purchase.id
 cross join lateral (select private.purchase_confirmation_block_reason(purchase.id) reason) gate
 order by source.ordinality;
end $$;
revoke all on function public.my_review_targets_v3(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.my_review_targets_v3(uuid,text,integer) to authenticated;

notify pgrst,'reload schema';
commit;

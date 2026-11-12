-- TKT-019·TKT-099 문의 자동 안내 저장 권한.
-- 원래 요청(스펙 #501 US19): "CS 담당으로서, 문의 카테고리별 자동 첫 안내 문구를 운영 설정에서 켜고 끄고 고치길 원한다".
-- 사용자 결정(2026-11-11 묶음 16) "아무나 가능하게" → 확인(2026-11-12 묶음 21) "이대로 (Recommended)":
-- 자동 첫 안내 설정 화면을 여는 모든 운영자가 켜고 끄고 문구를 저장한다. 화면을 여는 권한은 지금처럼 스토어 관리(store.manage —
-- 통합·주·부매니저·인플루언서·대행사, 매니저 권한 전환 전 호환 단계의 기존 운영자 전원)다.
-- 지금까지 이 섹션은 호환 단계에서 admin만 저장했다(legacy_admin_only=true). 그 조건만 이 섹션에서 뺀다.
-- 같은 RPC의 다른 섹션(사업자·CS 연락처·무통장 계좌 = seller.manage, 호환 단계 admin 전용)은 그대로다.
-- 저장 감사(admin.store_settings.updated, 변경 전후)와 버전 충돌 검사는 바꾸지 않는다.
--
-- 다른 트랙이 같은 함수를 고칠 수 있어 pg_get_functiondef + 앵커 치환으로 최소만 바꾼다(앵커가 정확히 3번 — 진입 잠금 검사,
-- 공개 능력 검사, 행 단위 능력 검사 — 나와야 한다). 같은 migration 끝에서 운영자 계약 지문을 다시 적는다(분류는 기존 행 그대로).
do $patch$
declare
  body text;
  anchor constant text := $a$case when target_section='inquiry_auto_replies' then 'store.manage' else 'seller.manage' end,true$a$;
  found_count integer;
begin
  body := pg_get_functiondef('public.admin_save_store_settings(text,jsonb,timestamp with time zone)'::regprocedure);
  found_count := (length(body) - length(replace(body, anchor, ''))) / length(anchor);
  if found_count <> 3 then
    raise exception 'inquiry_auto_reply_save_anchor_changed: % (expected 3)', found_count;
  end if;
  -- 호환 단계 admin 전용 여부를 섹션으로 정한다: 문의 자동 안내만 false, 나머지(사업자·계좌)는 지금처럼 true.
  execute replace(body, anchor,
    $a$case when target_section='inquiry_auto_replies' then 'store.manage' else 'seller.manage' end,target_section is distinct from 'inquiry_auto_replies'$a$);
end $patch$;

select private.register_operator_rpc_contract('public.admin_save_store_settings(text,jsonb,timestamp with time zone)'::regprocedure,'seller.manage','manual',true);

notify pgrst, 'reload schema';

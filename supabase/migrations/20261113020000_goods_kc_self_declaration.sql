-- ==========================================================================
-- ICONS · KC 자가 신고(1007-034, 2026-11-11 사용자 결정 "자가 신고로 낮춤") — ADR-0036
--
-- 공개 조건을 'KC 대상/대상 아님 선택, 대상이면 인증번호'로 낮춘다. 내부 검토 근거
-- (적용 판단 사유·적용판단 근거 참조·인증·신고문서 참조·시험성적서 참조·공급자 확인서 참조)는
-- 모든 제도에서 선택 입력이 된다. 바뀌지 않는 것:
--   * KC 대상 제도(안전인증·안전확인·공급자적합성확인·안전기준준수)의 고객 게시 항목인
--     제품군·제도·품목 분류·모델명·사업자 구분·사업자명은 필수다. 전기생활용품안전법 시행규칙
--     제20조③·제37조③·제48조③이 인터넷 판매 때 게시하라고 정한 정보(인증·신고번호, 제품명,
--     모델명, 제조업자명 또는 수입업자명)에 닿는 칸이라 낮추지 않는다.
--   * 안전인증·안전확인은 인증·신고번호가 필수이고, 그 밖의 제도·해당 없음은 번호를 넣지 않는다.
--   * 사용 중인 모든 옵션의 모델 연결, 이 상품에 없는 옵션 거절, 해당 없음의 최소 입력(제품군·제도·옵션).
--   * 검토 완료(자가 신고 완료)는 화면의 확인 체크(attested)가 있어야 한다(admin_save_goods_kc).
--   * 신규 공개·재공개의 KC 검토(goods_kc_guard → goods_kc_review_current)와 공개 중 KC 편집 잠금.
-- 같은 시그니처를 앵커 치환으로 고친다. goods_kc_review_current·goods_kc_public_disclosures·
-- admin_save_goods_kc·admin_save_good_workspace·admin_goods_readiness가 새 규칙을 그대로 따른다.
-- 규칙이 느슨해질 뿐이라 이미 검토 완료된 상품·공개 상품의 상태는 바뀌지 않는다.
-- 이 규칙은 lib/admin/goods-kc.ts goodsKcReviewProblems와 같아야 한다.
-- ==========================================================================

-- 현재 정의에서 앵커가 정확히 한 번 나올 때만 바꾼다. 다른 migration이 같은 줄을 고쳤으면 조용히 덮어쓰지 않고 실패한다.
create function private.goods_kc_self_declaration_patch(p_function regprocedure, p_patches jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $helper$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_function);
  v_patch jsonb;
  v_found integer;
begin
  for v_patch in select value from pg_catalog.jsonb_array_elements(p_patches) loop
    v_found := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_patch->>0, '')))
      / pg_catalog.length(v_patch->>0);
    if v_found <> 1 then
      raise exception 'goods_kc_self_declaration_anchor_changed: % (% matches)', p_function, v_found;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_patch->>0, v_patch->>1);
  end loop;
  execute v_definition;
end;
$helper$;
revoke all on function private.goods_kc_self_declaration_patch(regprocedure, jsonb)
  from public, anon, authenticated, service_role;

select private.goods_kc_self_declaration_patch('private.goods_kc_review_problems(text,jsonb)'::regprocedure, jsonb_build_array(
  -- 1. 적용 판단 사유·적용판단 근거 참조: KC 대상 제도에서도 선택 입력이다.
  jsonb_build_array(
    $anchor$    if subject and (row->>'basis'='' or row#>>'{evidence,applicability}'='') then
      errors:=array_append(errors,'적용 판단 사유와 근거 참조가 필요합니다.');
    end if;
$anchor$,
    $patched$    -- 1007-034(ADR-0036): 적용 판단 사유와 근거 참조는 선택 입력이다.
$patched$),
  -- 2. 안전인증·안전확인: 인증·신고번호는 그대로 필수, 인증·신고문서 참조는 선택이다.
  jsonb_build_array(
    $anchor$      if row->>'identifier'='' or row#>>'{evidence,certificate}'='' then
        errors:=array_append(errors,'인증·신고번호와 해당 문서 근거가 필요합니다.');
      end if;$anchor$,
    $patched$      if row->>'identifier'='' then
        errors:=array_append(errors,'인증·신고번호가 필요합니다.');
      end if;$patched$),
  -- 3. 공급자적합성확인: 시험성적서·공급자 확인서 참조는 선택이다.
  jsonb_build_array(
    $anchor$    if scheme='supplier_conformity' and (row#>>'{evidence,testReport}'='' or row#>>'{evidence,declaration}'='') then
      errors:=array_append(errors,'시험성적서와 공급자 확인서 근거가 필요합니다.');
    end if;
$anchor$,
    $patched$    -- 공급자적합성확인의 시험성적서·공급자 확인서 참조는 선택 입력이다(1007-034).
$patched$)));

revoke all on function private.goods_kc_review_problems(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.goods_kc_review_problems(text,jsonb) to postgres;

drop function private.goods_kc_self_declaration_patch(regprocedure, jsonb);

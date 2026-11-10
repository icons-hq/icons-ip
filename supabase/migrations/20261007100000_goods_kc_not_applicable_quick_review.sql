-- 2026-10-07 MD 피드백 ①: "상품 전체 KC 해당 없음"을 확인 체크 하나로 끝낸다.
-- 해당 없음(not_applicable) 모델의 검토 완료 필수 항목은 제품군·제도·적용 옵션뿐이다.
-- 품목 분류·모델명·사업자 구분·사업자명·적용 판단 사유·근거 참조·고객 안내는 선택 입력이다.
-- 그대로 유지하는 것:
--   * KC 대상 제도(안전인증·안전확인·공급자적합성확인·안전기준준수)의 기존 필수 항목
--   * 해당 없음에 인증·신고번호를 넣으면 거절
--   * 이 상품에 없는 옵션 거절, 사용 중인 모든 옵션의 모델 연결
--   * 공개 전 KC 검토(goods_kc_guard → goods_kc_review_current)와 공개 중 KC 편집 잠금
-- 검토자·시각은 기존 admin_save_goods_kc가 goods_kc_reviews(reviewed_by/at),
-- goods_kc_review_events(actor_id/changed_at, reason='review_completed'), audit_log에 남긴다.
-- 같은 시그니처를 재정의하므로 goods_kc_review_current, goods_kc_public_disclosures,
-- admin_save_goods_kc, admin_goods_readiness가 새 규칙을 그대로 따른다.
-- 이 규칙은 lib/admin/goods-kc.ts goodsKcReviewProblems와 같아야 한다.
--
-- 함께 고치는 식별자 해석 결함(20260910091552): jsonb_array_elements_text(...) id의 결과 열 이름은
-- id가 아니라 value다. 그래서 `variant.id=id::uuid`의 id가 goods_variants.id로 해석되어
--   * 검토 문제 함수가 이 상품에 없는 옵션 연결을 잡지 못했고,
--   * goods_kc_review_current가 연결된 옵션이 아니라 상품의 모든 옵션(사용 중지 포함)의 검토를 요구했다.
-- 사용 중지 옵션을 연결하지 않은 해당 없음 검토가 완료돼도 공개가 막히던 원인이다. 연결 목록에
-- 열 이름을 붙여 원래 의도(연결한 옵션은 이 상품에 실재하고 검토 당시와 같아야 한다)대로 비교한다.
-- 사용 중지 옵션의 재사용은 기존 goods_variants_kc_guard가 계속 막는다.
create or replace function private.goods_kc_review_problems(p_good_id text,p_models jsonb) returns text[]
language plpgsql stable security definer set search_path='' as $$
declare row jsonb; errors text[]:='{}'; scheme text; subject boolean; covered uuid[];
begin
  if jsonb_array_length(p_models)=0 then return array['KC 모델 검토가 필요합니다.']; end if;
  for row in select elem from jsonb_array_elements(p_models) elem loop
    scheme:=row->>'scheme';
    subject:=scheme is distinct from 'not_applicable';
    if row->>'family'='' or scheme='' or (subject and (row->>'productCategory'='' or row->>'modelName'=''
      or row->>'businessRole'='' or row->>'businessName'='')) then
      errors:=array_append(errors,'제품군·제도·품목·모델·사업자를 입력해주세요.');
    end if;
    if subject and (row->>'basis'='' or row#>>'{evidence,applicability}'='') then
      errors:=array_append(errors,'적용 판단 사유와 근거 참조가 필요합니다.');
    end if;
    if jsonb_array_length(row->'variantIds')=0 then errors:=array_append(errors,'모델에 적용 옵션을 연결해주세요.'); end if;
    if exists(select 1 from jsonb_array_elements_text(row->'variantIds') linked(variant_id) where not exists(
      select 1 from public.goods_variants variant where variant.good_id=p_good_id and variant.id=linked.variant_id::uuid)) then
      errors:=array_append(errors,'이 상품에 없는 옵션이 포함되어 있습니다.');
    end if;
    if scheme in ('safety_certification','safety_confirmation') then
      if row->>'identifier'='' or row#>>'{evidence,certificate}'='' then
        errors:=array_append(errors,'인증·신고번호와 해당 문서 근거가 필요합니다.');
      end if;
    elsif row->>'identifier'<>'' then
      errors:=array_append(errors,'선택한 제도에는 인증·신고번호를 입력하지 않습니다.');
    end if;
    if scheme='supplier_conformity' and (row#>>'{evidence,testReport}'='' or row#>>'{evidence,declaration}'='') then
      errors:=array_append(errors,'시험성적서와 공급자 확인서 근거가 필요합니다.');
    end if;
  end loop;
  select coalesce(array_agg(distinct linked.variant_id::uuid),'{}') into covered from jsonb_array_elements(p_models) model
    cross join lateral jsonb_array_elements_text(model->'variantIds') linked(variant_id);
  if exists(select 1 from public.goods_variants variant where variant.good_id=p_good_id and variant.archived_at is null
    and not(variant.id=any(covered))) then errors:=array_append(errors,'모든 사용 중인 옵션의 모델 검토가 필요합니다.'); end if;
  return errors;
end $$;
revoke all on function private.goods_kc_review_problems(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_review_problems(text,jsonb) to postgres;

create or replace function private.goods_kc_review_current(p_good_id text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.goods_kc_reviews review where review.good_id=p_good_id and review.status='reviewed'
    and review.context_snapshot->'good'=private.goods_kc_context(p_good_id)->'good'
    and cardinality(private.goods_kc_review_problems(p_good_id,review.models))=0
    and not exists(select 1 from jsonb_array_elements(review.models) model
      cross join lateral jsonb_array_elements_text(model->'variantIds') linked(variant_id)
      left join public.goods_variants variant on variant.id=linked.variant_id::uuid and variant.good_id=p_good_id
      where variant.id is null or not private.goods_kc_covers_variant(p_good_id,variant.id,variant.name,variant.attributes)));
$$;
revoke all on function private.goods_kc_review_current(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_kc_review_current(text) to postgres;

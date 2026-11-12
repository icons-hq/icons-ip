-- T10 리뷰가 남긴 기존 결함(T10 범위 밖이라 트랙이 고치지 않음, 오케스트레이터 판단 — 위임 원칙 ④).
-- 리뷰이벤트 저장 검사(private.review_event_values_valid)는 이벤트명·내용의 앞뒤 공백을 btrim으로만 봐서, 직접 RPC로 앞뒤에
-- NBSP(U+00A0)·전각 공백(U+3000)·BOM(U+FEFF) 같은 유니코드 공백이 붙은 문구를 받았다. 앱(lib/review-events.ts의 text(): JS trim 기준)은
-- 그런 행을 읽지 못해 어드민 리뷰이벤트 목록 전체와 고객 리뷰이벤트 목록·상품 배너가 열리지 않았다.
-- 저장 검사를 문구 템플릿과 같은 기준(private.review_event_template_text_valid: JS trim이 자르는 공백이 앞뒤에 없어야 함)으로 맞춘다.
-- 길이·제어 문자 규칙은 그대로이고 가운데 공백은 받는다. 앱 등록 화면은 원래 JS trim으로 잘라 보내므로 화면 동작은 같다.
-- 이미 저장된 그런 행은 고치지 않는다. 표 CHECK(btrim)도 그대로 둔다 — 더 엄격한 CHECK를 걸면 그 행의 보관·발표 같은 갱신까지 막힌다.
-- 대신 앱 읽기가 앞뒤 유니코드 공백을 견딘다(같은 커밋의 lib/review-events.ts).
-- 본문은 앵커 치환(정확히 한 번)으로 고치고 운영자 내부 계약 지문을 다시 적는다.
begin;

do $patch$
declare
  target constant regprocedure := 'private.review_event_values_valid(jsonb)'::regprocedure;
  anchor constant text := $a$or p_values->>'title'<>btrim(p_values->>'title') or p_values->>'description'<>btrim(p_values->>'description')$a$;
  body text := pg_get_functiondef(target);
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'review_event_values_trim_anchor_changed';
  end if;
  execute replace(body, anchor,
    $a$or private.review_event_template_text_valid(p_values->>'title',15) is distinct from true or private.review_event_template_text_valid(p_values->>'description',30) is distinct from true$a$);
end $patch$;

select private.register_operator_internal_contract('private.review_event_values_valid(jsonb)'::regprocedure);

commit;

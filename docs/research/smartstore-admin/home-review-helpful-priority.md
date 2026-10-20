# 홈 대표 후기의 도움수 우선순위

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-15. 홈 대표 후기의 기존 평점 우선순위 다음에 도움수를 반영했다. 정식 migration과 실제 로컬 DB 3개 적용·복제 DB 검증을 완료했으며, 변경 후 홈의 실제 PC/390px·도움 표시/철회·대표 후기 변경도 공유 브라우저 검수 (`output/home-other-browser-qa-20261015/browser-observations.json`)에서 확인했다. 관측된 외부 Auth 변화와 문구 보완은 해당 결과의 한계를 유지한다. 운영·Preview는 변경하지 않았다.

[기존 BEST 우선 계약](home-review-best-priority-implementation-qa.md)을 유지한다. 현재 유효한 BEST가 있으면 그 안에서, 없으면 일반 공개 리뷰 안에서 **평점 내림차순 → 도움수 내림차순 → 작성일 내림차순 → 리뷰 ID 오름차순**으로 한 개를 고른다. 유효한 1점 BEST는 일반 5점 리뷰보다 우선한다. 상품 선정·자동 최대6개·직접 최대20개·최종4개 미만 숨김, 평균 평점·리뷰 수·최근 작성일은 바뀌지 않는다.

[migration](../../../supabase/migrations/20261020085416_home_review_helpful_priority.sql)은 공개 가능한 리뷰의 도움수만 반환하는 `get_public_review_helpful_count`를 추가하고 기존 홈 reader 두 개의 정렬식만 바꾼다. 숨김·없는 리뷰, 비공개·보관·판매 제한 상품과 비공개·보관 IP에는 0을 반환한다. 투표자 정보는 반환하지 않으며 private 원장·기존 helper의 ACL을 넓히지 않는다. 기존 일반 reader의 SECURITY INVOKER와 BEST reader의 owner·ACL을 보존한다. 새 함수는 네 역할을 revoke한 후 anon·authenticated에 필요한 execute만 부여한다.

- DRAFT 검증 (`output/home-review-helpful-design-20261015/final-summary.json`): 혼합 소유자 canonical 복제본에서 기존 회귀113개를 전후 통과하고 신규25개, 실제 SQL의22상품 JSON을 production 파서·선정 함수에 연결한5개 검증을 통과했다. 총1,022후기·22상품의 단회 로컬 조회는25.825ms였으며 운영 성능 보장은 아니다.
- 정식 파일·정확한 적용 transaction 검증 (`output/home-review-helpful-named-qa-20261015/runner-clones-98fbd409190d491baaf963340523ae60/result.json`): 실제 OWN·canonical을 각각 복제해 기존113개 전후·신규25개·DTO5개와 익명/authenticated 실행을 통과했다. 각11개 의도적 변조와 잘못된 실행 역할을 거절·롤백했고 원본 전체를 보존한 뒤 복제 DB·임시 파일을 제거했다.
- 로컬 적용 계획 (`output/home-review-helpful-named-qa-20261015/plan-ff8cebb825994b549abd6e379d1daf88/plan.json`)에 결속된 OWN278개 (`output/home-review-helpful-named-qa-20261015/plan-ff8cebb825994b549abd6e379d1daf88/own-apply-result.json`), FRESH311개 (`output/home-review-helpful-named-qa-20261015/plan-ff8cebb825994b549abd6e379d1daf88/fresh-apply-result.json`), canonical346개 (`output/home-review-helpful-named-qa-20261015/plan-ff8cebb825994b549abd6e379d1daf88/canonical-apply-result.json`) 적용이 통과했다. 기존 사업/Auth/Storage 행·전체 ledger·대상 외 함수와 owner/ACL/RLS·registry를 보존했다. 이는 적용 직후 증거이며 이후 검증 데이터 변경과 구분한다.

첫 exact clone 시도는 psql의 verbose NOTICE 형식을 검증기가 세지 못해 중단됐다. SQL113개 자체는 통과했고 원본 보존·복제본 정리도 완료했다. NOTICE 집계만 수정한 재실행 결과가 위 최종 증거다. 로컬 혼합 소유자 적용은 `supabase_admin`으로 실행했으며 원격 DB의 실제 소유권·배포 역할은 미확인이다. 이후 실제 홈 검수 (`output/home-other-browser-qa-20261015/browser-observations.json`)와 [구현분의 통합 검수](README.md#최종-검수-상태)를 완료했다. 브라우저 실행 소스, 후속 문구 보완, 추가 UI 변경의 검증 시점과 한계는 통합 기록에서 구분한다.

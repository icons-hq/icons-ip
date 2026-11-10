# 리뷰 도움 표시와 도움순

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-15. 공개 상품 리뷰의 도움 표시·철회와 도움순, 관리자 목록·상세의 리뷰도움수를 구현했다. 최초 실제 화면 검증에서 혼합 소유자 DB의 관리자 조회 오류를 발견해 별도 소유권 보정 migration을 추가했다. 보정의 격리 복제 DB 검증과 로컬 3개 DB 적용, 새 검증 데이터로 PC·390px 실제 화면 재검증을 완료했다. 운영·Preview 배포는 실행하지 않았다.

## 적용한 계약

- 도움 표시는 로그인과 기본 정보·필수 동의가 완료된 활성 회원이 다른 사람의 공개 리뷰에 남긴다. 해당 상품 구매 여부는 도움 표시 자격에 포함하지 않는다. 본인 리뷰와 참여 제한 계정에는 수만 표시하고, 비로그인 사용자는 현재 정렬·사진 조건·페이지·리뷰 앵커를 보존한 로그인 링크를 사용한다.
- 표의 식별자는 원본 리뷰 ID와 회원 ID다. 같은 상품그룹의 두 상세 페이지에서 같은 리뷰를 읽어도 한 표로 집계한다. 투표자 ID와 목록은 공개하지 않는다.
- 서버에 원하는 표시 상태를 보내고 DB의 고유 키·계정 잠금으로 확정한다. 같은 `true` 요청을 재전송해도 표가 추가되지 않는다. 리뷰 숨김·삭제·수정, 그룹 변경, 계정 탈퇴와 경합할 때 기존 무결성 경계를 따른다.
- 화면은 서버 확정 후 새 조회를 반영한다. 응답을 받지 못하면 결과 미확인 상태를 표시하고 반대 동작을 잠근다. `최신 상태 확인`은 읽기를 갱신하며, `같은 요청으로 다시 확인`은 처음 요청한 표시 상태를 유지한다.
- 공개 목록의 도움순은 도움수 내림차순, 동률은 기존 작성시각·리뷰 ID 순서다. 사진 필터·페이지·평점 집계·원 구매 상품 문맥을 유지한다. 관리자에는 `리뷰도움수` 열·상세 값과 도움순을 추가하고 기존 검색·BEST·답글·숨김·평점 조건을 유지한다.

홈의 대표 후기 선정에 도움수를 사용하는 변경과 일반 리뷰 엑셀은 별도 후속 단위다. 리뷰이벤트 지급·BEST 선정·원본 네이버 리뷰랭킹을 도움 표시와 합치지 않는다.

## 데이터와 소유권

[도움 표시 migration](../../../supabase/migrations/20261020085414_review_helpful_votes.sql)은 비공개 표와 새 공개·관리자 조회 및 writer를 추가한다. 기존 조회 함수는 보존한다. 비공개 표의 RLS를 활성화하고 PUBLIC·anon·authenticated·service_role의 직접 접근을 봉인한다. 새 함수도 네 롤을 먼저 revoke한 뒤 필요한 실행 권한만 부여한다.

기존 관리자 BEST reader와 private BEST helper가 `supabase_admin`, 신규 도움수 reader가 `postgres`인 로컬 DB에서 신규 reader만 `review_best_state` 실행 권한 오류를 냈다. [별도 보정 migration](../../../supabase/migrations/20261020085415_review_helpful_admin_owner_boundary.sql)은 신규 관리자 reader의 소유자를 기존 reader와 맞추고 해당 내부 계약 지문만 갱신한다. 기존 helper의 owner·ACL과 비공개 표 권한은 바꾸지 않는다. 이미 소유자가 같은 canonical DB에서는 논리 변경이 없다. 먼저 적용한 migration은 수정하지 않았다.

혼합 소유자 복제본에서 `postgres`로 보정을 실행하면 권한 오류와 전체 롤백을 확인했다. 해당 로컬 보정은 `supabase_admin`으로 실행한다. 원격 DB의 실제 함수 소유자와 배포 연결 역할은 조회하지 않았으므로, 원격 배포 전 이 조건을 확인해야 한다. 로컬 적용 성공을 원격 배포 실행 권한의 증거로 사용하지 않는다.

## 검증 근거와 현재 한계

- 앱 검증 (`output/review-helpful-qa-20261015/application-validation.json`): 관련 테스트 100개, 스타일 경계 41개, 타입 검사와 대상 ESLint 통과.
- 초기 DB 검증 (`output/review-helpful-design-20261015/final-summary.json`): 집중 SQL 47개, 경합 8개, 실제 SQL 응답과 앱 파서의 연결 10개. 초기 검증이 혼합 소유자 의존 함수의 실행 경로를 놓쳤다는 한계는 후속 보정 검증과 구분한다.
- 보정 복제 DB 검증 (`output/review-helpful-owner-fix-design-20261015/clones-d39ebd560c4b48719a23feb2863b4094/result.json`): 실제 authenticated 호출로 오류를 재현하고 소유권 보정 후 기존 BEST와 신규 조회의 정렬·선정·도움수 및 권한을 대조했다. 기존 전체 행·함수·ACL·migration ledger를 보존하고 폐기용 복제본을 제거했다.
- 최초 실제 브라우저 검증 (`output/review-helpful-browser-qa-20261015/browser-evidence.json`)은 `PARTIAL_ADMIN_PERMISSION_FAILURE`다. 공개 목록의 로그인 복귀, 본인 읽기 전용, 표시·철회, 서버 확정 응답 유실과 같은 목표 재시도, 상품그룹 반영, 390px 조작을 확인했다. 관리자 오류가 있었으므로 전체 통과로 표시하지 않는다. 합성 리뷰·상품·계정은 정상 비활성화하고 전용 런타임과 자격증명을 제거했다.
- 보정 로컬 적용 (`output/review-helpful-owner-named-qa-20261015/final-summary.json`): OWN 277개·FRESH 310개·canonical 345개 ledger까지 적용했고, 기존 전체 행·함수 본문과 대상 외 owner·ACL·RLS·registry를 보존했다. 이 결과는 적용 직후 상태의 증거다.
- 상설 회귀 검증 (`output/review-helpful-permanent-qa-20261015/final-summary.json`): OWN·canonical에서 각각 새 복제 DB를 만들어 SQL 47개, 실제 authenticated 관리자 호출 15개, 실제 SQL 응답과 앱 파서 연결 10개, 경합 8개를 통과했다. 원본 전체 상태를 보존했고 복제 DB와 임시 파일을 제거했다. CI에도 같은 회귀 진입점을 연결했다.
- 최종 실제 브라우저 검증 (`output/review-helpful-owner-browser-qa-20261015/browser-evidence.json`): 새 합성 상품 3개·리뷰 14개·계정 3개로 관리자 기존 BEST/신규 조회의 실제 HTTP 200, 도움순·상세·20/50/100개·평점/숨김/사진/답글/BEST 필터, 공개 페이지 이동·로그인 복귀·본인 읽기 전용·그룹 내 동일 집계와 그룹 밖 미노출을 확인했다. 모바일에서는 서버가 표를 확정한 뒤 응답을 끊고 최신 조회와 같은 목표 재시도로 중복 표가 생기지 않는 것을 DB 원본 행까지 대조했다. 키보드 도움 표시·상세 열기·닫기와 390px 조작도 확인했다.
- 리뷰 앵커로 바로 이동하면 고정 헤더 아래 요약이 가려지는 문제를 수정했다. 최종 CSS로 PC·390px 요약 노출을 직접 확인하고 스타일 경계 41개를 통과했다. 이 CSS 수정 이후 전체 작업본 build는 병렬 후속 기능이 끝난 시점에 실행한다.

최종 검증 중 다른 기존 로컬 런타임(`icons-primary-qa.localhost:4320`)의 토큰 갱신이 발생해 최초 엄격 Auth 보존 검사 2회는 실패했다. 독립 조사 (`output/review-helpful-owner-browser-qa-20261015/auth-refresh-investigation.json`)로 기존 Auth 3행의 정확한 변경과 새 refresh token 1행을 확인하고, 별도 예외 검토 (`output/review-helpful-owner-browser-qa-20261015/reviewed-auth-refresh-exception.md`)에만 기록했다. 원래 실패·기준 snapshot은 보존했으며 DB 값은 되돌리지 않았다. 그 밖의 기존 Auth와 사업·금전·재고·설정·ledger 행은 동일했고, 추가 외부 변경은 허용하지 않았다. 따라서 최종 결과를 “기존 Auth 전체 무변경”으로 해석하지 않는다.

합성 리뷰는 숨김, 상품·IP는 비공개, 계정은 비활성화했다. 검증 표 3개와 참조용 취소 주문 14개는 보존하고 신규 결제·환불·배송·주문상품·실물 재고 변경은 0이다. 전용 런타임·자격증명·임시 디렉터리와 포트 4351을 정리했다. 사진이 있는 리뷰의 실제 로그인 복귀는 이번 브라우저 데이터에 없어 앱 테스트 근거만 있으며, 모든 모달 포커스 순환을 검증했다는 주장은 하지 않는다.

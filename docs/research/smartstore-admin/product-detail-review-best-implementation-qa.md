# 선정 BEST 리뷰: 원본 대조와 구현 검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13 기준, 격리 로컬 앱과 DB에서 완료했다. 운영 DB·배포·네이버 적용은 실행하지 않았다.

## 원본과 구현 범위

현재 로그인된 [상품상세 전시 설정](https://sell.smartstore.naver.com/d/v2/display-config/product-detail)의 대표 이미지에서 베스트리뷰 노출 설정을 확인했다. 도움말은 선정 리뷰 중 무작위 3개, 노출 가능한 리뷰 3개 미만이면 숨김을 설명한다. 실제 샘플 미리보기는 이미지 갤러리의 마지막 슬라이드에 세 리뷰를 세로로 표시한다. 상단 리뷰 요약과는 별개다. 원본 설정을 적용하지 않았다.

원본 캡처와 도움말은 `output/smartstore-reference-20261012/verification-review-best/source-best-review-settings.png`, `source-best-review-help.txt`에 있다. 원본의 후기 혜택 지급·최종 적용 결과까지 확인한 것으로 보지 않는다.

ICONS는 `/admin/cs/reviews`의 리뷰 상세에서 별점과 무관하게 선정·해제하고 사유를 기록한다. 목록에서 선정됨·미선정·재확인 필요를 검색 조건과 함께 조회하며, 필터는 전체 건수·페이지 제한보다 먼저 적용한다. `/admin/display/detail/reviews`에서 표시를 켜면 상품별 유효한 선정 리뷰 3개 이상 중 무작위 3개를 갤러리의 마지막 BEST 슬라이드에 표시한다. 원래 이미지·영상 우선순위와 갤러리 탐색, 일반 리뷰 탭을 유지한다.

선정은 혜택 지급이 아니다. 기존 리뷰이벤트로 적립금 혜택을 받은 리뷰는 해당 고지를 BEST 카드에서도 유지한다. 사진 서명 실패 시 사진만 생략하고 원문과 혜택 고지는 유지한다. 평점 평균과 전체 리뷰 수는 선정 여부와 무관하게 기존 공개 리뷰 전체로 계산한다. 홈 상품형 베스트리뷰는 이후 별도 [선정 BEST 대표 후기 우선](home-review-best-priority-implementation-qa.md) 단위에서 연결했다. 홈은 상품 선정·평균·개수를 유지하며 이 이미지 영역의 토글·최소 3개·무작위 규칙을 적용하지 않는다.

## 저장과 공개 계약

- `private.review_best_selections`와 `private.review_best_settings`는 RLS를 켜고 public·anon·authenticated·service_role 직접 접근을 봉인했다. 선정은 현재 `cs.manage`, 표시 설정은 현재 `store.manage`를 RPC에서 재검사한다.
- 선정은 예상 revision, 현재 원문 fingerprint, 사유, actor와 operation UUID를 결속한다. 같은 요청은 최초 결과를 반환하며 다른 요청 내용의 UUID 재사용과 오래된 버전을 거절한다. 브라우저는 결과 불명일 때 최초 요청을 고정해 재확인한다.
- 목록 원문과 선정 기준은 하나의 STABLE RPC snapshot에서 읽는다. 서버 액션은 응답의 대상 리뷰·선정 여부·revision·fingerprint·사유를 다시 확인한다. 공개 응답은 원문·평점·공개 닉네임·날짜·사진 경로만 반환하며 주문·회원·운영자 ID, 선정 사유는 반환하지 않는다.
- 현재 공개 리뷰, 유효한 실제 결제 근거와 배송완료/구매확정 주문, 정상 작성자 계정, 공개·미보관·판매 제한 없는 상품/IP만 선정·노출한다. 평점 제한은 없다.
- 원문·평점·사진·공개 상태가 바뀌면 기존 선정을 재확인 필요로 만든다. 원문을 되돌리거나 블라인드를 해제해도 자동 재선정하지 않는다. 일반 운영자 답글은 선정 원문 변경으로 보지 않는다.
- 주문 취소, 결제 환불, 취소·반품 완료도 선정을 무효화한다. 구매 상태를 복구해도 명시적으로 다시 선정해야 한다. 현재 부적격이거나 무효화된 리뷰는 다음 공개 조회에서 제외하며 남은 유효 리뷰가 3개 미만이면 슬라이드 전체를 숨긴다.
- 최초 선정에 아직 행이 없더라도 환불과 직렬화되도록 선정은 actor → operation UUID → 주문별 advisory → 리뷰 → 선정 행 순서로 잠근다. 구매 무효화 trigger도 같은 주문 advisory를 선정 조회 전에 획득한다. 선정 함수는 주문/결제 행 잠금을 추가하지 않는다. 리뷰 변경 trigger는 리뷰 → 선정 행 순서를 유지하며 주문 advisory를 역순으로 잡지 않는다.

## 검증

- `20261020085308_review_best_selection.sql`을 CLI로 생성하고 OWN 격리 DB에 적용했다. 전체 SQL과 migration ledger의 version/name/단일 statements 값이 일치한다. 당시 권한 계약 검사는 378 RPC·90 RLS·546 내부 함수로 통과했다.
- 독립 FRESH DB에서도 migration ledger·11개 함수 SHA와 SQL 회귀·권한 검사가 일치했다. 이어 완전히 빈 세 번째 DB에서 당시 283개 migration 전체를 재적용하고 FRESH와 1,024개 함수 정의 SHA가 모두 같은 것을 확인한 후 임시 DB를 정리했다. 근거는 `verification-review-best/cat-fresh-migration-verification.json`과 `output/goods-sale-period-qa-20261013/fresh-followup/clean-migrations/result.json`이다.
- `review_best.sql`은 권한·최소 3개·무작위 최대 3개·1점 리뷰·멱등·revision·미확정 결제 제외·원문 변경/복원·블라인드/해제·환불/복원·삭제·상품/IP 비공개·혜택 미지급을 검증하고 롤백한다.
- `review_best_concurrency.sh/.py`는 명시한 로컬 DB를 폐기 복제본으로 만든다. 같은 요청/다른 요청 CAS, 원문 변경 양방향, 선정 후 숨김, 환불 양방향, 반품 선행, 권한 회수와 최초 INSERT 직전 환불의 10개 실제 잠금 경합을 통과했다. 독립 검토에서 발견한 최초 선정 무효화 누락은 공통 주문 advisory로 수정했고 독립 FRESH 복제본 재검증도 통과했다.
- 관련 Vitest 9개 파일 111개 테스트, 전체 TypeScript 검사, 대상 ESLint를 통과했다. 갤러리 사진 실패와 혜택 고지, 요청/응답 결속, 0/3개 공개 계약도 검증한다.
- 실제 Chrome에서 표시 설정 저장 → 1점·2점 리뷰 선정 → 2개일 때 숨김 → 세 번째 선정 후 BEST 슬라이드 3개 → 리뷰 전체 연결을 확인했다. 전체 평점 3.4·리뷰 5건은 유지됐다.
- 두 탭에서 같은 선정 해제를 준비한 뒤 첫 저장만 반영되고 두 번째는 버전 충돌로 거절되며 사유 입력이 보존됐다. 390px에서 재선정하고, 합성 원문을 바꿔 재확인 필요·공개 제외 → 수정 원문 재선정·공개 복구를 확인했다. 결제 근거가 없는 리뷰는 사유를 입력해도 선정 버튼이 비활성이다.
- 최종 모바일 갤러리는 세 카드·작성일·리뷰 모두 보기·도트가 내부 스크롤 없이 표시된다. 공개 문서 폭/스크롤 폭은 390/390px, 슬라이드 높이/스크롤 높이는 358/358px다. 관리자 모달의 본문 폭/스크롤 폭은 368/368px다.

## 증거와 원복

검증 폴더는 `output/smartstore-reference-20261012/verification-review-best/`다. `screenshots.json`의 15장 중 12장을 채택하고 모든 파일의 SHA-256·치수를 대조했다. `02`, `04`, `05`는 화면 갱신/이동 중 또는 모바일 높이 보완 전이므로 제외하고 `02b`, `04b`, `05b`로 대체했다.

대표 화면은 1점 리뷰 선정 (`output/smartstore-reference-20261012/verification-review-best/02b-one-star-selected-dialog.png`), 데스크톱 갤러리 (`output/smartstore-reference-20261012/verification-review-best/04b-three-reviews-gallery-desktop.png`), 390px 갤러리 (`output/smartstore-reference-20261012/verification-review-best/05b-three-reviews-gallery-390.png`), 두 탭 충돌 (`output/smartstore-reference-20261012/verification-review-best/06-two-tab-conflict.png`), 원문 변경 재확인 (`output/smartstore-reference-20261012/verification-review-best/08-changed-needs-review-390.png`)이다. 콘솔 오류는 번역 확장프로그램의 `data-immersive-translate-page-theme` 속성 추가에 따른 hydration 경고로 확인했다.

검수 후 표시 설정을 실제 UI에서 원래 값 false로 저장해 revision 2가 됐다. 합성 리뷰 5개·선정 3개·상품/IP·주문 5개·결제/시도 5개·회원 8명과 KC 검증 회원을 정리하고 모두 0을 재조회했다. 선정/설정 감사 이력은 보존했다. 최종 상태는 `final-database-readback.json`, `final-browser-readback.json`, `public-readbacks.json`에 있다. 브라우저 임시 크기와 생성한 CS/충돌 탭을 정리했다.

동일 제품군의 다른 구성과 도움수는 남은 범위다. 홈 대표 후기 선정 우선순위의 완료 근거는 별도 [홈 검증 기록](home-review-best-priority-implementation-qa.md)을 따른다.

# 리뷰 상품명·첨부사진수 정렬

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13 원본 조회와 격리 로컬 앱·DB에서 검증했고, 2026-10-14 모바일 넘침 수정을 확인했다. 공개 굿즈 리뷰 탭의 정렬과 운영 DB는 변경하지 않았다.

## 원본과 적용 범위

원본 정렬 메뉴 (`output/smartstore-reference-20261012/catalog-cs/29-review-sort-options.jpg`)에 상품명순과 첨부 사진 개수 순이 있다. 로그인된 원본의 현재 목록에서 `PRODUCT_NAME`과 `PHOTO_COUNT` 선택값을 확인했다. 상품명순의 앞·뒤 공개 상품명은 오름차순이었고, 사진수순의 첫 후기 미리보기는 사진 5장, 마지막 행들은 미첨부였다. 조회 근거 (`output/review-sort-qa-20261013/source-observations.json`)에 제한된 공개 상품명·첨부 유무를 기록했다. 고객 원문과 식별자는 fixture에 옮기지 않았다. 원본 정렬은 초기값으로 되돌렸고 답변·선정·다운로드·저장을 실행하지 않았다.

ICONS 리뷰 관리에는 `상품명순`(`good_name_asc`)과 `첨부사진수순`(`photo_count_desc`)을 추가했다. 상품명은 DB 문자열 오름차순, 사진은 첨부 경로 수 내림차순이다. NULL과 빈 배열은 0장으로 취급한다. 동률은 기존 `created_at DESC, id DESC` 순서를 유지한다. 원본의 모든 문자권 정렬 규칙과 동률 처리를 동일하게 재현했다는 뜻은 아니다.

기존 `admin_search_reviews`와 BEST 필터를 포함한 `admin_search_reviews_best`를 함께 갱신했다. 현재 `cs.manage` 권한, 검색·기간·상태·사진·답글·저평점·BEST 필터, 전체 건수와 LIMIT/OFFSET, 선정 상태의 동일 snapshot을 보존한다. 화면에서 정렬을 바꾸면 첫 페이지로 돌아가며, 페이지와 상세 이전/다음 이동에는 검색 조건과 정렬이 유지된다.

이 정렬 보완 당시 일반 리뷰 목록의 엑셀 내보내기와 도움순은 없었다. 2026-10-15 [도움 표시·도움순 후속](review-helpful-parity.md)을 구현했으며 현재 검증 상태는 해당 문서를 따른다. 일반 리뷰 엑셀은 별도 후속이다. 리뷰이벤트 엑셀의 정렬·열·권한, 네이버 리뷰랭킹·동영상수 정렬은 이 변경의 대상이 아니다.

## 검증

- 독립 DRAFT 검토 후 CLI로 [새 migration](../../../supabase/migrations/20261020085310_admin_review_sorting.sql)을 생성했다. OWN/FRESH의 exact statements ledger와 파일 SHA-256 `b5fa4cf4617d2b2f84c82a8724943c1438fe6c309cc8f7ebaef913cce8ccdc20`이 일치하고 두 함수 본문 해시도 동일하다. 적용 전후 변경된 함수는 이 두 개뿐이었다. 적용·회귀 근거 (`output/review-sort-qa-20261013/migration-verification.json`).
- [격리 SQL](../../../supabase/tests/admin_review_sorting.sql)은 합성 26행의 상품명·사진3/1/0/NULL, 작성시각·ID 동률, 20+6 페이지, BEST 필터·복합 조건·전체 건수, 기존 네 정렬과 새 두 정렬의 두 RPC 일치, 잘못된 입력·고객/물류 권한·ACL을 검증했다. NULL은 테스트 트랜잭션에서만 과거 nullable 자료를 모의하고 롤백하며 실제 NOT NULL 제약을 유지한다.
- OWN/FRESH에서 정렬 SQL, 기존 BEST SQL과 전체 권한 계약 검사를 통과했다. UI 검수로 설정 revision이 증가한 OWN의 BEST 회귀는 테스트 트랜잭션 안에서만 초기 설정을 만들고 롤백한 뒤 원래 행과 동일함을 확인했다.
- 관련 6파일 54개 Vitest, 전체 TypeScript, 대상 ESLint를 통과했다. 필터 URL 왕복, 서버 순서 보존, NULL 사진0, 다른 리뷰의 BEST snapshot 거부, 실제 선택 표시와 페이지 링크를 포함한다.
- 실제 Chrome에서 상품명순 26행, 사진3→1→0장 순, 20번째→다음 페이지의 21번째→이전 20번째, BEST 재확인 조건13행과 정렬 전환을 확인했다. 390px에서도 두 정렬을 선택하고 조건 보존을 확인했다. DOM 재조회 (`output/review-sort-qa-20261013/browser-readbacks.json`), 데스크톱 결과 (`output/review-sort-qa-20261013/04-photo-best-table.png`), 390px 결과 (`output/review-sort-qa-20261013/05-name-sort-390.png`).
- 기존 모바일 가로 넘침은 별점의 절대 위치 `sr-only` 문구가 표 밖의 containing block을 사용한 것이 원인이었다. 별점 span에만 `position: relative`를 추가해 390px viewport에서 문서 폭/스크롤 폭을 380/380px로 맞췄다(세로 스크롤바 10px). 표 자체 274/1126px 가로 스크롤, 키보드 오른쪽 40px 이동, 열 설정·리뷰 상세 닫기 포커스 복원을 확인했다. 상세 모달은 368/368px다. 새 overflow 숨김은 추가하지 않았다. 수정 수치 (`output/review-sort-qa-20261013/mobile-fixed-readback.json`), 선택기 (`output/review-sort-qa-20261013/08-mobile-controls-fixed.png`), 상세 모달 (`output/review-sort-qa-20261013/06-mobile-modal-fixed.png`). 수정 후 화면 SSR·스타일 경계 3파일 54개 검증을 통과했다. 브라우저 오류는 번역 확장이 추가한 `data-immersive-translate-page-theme`의 기존 hydration 경고였다.

합성 상품3·리뷰26·선정13·주문26·회원3·해당 운영 알림을 정리하고 0건을 재조회했다. 기존 BEST 설정은 false/revision2를 유지했고 사진 NOT NULL 제약도 그대로다. 정리 결과 (`output/review-sort-qa-20261013/final-database-readback.json`). 임시 viewport와 생성한 탭을 정리했다.

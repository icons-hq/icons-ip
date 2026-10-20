# 상품상세 표시 설정 구현·검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13 격리 로컬 Supabase와 실제 Next 화면에서 배너·리뷰 요약·자동 추천 저장, 공개 상세 반영, 동시 수정, 390px와 원복을 확인했다. 네이버 원본 적용과 운영 배포는 하지 않았다. [원본 대조와 정책 차이](product-detail-presentation-parity.md)를 함께 따른다.

## 구현 범위

`/admin/display/detail`에 상단 띠배너와 리뷰·자동 추천을 별도 저장한다. 기존 공통·상품목록 설정과도 독립적이다. 첫 설치의 모든 추가 노출은 꺼져 있다.

- 배너: 라이트/다크, 제목10자·설명20자, 한국 날짜의 시작00:00 포함·종료 다음날00:00 제외, 전체/개별 상품200개/카테고리10개. 활성 공개 분류의 대표·추가 분류와 하위 상품을 포함한다. 상품/IP 공개 상태와 분류 조상을 읽을 때마다 다시 검사한다.
- 리뷰 요약: 현재 공개 구매 리뷰 전체의4·5점 비율, 사진 있음→평점→최신순→ID 기준의4점 이상 카드 최대10개. 탭의 현재 페이지를 전체 분모로 사용하지 않는다. 리뷰 이미지 서명은 기존 서버 정책을 사용한다.
- 자동 유사상품: 같은 공개 최하위 분류 우선, 같은 IP 차순위, 최소5개·최대30개. 수동 유사상품 편성이 있으면 자동 영역을 숨긴다.
- 자동 함께구매: 한국 시각 직전30일(오늘 제외)의 서버 확정 결제·사용자/금액 일치·실제 같은 주문을 기준으로 최소5개·최대30개. 완료 취소/반품을 제외하고, 수동 함께 구매 편성이 우선한다.
- 카테고리/스토어 인기: 직전30일 확정 판매수량→현재 찜 수→최신순·ID, 양수 근거가 있는 후보만 최대12개. 카테고리는 활성 최하위 대표분류 깊이2이상에서만 표시한다.

원본 비공개 추천 엔진과 순위 정확도가 같다고 주장하지 않는다. 공개 후보는 기존 카탈로그의 가격·옵션·품절·판매제한·결제수단 표시를 재사용한다. 수동 이미지 태그/코디 소비자는 유지한다. 필수 상세정보·KC·문의·리뷰/배송 탭과 상단 평균/건수는 항상 유지한다. 다음 배너 경계·자정·옵션 가격/판매 경계에서 공개 화면을 갱신한다.

## 저장과 공개 경계

`private.product_detail_settings`의 두 행을 독립 revision으로 관리한다. `store.manage`의 현재 권한을 확인한 뒤 actor→operation UUID→설정 행→정렬된 대상 참조 순서로 잠근다. 직접 테이블 접근과 내부 helper 실행은 봉인한다. 같은 UUID/같은 요청은 결과와 감사1회, 다른 요청의 UUID 재사용과 오래된 revision은 충돌로 거절한다. 응답이 불명확하거나 전송이 실패하면 입력·revision·UUID를 고정해 같은 요청으로 다시 확인한다.

개별 상품과 카테고리는 별도 FK 테이블에 저장한다. 미공개 상품 URL 변경은 FK cascade를 따르고 삭제는 대상을 제거한다. 공개 RPC는 현재 상품의 실제 배너·리뷰·후보ID만 반환하며 선택된 비공개 대상 목록·운영자·감사 정보는 반환하지 않는다. 후보 재조회 실패는 배너/리뷰를 유지하고 추천 실패 상태를 따로 표시한다.

`20261020085243_product_detail_presentation.sql`과 후속 `20261020085246_product_detail_banner_target_scope.sql`을 OWN/FRESH 격리 DB에 적용했다. 실제 PostgREST 저장에서 `safeupdate`가 조건 없는 대상 목록 교체를 거절하는 문제를 찾았다. 기적용 migration을 보존하고 대상 테이블에 `section='banner'` FK/제약을 추가해 명시적인 범위 조건으로 교체하도록 고쳤다. 동일 operation을 재시도해 저장 성공·revision1·감사1개를 확인했다.

## 검증

관련 단위/서버/액션/렌더/카탈로그·가이드·CSS 경계9파일107테스트를 통과했다. 마지막 리뷰 이동 수정 후 영향3파일45테스트(기존 테스트 포함)를 다시 통과했고, 전체 TypeScript와 관련 ESLint를 통과했다. 전송 거절 시 요청을 고정하는 회귀 검증은 상세·공통 전시·상품 색상 세 폼을 포함한다. 전체 저장소 빌드와 전체 테스트는 상위 통합 검증에서 수행한다.

기능 SQL은 권한6종과 일반 사용자, 직접 접근 차단, 잘못된 타입/추가키/날짜/상한, 동일 요청·CAS, FK 변경/삭제, 분류 하위·활성 게이트, 배너 기간, 공개 리뷰15건 중 긍정12건·상단10건·숨김 제외, 실제 결제 증거/계좌이체/사용자·금액 불일치/취소·반품·30일 경계, 품절 유지·성인 제한·최소5개를 검증한다. 마지막 SQL은 PostgREST와 같은 `LOAD 'safeupdate'` 조건으로 OWN/FRESH에서 통과했으며 fixtures는 롤백한다.

복제 DB의 경합7개는 실제 대기 잠금을 관측하고 통과했다: 동일 영역 CAS, 정확한 요청 재시도, 다른 영역 독립 저장, 저장 후 상품ID 변경, 상품ID 변경 뒤 이전ID 저장 거절, UUID 요청 충돌, 권한회수 뒤 저장 거절. 최종 revision3/3·감사6개·변경된 FK를 확인했다. 실행기는 복제를 생성하고 종료 시 해당 복제만 제거한다.

```sh
cat supabase/tests/helpers/goods_kc_fixture.sql supabase/tests/product_detail_presentation.sql | docker exec -i supabase_db_<격리DB> psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1
SUPABASE_DB_CONTAINER=supabase_db_<격리DB> PRODUCT_DETAIL_PRESENTATION_TEST_SCOPE=isolated-local bash supabase/tests/product_detail_presentation_concurrency.sh
```

CI의 scope는 `ci`이다. 기능 테스트는 `safeupdate`를 로드할 수 있는 `supabase_admin` 연결을 사용하며 테스트의 실제 사용자 역할 검사는 authenticated/anon 전환으로 수행한다.

## 실제 화면과 원복

증거 manifest (`output/smartstore-reference-20261012/verification-product-detail/manifest.json`)는25개 PNG 중20개를 채택한다. 각 파일 URL·SHA-256·크기·제외 사유를 기록했고 모든 해시를 재검증했다. 로딩 화면·미리보기 폭 조정 전·리뷰 탭이 캡처 위치 밖에 있던 화면은 완료 근거에서 제외했다.

- 배너 제목11자 오류에서 입력 보존, 불명확한 저장에서 입력 동결, 후속 DB 수정 뒤 같은 요청 성공을 확인했다. 전체/개별/카테고리 저장, 개별 대상 상품만 노출, 미래 기간 숨김, 오늘 종료일까지 노출, 라이트/다크 공개 표시를 확인했다.
- 두 탭 중 먼저 저장한 결과를 유지하고 오래된 탭 저장은 충돌로 거절했다. 두 번째 탭의 `충돌 보존` 입력은 남았다.
- 합성 공개 구매 리뷰1건의100% 요약, 유사 후보6개, 같은 합성 주문의 함께구매5개, 스토어인기5개를 실제 공개 화면에서 확인했다. 분류가 없는 상품의 카테고리 인기 영역은 숨었다. 수동 유사/함께 구매 편성이 있는 다른 상품에서는 해당 자동 영역이 각각0개였다.
- 새 리뷰 링크의 클라이언트 이동이 기존 리뷰 탭의 최초 선택 계약과 충돌하는 결함을 수정했다. 전체 문서 이동을 사용하며 동일 리뷰 URL에서 상세 탭을 다시 선택한 경우에도 재클릭하면 리뷰 탭을 연다. 최초 이동/동일 URL 모두 실제 `aria-selected=true`와 구매 리뷰 본문을 확인했다. 수정키로 새 탭 열기는 유지한다.
- 관리자 배너/모듈과 공개 배너/리뷰/추천390px는 모두 `scrollWidth=clientWidth=380`이었다. 추천 카드 행만 내부 가로 스크롤을 사용했다. 모든 viewport/media 임시 설정을 해제했다.
- 배너를 비노출·라이트·빈 문구·기간 없음·전체 상품으로, 모듈5개를 모두 꺼서 시작값으로 원복했다. 최종 revision은 배너8/모듈2이고 대상 FK는 각각0개다. 감사 이력은 보존했다.
- 이 검증에서만 만든 합성 사용자1·주문1·주문항목6·결제1·시도1·서버 승인근거1을 정확한ID/fixture 표식 조건으로 제거했다. DB 최종 재조회 (`output/smartstore-reference-20261012/verification-product-detail/final-database-readback.json`)는 모두0개를 확인한다. 기존 상품·옵션·재고·리뷰·수동 관계는 수정하지 않았다. 공개 최종 재조회 (`output/smartstore-reference-20261012/verification-product-detail/final-browser-readback.json`)에서 배너/상단요약/자동추천0개와 필수 탭을 확인했다.

수집된 공개 오류9개는 모두 브라우저 확장의 `data-immersive-translate-page-theme` 속성에 따른 hydration 경고다. 관리자 로그에는 같은 경고22개와18:34~18:35의 runtime CSS 복사 전 module-not-found11개가 남아 있다. 실제 검증은 파일 복사 후 수행했고 이 모듈 오류는 재발하지 않았다. 확장/애플리케이션 경고 억제 설정은 바꾸지 않았다.

구매유도 통계·배송비 절약·관심상품 모음은 [후속 구매·탐색 구현·검증](product-detail-experiences-implementation-qa.md)에서 완료했다. 대표미디어는 [영상 구현·검증](product-detail-media-implementation-qa.md), 이미지 영역 선정 리뷰는 [선정 BEST 리뷰 구현·검증](product-detail-review-best-implementation-qa.md)에서 완료했다. 동일 제품군의 다른구성은 남은 독립 단위다. 이 문서는 명시한 로컬 완료 범위의 근거이며 상품상세 원본 전체 일치나 운영 배포 완료를 뜻하지 않는다.

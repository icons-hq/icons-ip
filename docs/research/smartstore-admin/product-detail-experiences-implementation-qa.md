# 상품상세 구매·탐색 구현·검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13 격리 로컬 Supabase와 실제 Next 화면에서 구매유도 메시지, 배송비 절약, 관심상품 저장·공개 반영·충돌·복원을 검증했다. 운영 배포와 네이버 설정 적용은 하지 않았다. [원본 대조와 집계 정의](product-detail-experiences-parity.md)를 따른다.

## 구현과 저장 경계

`/admin/display/detail/experience`는 구매유도 메시지와 배송비·관심상품을 독립 저장한다. `private.product_detail_experience_settings`의 두 행에 별도 revision을 두고 현재 `store.manage` 권한, actor 잠금, operation UUID 멱등성, CAS와 감사 이력을 적용한다. 전송 결과가 불명확하면 입력·revision·UUID를 고정하고 같은 요청으로 확인한다. 신규 표시 기능은 기본 OFF다.

공개 페이지는 최대 네 가지 실적 문구, 실제 선택 옵션·수량의 배송비 비교, 본인 관심상품 목록을 조합한다. 기존 KC·고시·문의·리뷰·배송 탭과 리뷰 이벤트 고지는 유지한다. 가격/기간 변경 시각과 한국 자정·신상품 만료 시각을 페이지 갱신 경계에 포함한다. 최근 본 굿즈는 서버가 표시 ON과 요청 계정 일치를 확인한 뒤에만 브라우저에 보관한다.

네 migration을 OWN/FRESH에 적용하고 각각 전체 SQL 한 항목으로 migration 이력에 등록했다.

- `20261020085249_product_detail_experiences.sql`: 설정과 실적·관심·배송비 RPC.
- `20261020085252_product_detail_experience_read_guard.sql`: 실제 PostgREST의 STABLE 읽기 트랜잭션에서 actor 행 잠금이 실패한 문제를 수정. 읽기는 현재 권한을 잠금 없이 검사하고 쓰기 actor 잠금은 유지한다. 수정 전 HTTP 405/SQLSTATE 25006, 수정 후 실제 REST 200을 확인했다.
- `20261020085254_product_detail_two_year_fallback.sql`: 원본 2년 옵션의 1명 이상 규칙을 반영. 이미 적용한 migration은 보존했다.
- `20261020085258_product_detail_experience_contract_refresh.sql`: fallback 변경 뒤 빠진 내부 함수 본문 해시를 재등록했다. OWN/FRESH 권한 계약 coverage가 RPC 348개·RLS 89개·내부 helper 477개로 통과했다.

## 검증

관련 단위/서버/액션/공개 상세/경계 7파일 71테스트, 계정 전환·전송 실패 2파일 7테스트, 관련상품 용어 경계 2파일 6테스트를 통과했다. 마지막 문구 수정 후 모델·서버·액션·계정 격리·전송 보호 5파일 18테스트와 관련 ESLint를 통과했다. 구현 후 전체 TypeScript 검사를 통과했다. 전체 저장소 빌드와 통합 테스트는 상위 통합 검증에서 수행한다.

기능 SQL은 6종 권한·일반 사용자·직접 접근 차단, 입력 범위/추가키, operation 재시도·충돌·CAS, 실제 승인 근거/사용자·금액/완료 반품 제외, 서로 다른 고객 수, 구매 기간 단계, 2년 OFF와 500일 전 1명의 fallback, 신상품 만료, 본인 관심 원장과 다른 계정 격리, 실제 옵션·최소수량·재고/판매기간, 무료/개별배송/다른 출고지·미공개 제외를 검증했다. 최종 기능 SQL은 FRESH에서 `safeupdate`를 로드하고 통과했으며 테스트 행은 롤백했다.

복제 DB에서는 읽기 전용 getter, 동일 영역 CAS, 같은 요청 재시도, 독립 영역 저장, UUID 요청 충돌, 권한 회수 뒤 저장 거절을 통과했다. 실제 잠금 대기를 관측하고 최종 revision 3/2·감사 5개를 확인했다. 복제는 실행기가 종료 시 제거한다. 100개 추가 합성 후보 중 품절 50개를 제외하고 절약액 없는 후보 50개를 모두 계산한 측정은 127.805ms였다. 운영 데이터 규모에 대한 성능 보장은 아니다.

```sh
cat supabase/tests/helpers/goods_kc_fixture.sql supabase/tests/product_detail_experiences.sql | docker exec -i supabase_db_<격리DB> psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1
SUPABASE_DB_CONTAINER=supabase_db_<격리DB> PRODUCT_DETAIL_EXPERIENCES_TEST_SCOPE=isolated-local bash supabase/tests/product_detail_experiences_concurrency.sh
```

## 실제 화면과 복원

화면 증거 (`output/smartstore-reference-20261012/verification-product-detail-experiences/manifest.json`)에는 데스크톱·390px·저장 결과·충돌 입력 보존을 기록했다. PNG의 SHA-256을 재검증했다. 로딩 중이거나 확인 대상이 캡처 밖인 화면은 시각 완료 근거에서 제외했다.

- 합성 승인 주문 20건·서로 다른 고객 10명으로 오늘 10명 구매, 최근 3개월 10명 재구매, 직전 3일 판매 1위, 등록 7일 이내 메시지가 나왔다. 주문 수를 구매자 수로 표시하지 않았다.
- 수량 1 → 35 변경으로 후보의 절약액이 3,000원 → 6,000원, 함께 주문 배송비가 3,000원 → 무료로 다시 계산됐다. DB quote 결과와 일치했다. 개별 배송 상품에서는 절약 후보가 없었다.
- 현재 상세를 제외한 본인 재구매 1개, 실제 UI로 추가한 장바구니 1개·찜 1개, 최근 본 3개를 독립 페이지와 상세에서 확인했다. 빈 종류가 숨고 최근 본 목록 삭제가 반영됐다. 전체 메뉴의 관심 굿즈 링크를 DOM에서 확인했다.
- 390px 구매 실적 문구는 이미지 안에서 줄바꿈됐고 관심 필터·카드는 넘치지 않았다. 관리자 390px는 문서 폭 380px로 화면 밖 가로 넘침이 없었다. 임시 viewport 설정을 해제했다.
- 두 탭의 메시지 revision 1에서 먼저 저장한 기본 OFF 결과를 유지했고 다른 탭의 11명/체크 ON 저장은 충돌로 거절하면서 입력을 보존했다.
- 모든 표시를 OFF, 임계치 각각 10명, 2년 옵션 ON으로 복원했다. 최종 revision은 메시지 2·탐색 2, 감사는 4건이다. 추가한 장바구니·찜·최근 본 항목과 합성 고객 9명·주문/항목/결제/시도/승인근거 각 20건은 제거했다. DB 재조회 (`output/smartstore-reference-20261012/verification-product-detail-experiences/final-database-readback.json`)는 해당 행 0개를 확인한다. 기존 상품·재고는 바꾸지 않았다.
- 공개 최종 재조회 (`output/smartstore-reference-20261012/verification-product-detail-experiences/final-browser-readback.json`)는 세 영역이 모두 0개이고 필수 탭이 유지됨을 확인한다. 남은 브라우저 로그는 확장이 삽입한 `data-immersive-translate-page-theme` 속성의 hydration 경고이며 경고 억제 설정을 바꾸지 않았다.

대표 영상·선정 베스트리뷰·다른 구성은 이 검증의 완료 범위에 포함하지 않는다.

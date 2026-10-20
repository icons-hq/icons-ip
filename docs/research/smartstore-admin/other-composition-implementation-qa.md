# 다른 구성 상품 편성·전시 계약

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-15 기준 구현·격리 검증 기록이다. 운영 DB 적용, 원본 네이버 스토어 저장, production 배포는 하지 않았다. 제목 검증을 포함한 최종 DRAFT는 두 격리 clone에서 통과했다. 정식 적용과 실제 브라우저 검수는 아래 상태를 따른다.

## 원본 근거와 ICONS 범위

원본 패널 (`output/smartstore-reference-20261012/other-composition-source/source-panel.png`)과 확인 내용·해시 (`output/smartstore-reference-20261012/other-composition-source/manifest.json`)에서 같은 상품의 용량·구성·맛·향, 패션/잡화의 컬러·디자인 추천, 후보0개 숨김, 상단 리뷰 요약 다음·상세정보 탭 이전 배치를 확인했다. 원본은 자동 추천을 설명하며 수동 제품군 등록이나 추천 산식을 공개하지 않았다.

ICONS는 운영자가 구성 관계와 상품별 표시값을 지정한다. 수동 지정, 대표 포함2~10개, 표시값40자는 ICONS 정책이다. 옵션·추가구성상품·자동 유사 추천·코디와 별개이며 네이버 자동 추천과 동등한 정확도를 주장하지 않는다.

## 저장과 운영 화면

- `/admin/catalog/related-goods`의 독립 `other_composition` 유형에 대표를 포함한 서로 다른 상품2~10개, 제목1~15자, 전시 여부·기간·순서, 상품별 선택 표시값을 저장한다. 이미지는 사용하지 않는다. 대표는 관리용이며 구성 안에 있어야 한다.
- 표시값은 최대40 Unicode 글자이며 앞뒤 공백을 정리한 빈 값은 미입력으로 저장한다. 저장된 표시값은 양끝 공백·제어문자를 허용하지 않고 공개 응답에서는 미입력을 `null`로 반환한다. 제목도 새 유형에서 공개 parser와 같은 제어문자·공백 기준을 적용한다. 기존 세 유형의 제목 계약은 그대로다.
- 상품 제거·유형 변경은 해당 표시값을 정리하며 상품찾기로 다시 편집할 때 유지된 상품의 표시값을 보존한다. 미리보기는 현재 공개 상품을 골라 공개 상세와 같은 대칭 관계를 보여준다. 비공개 대표가 있어도 공개 B/C를 기준으로 미리 볼 수 있다.
- 초안·보관·판매 제한 상품의 관리 참조는 보존한다. 초안 상품 URL 변경은 FK cascade로 대표와 구성 표시값을 함께 따라간다. 구성 자체는 구매 수량·재고·리뷰 집계·장바구니 항목을 만들지 않는다.
- 목록의 새 유형 필터와 XLSX를 지원한다. 다른 구성 행이 있는 내보내기에만 표시값 열을 추가하며 기존 유형만 있는 기존 파일의 열 계약은 유지한다.
- `/admin/display/detail?tab=otherComposition`의 별도 `otherComposition: {enabled:false}` section을 사용한다. 기존 배너·모듈의 값과 revision, 모듈5개 키를 바꾸지 않는다. 전시 설정은 `store.manage`, 상품 편성은 `catalog.manage`로 각각 검사한다.
- 저장은 기존 operation UUID·revision·운영자 잠금·감사 계약을 따른다. 같은 요청 재시도는 같은 결과와 감사1건을 유지한다. 전송 결과가 불명확하면 입력·operation을 고정해 같은 요청으로 확인하며, 오래된 revision은 충돌로 알리고 입력을 유지한다.

## 공개 조회

`get_good_other_compositions(text)`는 기존 세 유형의 공개 reader와 분리한다. `SECURITY DEFINER`, 빈 search path, PUBLIC/anon/authenticated/service_role 전체 revoke 후 anon/authenticated와 owner의 실행만 허용한다. 원장 직접 쓰기·private 설정 읽기 권한은 열지 않는다.

현재 상품과 후보 각각은 상품/IP 공개·미보관·판매제한없음을 충족해야 한다. 대표 A가 비공개여도 공개 B 상세에는 C, C 상세에는 B가 표시된다. 공개 응답에는 그룹ID·제목·현재 상품을 제외한 후보ID·선택 표시값·다음 시간 경계만 포함한다. 대표ID·숨긴 구성·운영자 정보는 내보내지 않는다. 후보0개면 그룹을 숨기고, 품절 후보는 기존 카탈로그의 품절 표시와 함께 유지한다.

기간은 시작 포함·종료 제외다. 여러 그룹이 겹쳐도 각각 유지하며 간접 연결을 합치거나 자동으로 다른 후보를 만들지 않는다. 그룹은 생성시각/ID, 구성은 지정 순서다. 기존 함께구매·유사상품·코디의 대표 공개 게이트와 DTO는 유지한다.

서버 loader는 현재 상품과 후보를 ID로 직접 다시 조회하고 기존 카드의 가격·옵션·공급 계약을 사용한다. 카탈로그 첫1,000행 제한에 의존하지 않으며 ID가 많으면 직접 조회를 나눈다. 재조회 때 현재 상품이나 후보가 비공개가 되면 제외한다. 전송·파싱 실패는 정상0후보와 구별한다.

공개 카드는 상단 리뷰 요약 바로 다음, 상세정보 탭 이전에 배치하며 embedded 상세에는 표시하지 않는다. 전시 기간과 카드 가격·공급의 다음 경계에서 상세를 다시 조회한다. 카드에서 이동·구매할 때는 각 상품의 기존 상세·주문 계약을 그대로 사용한다.

## 검증 상태

초기 DRAFT `676b3f0b…`는 OWN/CANON 폐기 clone 각각에서 다음을 통과했다.

- 실제 SQL61 assertions: 새 토글·replay/conflict·권한·2~10 구성·표시값·C1/Unicode 공백·공개 게이트·비공개 대표 대칭·다중 그룹·기간·URL cascade·read-only/ACL.
- 실제 anon 기존3유형 공개 reader 및 상품상세 full JSON의 적용 전후 동일성. 새 kind 행이 생겨도 기존 응답에 섞이지 않음.
- 실제 SQL 공개2캡처 및 관리자 문서/목록/설정 캡처를 production loader/parser에 연결한6 tests.
- 실제 PostgreSQL Lock wait3경합: 같은 operation은 저장·감사1회, 같은 revision은 승자1개와 구성/표시값 원자성, 별도 전시 설정 revision 충돌.
- 기존 함수 owner/ACL, 관계·설정 외 전체 행, Auth/Storage, RLS, 전체 migration ledger, 관련 없는 registry 보존. 새 label 열의 기존 값은 전부 null, 기존 member/설정 행은 허용된 추가분을 제외하고 정확히 동일.
- 새 홈 상설 SQL25 assertions를 전후 실행하고 전체 rollback snapshot 확인. source DB 전체 snapshot·migration346개·실행 소비 소스 불변 및 clone/덤프 삭제 확인.

초기 결과: 집계 (`output/other-composition-design-20261015/final-summary.json`), 보존한 실행 소스 (`output/other-composition-design-20261015/verified-676b3f0b-sources/manifest.json`). 기존61개 결과를 새 제목 보완의 실행 증거로 세지 않는다.

새 제목 보완 DRAFT `b38512ec…`와 추가6 SQL 검사는 변경 계약 (`output/other-composition-design-20261015/title-contract-update.md`)에 기록했다. 관련 앱/공개 parser/UI 재시도23 tests가 통과했다. source347/OWN279/CANON347을 기반으로 두 폐기 clone에서67 SQL·6 DTO·3경합·홈25+25와 모든 source/기존 데이터/권한 보존 및 cleanup을 다시 통과했다(최종 제목 보완 검증 (`output/other-composition-design-20261015/title-final-summary.json`)). 정식 [348 migration](../../../supabase/migrations/20261020085418_goods_other_compositions.sql)은 검증 DRAFT와 첫 주석을 제외한 본문이 같다. exact OWN/CANON clone에서 원문 ledger COMMIT, OWN16/CANON15 guard 거절과 전체 rollback, 잘못된 migration role 거절, 상설67·DTO6·홈25전후·legacy full JSON·전체 source/기존 데이터/권한 보존을 통과했다. ROOT가 OWN280/FRESH313/CANON348 적용과 post-commit readback을 완료했다(named 결과 (`output/other-composition-named-qa-20261015/plan-ddce6f0a56764eb18303c24d0a475819/named-summary.json`)). CI에는 상설 SQL을 연결했다. 이후 ROOT의 고정 런타임 실제 PC/390px 검수 (`output/home-other-browser-qa-20261015/browser-observations.json`)와 정상 은퇴 (`output/home-other-browser-qa-20261015/retirement-result.json`)를 완료했다.

## 실제 화면 후속

비공개 대표A를 포함한 A/B/C 편성을 정상 저장·재열기하고 상품별 표시값을 확인했다. 공개B→C와 C→B의 대칭 표시, 숨긴A와 현재 상품 제외, 후보0개F의 숨김, B/C만의 미리보기와 모바일300mL 표시를 확인했다. 활성 탭의 충돌에서 입력을 유지한 뒤 최신 상태로 다시 읽었고 관리자·공개390px에 페이지 가로 넘침이 없었다. 다른 구성 전시와 상단 리뷰 모듈은 각각 저장하고 원래 값으로 정상 복원했다.

검수 당시 목록 푸터가 비공개 대표의 예외를 설명하지 않고, 가이드가 상품 헤더 평점을 상단 리뷰 모듈과 연결한 문구 오류2건을 기록했다. 후속 문구 적용 (`output/final-copy-fixes-20261015/applied.json`)에서 실제 동작에 맞게 고쳤다. 기존 브라우저 자료는 수정 전 동작을 확인한 기록이며, 수정된 문구의 새로운 브라우저 캡처까지 수행한 것으로 세지 않는다.

은퇴 시 소유 계정3개·상품6개를 종료/비공개 처리하고 리뷰7개·취소된 FK 주문7개를 보존했다. 재고 변화·새 결제/환불/배송/주문품목은0이고 전역 전시 값은 정상 저장으로 복원하며 revision·감사를 보존했다. 원본 all-Auth-exact 검사는 비소유 계정 변경으로 실패한 이력이 있다. 정확히 관측한 Auth 변경만 별도 근거로 결속했으며 원인을 확정하거나 모든 Auth 행 불변으로 주장하지 않는다. 원본 baseline·실패 기록과 보존 범위는 은퇴 영수증을 따른다. 이후 5개 scope 종료 후 공유 runtime 정리 (`output/shared-local-browser-qa-20261015/runtime-cleanup.json`)도 완료했다. 운영 배포·네이버 자동 추천과의 동등성은 검증하지 않았다.

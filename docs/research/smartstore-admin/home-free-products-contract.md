# 홈 자유상품 리스트·풀이미지 구현 계약

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 KST. **구현과 격리된 OWN/FRESH DB 적용·검증을 완료했다. 운영 배포는 수행하지 않았다.** 네이버 원본에서는 설정 화면과 도움말을 읽고 임시 미리보기 유형만 전환했다. `적용하기`, 상품 선택 완료, 업로드는 실행하지 않았다. 소유 조사 탭 3개를 종료했다.

## 확인한 원본

| 항목 | 확인값 | 근거 |
| --- | --- | --- |
| 제목 | 입력 최대 15자. 필수 여부·빈 제목 최종 저장은 미확인 | 실제 `maxlength=15`, 리스트 폼 (`output/home-free-products-contract-20261014/list-count-options.jpg`) |
| 리스트형 전시 개수 | **3–12개** | 실제 드롭다운 텍스트 (`output/home-free-products-contract-20261014/list-count-options.txt`) |
| 풀이미지형 전시 개수 | **1–8개** | 실제 드롭다운 화면 (`output/home-free-products-contract-20261014/full-image-count-options.jpg`), 텍스트 (`output/home-free-products-contract-20261014/full-image-count-options.txt`) |
| 풀이미지 배치 | PC 2열·모바일 1열 | [공식 자유상품 도움말](https://help.sell.smartstore.naver.com/faq/content.help?faqId=17548), 읽기 기록 (`output/home-free-products-contract-20261014/free-products-official-help.txt`) |
| 사진 | 두 유형 모두 정사각·세로직사각·가로직사각 선택. 대표이미지를 중심 기준으로 잘라 표시 | 위 실제 폼, 같은 도움말 목록의 썸네일 문항 읽기 기록 (`output/home-free-products-contract-20261014/thumbnail-official-help.txt`). 정확한 수치 비율은 미확인 |
| 구성 개수 | 자유상품 구성 최대 5개. 공식 안내는 리스트·모자이크·풀이미지를 한 자유상품 그룹으로 설명 | 위 공식 자유상품 도움말 |
| 후보 상품 선택 | 전시 개수와 별도 후보 목록·순서가 존재. 상품 추가 팝업 URL에 `maxSelect=100` 확인 | 팝업 읽기 기록 (`output/home-free-products-contract-20261014/picker-readback.json`). 100개 선택·최종 등록은 실행하지 않아 실제 저장 상한으로 단정하지 않음 |
| 링크 | 일반 카드 예시는 상품 정보와 상세 진입을 제공. 자유상품 폼에 구성용 임의 링크 입력은 없음 | 기존 캡처 `store/230–234`, 이번 두 폼 |

품절·판매중지 후보가 관리자 목록에 남는 것까지 읽었다. 리스트·풀이미지의 전시 가능 상품 부족, 비공개 처리, 매출 0 처리와 최종 저장 결과는 확인하지 않았다. 이 항목들은 아래 ICONS 동작을 명시하여 구현한다.

## 현재 구조와 최소 변경 방향

현재 `best_tab`은 수동 `good_ids` 최대 12개 또는 최신 등록순 3–10개이며, `slot=category|popular`에 따라 여러 레코드가 한 BEST 탭 영역에 합쳐진다. 제목 한도는 120자다. [`lib/admin/curations.ts`](../../../lib/admin/curations.ts), [`lib/catalog.ts`](../../../lib/catalog.ts), [`Home.tsx`](../../../components/screens/Home.tsx)의 현재 동작이다. 여기에 디자인만 추가하면 독립 자유상품 제목·개수·배치와 기존 탭 동작이 섞인다.

**기존 `home_curations` 안에 `product_collection` 종류 하나를 추가하고 `payload.layout=list|full_image`로 두 디자인을 다룬다.** 테이블, 관리 메뉴, 권한, 저장 RPC·감사·기간 모델은 재사용한다. 기존 `best_tab`과 `product_mosaic`의 데이터·편집·공개 렌더는 자동 변환하지 않는다. 전시 전용 분류, 다른 구성, 그룹상품, 범용 팝업을 추가하는 안은 아니다.

| 계약 | 구현 |
| --- | --- |
| 제목 | 공백 제거 후 1–15자 필수. 원본의 빈 제목 최종 저장을 확인하지 않았으므로 필수는 기존 ICONS 독립 구성과 맞춘 정책으로 표시 |
| 디자인 | `list` 또는 `full_image`만 허용. 리스트는 PC 4열·모바일 2열의 기존 상품 카드 크기, 풀이미지는 PC 2열·모바일 1열. 리스트의 정확한 열 수는 ICONS 정책 |
| 전시 개수 | 별도 `item_count`: 리스트 3–12, 풀이미지 1–8. 유형 전환 시 범위를 벗어난 값은 필드 오류로 안내하고 후보·순서는 보존; 조용히 잘라 저장하지 않음 |
| 후보 목록 | `good_ids` 0–100개, 중복 금지·순서 유지. 100개는 팝업 URL을 참고한 ICONS 저장 계약이며 원본 최종 저장 검증값으로 쓰지 않음. 기존 상품 검색·선택·순서 변경 UI를 재사용 |
| 사진 | 기존 상품 대표이미지 사용; 구성별 추가 업로드 없음. `image_shape=square|portrait|landscape`, 중심 잘라내기. 수치 비율은 1:1·4:5·5:4로 명시한 ICONS 정책. 일반 상품목록의 1:1·contain 정책과 별개인 구성별 선택이며 일반 카드 전역 CSS는 바꾸지 않음 |
| 링크 | 각 카드의 `/shop/{goodId}`만 사용. 구성 제목/별도 더보기/임의 목적지 입력 없음. 구성 `link_path`는 `null`; 이 종류의 공개 로더가 임의 링크를 요구하지 않도록 분리 |
| 공개 적격성 | 기존 공개 카탈로그에 있는 상품만 대상으로 후보 순서대로 필터링한 후 `item_count`까지 채움. 비공개·삭제·판매 제한 상품은 카드 및 링크에서 제외하고 관리자 후보 ID는 보존 |
| 빈 목록·매출 | 후보 0개 저장 가능. 공개 적격 상품 0개면 제목을 포함해 영역 전체를 숨김. 1개 이상이면 설정 개수보다 적어도 있는 만큼 표시. 매출 0은 수동 자유상품 제외 사유가 아니며 공개 카드에 주문수·매출·유입·구매율을 추가하지 않음 |
| 품절·판매기간 | 공개 카탈로그의 품절 상품은 남기고 기존 품절/판매예정/판매종료 표시와 상세 페이지 구매 제한을 재사용. 관리자 선택 목록에도 상태 표시 |
| 모자이크 구분 | 모자이크는 기존 8개 고정 위치, 슬롯별 별도 이미지, 10자 제목·20자 부제, 빈 위치 보존을 유지. 리스트·풀이미지는 일반 대표이미지와 압축된 후보 목록을 사용하며 모자이크로 변환하는 기능을 넣지 않음 |
| 구성 5개 | `product_collection`과 `product_mosaic`를 합쳐 비노출·예약·종료 포함 최대 5개. 같은 DB 잠금으로 종류 간 동시 생성도 보호. 기존 레코드는 삭제·변환하지 않고 5개에서 기존 수정·비노출은 허용 |
| 전체 순서·숨김 | `products:{uuid}`를 기존 홈 전체 순서 모델에 연결하여 구성별 이동·숨김을 지원. 개별 노출 기간/스위치와 전체 레이아웃 스위치를 모두 적용. 신규 구성은 기존 규칙대로 끝에 추가 |
| 저장·실패 | 기존 `store.manage`, 현재 권한 재검사, operation ID 멱등 재시도, expected-updated-at CAS, `PT409`, 실패 입력 보존·명시적 최신 복구를 공유. 신규 payload 필드의 형식·키·범위를 JS와 DB에서 함께 검증 |

`product_collection`은 기존 전시 구성 모델의 종류 추가이며 새로운 상품 분류 체계를 뜻하지 않는다. 후보 최대 개수·수치 비율·빈 목록 동작 등 미확인 원본 동작을 위 ICONS 정책과 구분해 기록한다.

## 변경·검증 범위

- 담당 범위: `lib/admin/curations*`, `curation-editor*`, `CurationSection`·상품 선택·미리보기, `lib/home-catalog.ts`/`catalog.ts`, `Home`과 새 자유상품 renderer/CSS, 기존 홈 레이아웃의 `products:` 연결, CLI 신규 migration·관련 SQL/경합 검사. 전체 메뉴와 중앙 PRD/ARCH/guide/README 연결은 root가 담당한다.
- 적용 전 독립 검토: 기존 모자이크 5개 trigger를 그룹 공통 한도로 바꾸는 잠금 순서, 기존 BEST/배너/모자이크 보존, 모든 실행 권한 봉인, 이미 적용한 migration 불변을 확인한다.
- 기능 검증: 두 디자인·세 비율·Unicode 15자·개수 경계·100개 후보·중복·전시 개수 변경의 후보 보존·비공개 제외 후 채우기·0개 숨김·매출 0/품절·기간·상품 링크·개별 및 전체 숨김.
- 저장 검증: 동일 operation ID, 두 창 CAS와 입력 보존, 권한 회수 후 재시도 거절, 4→5개 서로 다른 자유상품 종류 동시 생성, 모자이크 수정·종류 유지, 전체 레이아웃 CAS.
- 실제 Chrome: 관리자 PC/390px 입력·공개 미리보기, 저장 후 공개 PC/모바일 열 수·사진 비율·링크·품절/비공개/빈 영역·전체 순서/숨김, fixture와 소유 runtime/탭 정리. 테스트·타입·lint는 영향 범위만 실행하며 운영 배포는 별도다.


## 완료 근거

- CLI로 만든 [`20261020085320_home_free_product_collections.sql`](../../../supabase/migrations/20261020085320_home_free_product_collections.sql)을 독립 검토 뒤 OWN/FRESH에 적용했다. SHA-256은 `d3b02d97d536d13560685e5fe12b8ee575eb367bc4576de5559539883f7f16a9`이며 파일 원문과 각 DB migration ledger의 statement가 일치한다. 함수 정의·소유자·ACL 11개도 두 DB가 동일하다.
- 두 DB의 disposable clone에서 기존 모자이크 7개를 모든 열 그대로 보존하고, 상한 초과 상태의 편집·비노출은 허용하면서 추가를 거절했다. 원본·clone의 함수 정의·소유자·ACL·RLS를 정규화 비교한 뒤 기능·권한 coverage와 11개 실제 잠금 경합을 통과했다.
- 관련 단위 테스트 179개, 전체 test tsconfig typecheck, 담당 TS/TSX lint를 통과했다. OWN/FRESH의 신규 기능·기존 프로모션 배너·권한 coverage SQL을 통과했고, FRESH의 기존 홈 SQL 4종과 모자이크 5·6번째 동시 생성도 통과했다. legacy fixture lease·trigger는 제거됐다.
- 실제 Chrome에서 리스트/풀이미지 × 정사각/세로/가로 × PC 1440/모바일 390의 12개 조합을 검증했다. PC 4/2열, 모바일 2/1열과 1:1·4:5·5:4 비율, 이미지 중앙 `cover`를 실측했다. 실측값 (`output/home-free-products-qa-20261014/browser-matrix.json`), 공개 홈 (`output/home-free-products-qa-20261014/global-order-first.png`), 모바일 풀이미지 (`output/home-free-products-qa-20261014/full-portrait-mobile.png`).
- 후보 `비노출→매출 0→품절→공개→공개`를 저장하고 공개 화면은 앞의 비노출을 제외한 3개를 순서대로 채웠다. 모든 링크는 해당 상품 상세였다. 16자 제목 거절·15자 Unicode 제목 저장, 12개 리스트에서 풀이미지로 전환할 때 오류와 후보 5개 보존, 두 탭 CAS 실패 입력 보존·명시적 최신 복구, 전체 영역 최상단 이동·숨김·재노출, 빈 후보의 제목까지 숨김을 확인했다.
- 기존 모자이크 2개와 새 구성 3개(비노출 포함)가 합계 5개일 때 두 유형의 신규 추가가 비활성화되고 기존 구성 편집은 성공했다. 합성 구성 3개·상품 5개·KC reviewer 5개·IP를 제거하고 기존 전체 레이아웃을 CAS로 복구했다. 공용 사진의 경로·active·revision 5는 동일하다. 전용 4322 runtime과 소유 탭 3개, 임시 viewport 설정을 정리했다.
- Console에서 관찰한 hydration 경고는 번역 확장이 `html`에 추가한 `data-immersive-translate-page-theme` 속성 불일치였다. 자유상품 코드의 런타임 예외는 관찰되지 않았다. 브라우저 검증은 격리 로컬 DB에 대한 결과이며 운영 배포 완료를 의미하지 않는다.

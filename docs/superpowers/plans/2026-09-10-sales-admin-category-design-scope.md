# #474 고객용 계층 카테고리·ERP 분류 연결 — 설계 범위안

상태: **구현 중**

이 문서는 #474의 구현 파일과 계약을 고정하기 위한 범위안이다. 현재 운영에 실제로 쓰는 4단계 분류표와 ERP 분류표가 제공되지 않았으므로, 이 문서만으로 고객 카테고리나 ERP 매핑을 활성화하지 않는다. 실제 값·출처·검증 담당자·적용 시점이 없는 상태는 `미설정`이며 0, 무제한, 자동 매핑, 검토 완료로 해석하지 않는다.

## 채택할 기본 구조

- 고객 카테고리는 최대 **4단계**의 단일 부모 트리다. 각 노드는 부모를 0개 또는 1개만 가지며, 루트부터 말단까지 깊이를 1~4로 계산한다.
- 굿즈는 고객용 **기본 말단 카테고리 하나**만 가진다. 복수 소속은 이번 범위에 넣지 않는다. 미분류 굿즈는 새 분류가 활성화된 뒤에도 기존 `type`·전체 목록에서 계속 판매하며, 새 category가 없다는 이유로 전체 상품 판매를 차단하지 않는다.
- 각 고객 카테고리는 ERP 분류 **하나**에만 연결된다. ERP 코드·표시명·출처와 유효 시점을 함께 보존하며, N:M·복수 ERP 코드·상품별 예외 매핑은 후속 결정이다.
- 기존 `goods.type` 8종은 즉시 제거하지 않는다. 기존 목록·검색·엑셀·주문 기록 소비자는 그대로 동작하고, 새 계층 카테고리와 병행한다. 실제 분류표가 제공된 뒤에만 이관표를 별도 입력하며, 이름이 비슷하다는 이유로 자동 매핑하지 않는다.

## 활성화 차단

고객 category와 ERP 매핑은 서로 독립된 gate를 둔다. 실제 값과 운영 확인 근거가 없으면 각 gate를 OFF로 두며, 새 category 미설정 굿즈의 기존 판매·전체 목록은 이 gate와 무관하게 유지한다.

고객 category gate를 열려면 다음 증거가 필요하다.

1. 실제 4단계 고객 분류표와 각 노드의 고유 코드·표시명·부모 관계
2. ERP 분류표의 출처, 코드·품명, 적용 버전 또는 기준일
3. 고객 말단 카테고리↔ERP 분류 1:1 매핑과 미매핑 목록
4. 담당자·검증 시각을 포함한 운영 확인 근거

ERP mapping gate를 열려면 별도로 다음이 필요하다.

- 실제 ERP code·name·source와 검증 시점
- category별 매핑 또는 명시적 미설정 목록
- 미매핑을 빈 값으로 만들지 않고 `미설정`으로 표시하는 조회/export 계약

기존 8종 `goods.type` 이관표는 선택적으로 기록한다. 모든 8종의 mapping이 없다는 이유로 전체 category 기능을 막지 않으며, 유사 이름 자동 이관은 하지 않는다.

게이트가 OFF인 동안 운영자는 draft 트리와 매핑 초안을 검토할 수 있지만, 고객 화면은 기존 `type` 동작을 사용한다. UI 배지나 저장 성공만으로 공개 기능을 열지 않으며, 각 gate 전환은 staff 재검증·감사 로그를 갖춘 별도 RPC로 제한한다.

## 불변식과 전이

- 생성·이동·보관·복원은 audited RPC를 통한다. 직접 table write와 hard delete는 제공하지 않는다.
- 이동 대상과 새 부모를 잠근 뒤 새 깊이와 모든 하위 노드의 깊이를 계산한다. 자기 자신·하위 노드로의 이동, 4단계 초과, 존재하지 않는 부모를 거절한다.
- 참조된 카테고리는 물리 삭제하지 않고 보관한다. 보관된 노드는 새 굿즈에 연결할 수 없고, 기존 연결과 과거 기록은 보존한다. 참조 leaf 이동은 leaf 정체성을 보존하고 새 깊이·cycle 검증을 통과하면 허용한다.
- 굿즈 연결은 말단 노드만 허용한다. 카테고리 미설정 초안은 저장할 수 있지만, gate가 열린 뒤 공개 검증은 `미분류` 정책을 명시적으로 통과해야 한다.
- ERP 매핑 변경은 이전·현재 값, actor, 사유, 매핑 버전을 audit에 남긴다. 매핑이 없는 카테고리는 ERP 내보내기에서 조용히 빈 문자열로 채우지 않고 검토 대상 행으로 표시한다.
- 동시 생성·이동·매핑·상품 적용은 대상 행과 트리 범위의 잠금 순서를 고정하고 stale expected version을 검증한다. 경합은 재시도 가능한 business conflict로 반환하며 PostgreSQL serialization retry 상태로 위장하지 않는다.

## 구현 파일 범위

구현 승인 뒤 새 도메인 seam은 다음 파일로 시작한다.

| 영역 | 파일 범위 | 역할 |
|---|---|---|
| 순수 도메인 | `lib/admin/category.ts`, `lib/admin/category.test.ts` | 깊이 계산, cycle 검사, leaf 판정, filter/query 정규화, gate 상태 DTO |
| 서버 조회 | `lib/admin/category.server.ts`, `lib/admin/category.server.test.ts` | 트리·매핑·참조 수 조회와 권한 경계 |
| 관리자 mutation | `app/admin/category-actions.ts`, `app/admin/category-actions.test.ts` | 생성·이동·보관/복원·ERP 매핑·상품 적용·복구 가능한 입력 보존 |
| 관리자 UI | `components/admin/CategoryTree.tsx`, `components/admin/CategoryAssignmentField.tsx`, `components/admin/screens/CategoryScreen.tsx` | 트리 편집, 매핑 상태, 굿즈 기본 말단 선택, gate 안내 |
| 라우트 | `app/admin/(shell)/catalog/categories/page.tsx` 및 해당 테스트 | staff/admin 화면 진입과 server loader 연결 |
| DB | `supabase/migrations/<root-assigned-sales-category>.sql`, `supabase/tests/sales_category_hierarchy.sql` | 트리·매핑·상품 연결·gate·RLS·audit·경합 불변식 |

다음 공유 파일은 필요한 필드와 함수 인자를 먼저 root와 조율한 뒤에만 수정한다.

- `lib/admin/catalog.ts`, `lib/admin/catalog.server.ts`, `lib/data.ts`
- `lib/catalog.ts`, `lib/search-goods.ts`, `lib/shop-catalog.ts`
- `app/admin/actions.ts`, `components/admin/sections/GoodSection.tsx`
- `lib/admin/goods-workbook.ts` 및 workbook export/import 경계

공유 파일 통합은 `category_id` nullable read path와 기존 `type` fallback을 먼저 추가한 뒤, gate가 OFF인 현재 공개 소비자 결과가 byte/행 단위로 유지되는지 검증한다.

## 데이터 계약 초안

구현 시 실제 migration 이름과 컬럼명은 root가 배정한다. 아래는 설계상의 의미 계약이다.

- `catalog_categories`: 내부 ID, 안정적인 category code, 이름, parent ID, depth, sort order, archived/published 상태, created/updated 시각
- `catalog_category_erp_mappings`: category ID, ERP code, ERP name, source/version, effective window, verified actor/time, active 상태
- `goods.category_id`: nullable 기본 말단 category FK. 기존 주문 스냅샷과 `goods.type`은 보존한다.
- `category_activation_control`: customer category gate와 ERP mapping gate, 실제 검증 증거 요약. gate OFF에서도 기존 `type`/전체 목록은 유지하고 공개 category consumer만 닫는다.
- `goods_type_category_migrations`: 기존 8종별 제안/확정 category, 상태, 근거와 actor. 자동 확정하지 않는다.

실제 ERP 코드·품명과 고객 분류명은 이 문서에 채우지 않는다. 값이 제공되면 migration seed 또는 audited import로 넣고, 입력 행 수·중복·미매핑·4단계 초과를 별도 readback한다.

## 검증 범위

먼저 red SQL/단위 테스트를 추가한 뒤 구현한다.

- 깊이 4 허용, 5단계·cycle·자기참조·존재하지 않는 부모 거절
- 단일 부모와 leaf-only 상품 적용, 미분류 초안 저장, 보관/참조 guard
- ERP 매핑 1:1과 중복·미매핑·비활성 매핑 차단
- staff/admin 허용, 일반 사용자·anon 직접 mutation 차단
- stale tree version과 동시 이동/상품 연결의 business conflict
- gate OFF에서 기존 `goods.type` 목록·검색·IP 굿즈 목록·엑셀 결과 회귀 없음
- gate ON 전환 뒤 공개 category filter/search, 관리자 조회, ERP export의 동일한 category/ERP row
- category 이동·매핑·보관/복원·gate 전환 audit와 기존 주문/엑셀 이력 보존

브라우저 QA는 root가 실제 admin 트리 편집 → 굿즈 기본 말단 적용 → 공개 필터/검색 → workbook round-trip을 수행한다. 실제 분류표와 ERP 증거가 없는 동안은 활성화 화면을 차단 상태로만 검증한다.

## 범위 밖

복수 고객 카테고리, N:M ERP 매핑, `goods.type` 삭제/자동 이관, IP·버티컬을 고객 카테고리로 재사용, ERP 코드 추정, 카테고리 hard delete, 실제 ERP 동기화 API, 실제 값이 없는 상태의 공개 활성화는 포함하지 않는다.

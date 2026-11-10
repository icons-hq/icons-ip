# 반품·교환 연락처 정정과 최종 재배송지

2026-10-14 구현·로컬 통합 검증 중. [기능 계약](../research/smartstore-admin/claim-contact-correction-proposal.md)을 따르며 운영 활성화·키 등록·배포는 실행하지 않았다. 원주문·최초 대리접수·창고 반송지와 새 연락처 계획은 서로 다른 기록이다.

## 처리 순서

반품·교환 상세의 **회수·재배송 연락처**에서 원하는 대상을 확인한다. 받는 분, 전화번호, 상세주소와 우편번호·기본 주소를 수정할 수 있다. 위치 변경은 각 배송 건에 보존된 지역 요금과 대조하며, 요금 차이 또는 확인 불가 상태에서는 저장을 막는다. 기존 지역 근거가 없는 주문도 이름·전화·상세주소만 정정하는 기능은 유지한다. 고객 합의 근거와 실제 수거/발송 전이라는 확인이 필요하다. 회수 착수·입고·이미 재출고한 상태에서는 해당 변경이 차단된다. 연락처 수정은 운송사에 예약·변경 정보를 전송하지 않는다.

교환의 전체 회수가 끝나면 **최종 주소 확인 후 재출고 등록**에서 현재 재배송지와 전체 수량의 출고 상품·택배사·운송장을 확인한다. 최종 주소 snapshot과 재고 복원/차감, 재출고 기록, 요청 영수증은 같은 DB 트랜잭션으로 확정한다. 구 3·4인자 재출고 RPC는 신규 출고를 허용하지 않으며 이미 완료된 정확한 재조회만 유지한다. 과거 재출고에 새 주소 확인 기록을 소급해서 만들지 않는다.

저장 결과가 불명확하면 **저장 결과 확인**을 먼저 누른다. 같은 화면에 원래 입력이 남아 있으면 동일 요청을 재전송할 수 있다. 화면을 다시 열어 입력을 잃었으면 결과 확인 또는 **미처리 요청 종료**만 가능하다. 조회 결과가 없다는 이유만으로 새 요청을 만들지 않는다. 종료 요청은 먼저 진행 중인 같은 요청의 확정을 기다린 뒤 저장 영수증을 반환하거나, 아직 처리되지 않은 요청번호를 봉인한다.

주소와 합의 근거는 일반 초안·localStorage에 저장하지 않는다. sessionStorage에는 actor/session·주문·claim·작업 종류·기대 revision·operation UUID·시각만 남는다. 로그아웃/계정/세션 변경 때 제거하며, 연락처 닫기·탭 숨김·화면 이탈 때 원문 메모리를 해제한다. 주소 확인은 10분 후 만료된다. 만료된 원래 요청도 이미 저장된 경우에는 같은 HMAC으로 정확 재조회할 수 있다.

## 읽기와 개인정보 경계

운영자는 현재 `sales.manage` 권한으로 현재 주소와 변경 이력을 명시 조회한다. 일반 구매자는 자기 주문의 주소·변경 전후·시각을, 선물 수신자는 자기 수령 정보의 이력을 조회한다. 선물 발신자에게는 변경 일시·항목만 제공하며 수신자 주소를 공개하지 않는다. 고객에게 내부 합의 근거와 운영자 원식별자를 반환하지 않는다. 모든 경로는 같은 출처의 POST·`private, no-store`이며 GET/HEAD로 원문을 반환하지 않는다.

기존 주문/클레임 XLSX 열을 현재 회수지나 재배송지로 바꾸지 않는다. 새 연락처·합의 근거를 목록 파일·일반 감사·오류·알림·분석 사건에 추가하지 않는다. 운영자가 보는 최초 대리접수 증거와 출고 창고 반송 주소도 그대로 유지한다.

## 암호화와 환경 설정

필드별 AES-256-GCM을 서버에서 사용한다. 암호문 인증 범위에는 환경, 실제 Supabase origin, 주문/claim/대상, 기록 종류·ID·PII 버전, 필드명과 키 버전이 포함된다. 주소 HMAC, 요청 HMAC, context 서명 키는 암호화 키와 분리한다. 랜덤 IV 때문에 정확 재시도 여부를 암호문 바이트로 비교하지 않는다.

| 설정 | 의미 |
| --- | --- |
| `ICONS_CLAIM_CONTACT_ENABLED=1` | 새 원문 조회·정정·재출고용 서버 처리 활성화 |
| `ICONS_CLAIM_CONTACT_ENVIRONMENT` | `local`, `preview`, `production` 중 현재 환경 |
| `ICONS_CLAIM_CONTACT_KEYRING_JSON` | 서버 전용 키 묶음. `v:1`, `activeKeyVersion`, `environment`, `backendOrigin`, `keys`를 가진다. |
| `private.order_claim_contact_runtime.enabled` | DB의 새 원문 조회·쓰기 활성화. migration 기본값은 false다. |

키 버전별로 `encryptionKey`, `addressHmacKey`, `requestHmacKey`, `contextSigningKey` 네 개의 독립된 32바이트 base64url 키가 필요하다. 키 묶음의 `backendOrigin`은 `NEXT_PUBLIC_SUPABASE_URL`의 정규 origin과 정확히 같아야 한다. 환경 간 키를 복사하지 않고 실제 비밀값을 문서·로그·테스트 산출물에 남기지 않는다. 키 묶음은 최대 4개 버전을 받으며 활성 버전으로 새 암호문을 만든다.

신규 migration은 구 RPC의 신규 재출고를 닫는다. 따라서 앱·DB 버전과 새 키·서버/DB 활성화가 맞지 않으면 실제 교환 재출고도 중지된다. 운영 적용 전에 이 결합 조건을 검증하고 승인된 전환 창에서 함께 적용한다. 기능을 끄는 것은 구 신규 출고 경로를 다시 여는 조작이 아니다.

회전 시 기존 원문·HMAC·서명을 읽어야 하는 버전을 유지한다. 키만 제거하면 해당 원문과 같은 입력의 재시도를 확인할 수 없지만 operation 메타데이터 조회·미처리 봉인은 별도 키 없는 경로로 가능하다. 기능 비활성화도 이미 저장된 영수증이나 미처리 요청 봉인 경로를 막지 않는다. 과거 주소를 원주문에서 다시 채워 복호화 실패를 숨기지 않는다.

## 보존 예외와 실제 파기

세 개인정보 저장소는 `order_claim_contact_plans`, `order_claim_contact_operations`의 암호화 이력/합의/HMAC, `order_claim_reshipment_destinations`다. 실제 원배송·교환품 배송완료, 회수와 금전 의무, 등록된 분쟁 종료 증거를 읽어 목적 종료를 판정한다. 정상 목적 종료부터 30일을 기본 파기 시점으로 계산하며 `updated_at`을 기준으로 보존기간을 연장하지 않는다. 기한이 지나면 배치 파기 전에도 원문 조회·수정을 차단한다.

등록된 보존 예외가 없다는 사실은 외부 분쟁이 없거나 끝났다는 증거가 아니다. 예외는 opaque `caseRef`·`approvalRef`, 정규화한 법적 근거, 유한한 `retainUntil`과 실제 발생시각으로 기록한다. 여러 예외를 독립적으로 유지하며 살아 있는 예외 중 늦은 기한만 적용한다. 만료는 자동 종결이나 무기한 연장이 아니다. 실제 분쟁 종료를 확인한 `close`의 시각만 목적 종료 계산에 참여한다. 자유서술 주소·전화·상담 원문을 예외 참조값에 넣지 않는다.

`service_inventory_order_claim_contact_data`는 대상자별 목적·보존 상태와 저장소별 잔여량을 읽는다. `service_record_order_claim_contact_retention_case`는 예외 등록·연장·해제·종결을 CAS와 operation UUID로 기록한다. `service_purge_order_claim_contact_data`는 현재 시각 이하 cutoff와 한 번에 최대 100개 claim을 받아 기한이 지난 원문을 실제 제거하고, 선택 범위 잔여 PII 0건과 전체 남은 범위를 재조회한다. 세 경로는 현재 관리자 세션과 `platform.manage`의 관리자 전용 조건을 DB에서 다시 확인한다.

수동 유지보수 진입점은 같은 출처의 `POST /api/admin/claim-contact/retention`이다. [서버 모듈](../../lib/claim-contact/retention.server.ts)이 현재 로그인 사용자·세션을 유도하므로 요청 body에 actor/session을 넣지 않는다. 암호화 키와 기능 활성화 여부에 의존하지 않으며 원문을 반환하지 않는다.

| `operation` | `requestId` 외 필수 입력 | 결과 |
| --- | --- | --- |
| `inventory` | `subjectId`, `limit` 1~1,000, `afterClaimId` 또는 null | 목적/보존 상태·잔여 수량·다음 claim cursor |
| `case` | `orderId`, `claimId`, `operationId`, `expectedCaseRevision`, `case` | 승인 참조·정규 근거에 결속된 등록/연장/해제/종결 결과 |
| `purge` | `subjectId`, `operationId`, 현재 시각 이하 `cutoff`, `limit` 1~100, `confirmed: true` | 파기한 claim·대상 수와 선택 범위 잔여 0건·전체 남은 범위 |

`case`는 `action`, `caseRef`, `approvalRef`, `legalBasis`, `retainUntil`, `occurredAt`의 정확한 필드만 받는다. `action`은 `hold|extend|release|close`, `legalBasis`는 `dispute_resolution|statutory_preservation|verified_rights_request`다. 신규 hold/extend의 `retainUntil`은 유한한 미래 시각이고 release/close는 null이다. 원문 자유서술을 추가하지 않는다. 결과는 `{requestId, operation, data}`이며 actor/session·대상·입력 시각·버전이 일치하는지 서버가 다시 검증한다. case·purge 응답 유실 시 같은 operation UUID와 명령 본문을 유지해 재조회하고 새 번호로 반복하지 않는다. 이 API는 호출마다 명시한 한 범위만 처리하며 자동 페이지 순회·반복 파기를 실행하지 않는다.

파기 후 현재 계획에는 파기 표식을 남겨 원주문·최초 접수로 fallback하지 못하게 한다. 주소 암호문·내부 합의·주소/요청 HMAC을 제거하며 operation의 최소 결과 메타데이터는 재출고 중복 실행을 막기 위해 남긴다. 이미 봉인한 미처리 영수증은 원문을 저장한 적이 없으므로 `not_stored`다. 교환→반품 전환 전에 있던 재배송 계획도 파기 대상에 포함한다.

이 경로의 파기는 원주문 주소, 과거 주문 주소 변경 이력, 최초 대리접수 원본, Auth 사용자 삭제까지 완료했다는 뜻이 아니다. 기존 탈퇴 worker·권리행사 전체 반출도 활성화하지 않는다. 운영자 참조와 기존 사본은 [개인정보 보존정책](../account-deletion-retention-policy.md)의 통합 inventory에서 별도로 처리한다. 운영 cron과 무인 파기 worker는 이번 구현에서 등록하지 않았다.

## 검증

`supabase/tests/order_claim_contact.sql`은 권한·원본 보존·상태·CAS·멱등·gift 경계·보존/실제 파기를, `order_claim_contact_concurrency.py`는 실제 잠금 대기를 검증한다. 공통 결제·무통장 환급·그룹 재고 회귀는 `goods_transaction_isolated.sh`가 소유한 disposable DB에서 함께 실행한다. 실제 서버 암호화/HTTP 통합과 관리자·고객 PC/390px 화면 결과는 기능 계약의 최신 검증 기록을 따른다. 테스트 PASS를 운영 활성화 또는 실제 물류 인계 증거로 사용하지 않는다.

## 수거 정보 정정

**회수 방법·택배사·송장 → 회수 정보 확인 → 정정**에서 실제 안내한 방법과 송장, 개인정보를 제외한 정정 근거를 저장한다. 운송사 API를 호출하지 않으며 창고 입고 확인과 환불·재출고는 기존 절차로 처리한다. 수거 시작 이력이 있으면 미요청으로 되돌릴 수 없다. 구매자는 자신의 회수 안내를 조회하고, 선물 발신자에게는 수령인 회수 정보를 공개하지 않는다. [상세 검증](../research/smartstore-admin/claim-address-collection.md).

# 정기배송 검증 행렬

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14. 최신 격리 실행에서 아래 9개 필수 항목을 10개 경쟁 시나리오로 직접 검증해 모두 PASS했고 clone은 삭제됐다. 아래는 코드 검토, 로컬 합성 DB, 실제 두 연결의 잠금 대기, 브라우저, 실제 외부 결제를 서로 구분한 기록이다. [초기 설계](subscription-transaction-proposal.md)의 필수 경합 항목을 다른 도메인의 시험만으로 충족했다고 보지 않는다.

## 로컬 원장·경합

정본 실행은 [격리 wrapper](../../../supabase/tests/goods_subscriptions_isolated.sh)와 [실제 연결 경합](../../../supabase/tests/goods_subscriptions_concurrency.py)이다. 최신 실행은 전체 migration 327개가 설치된 로컬 CANON의 별도 clone DB에서 이루어졌으며 `finally/trap`으로 clone을 삭제했다. wrapper는 필수 schema를 확인하고 migration을 재적용하지 않는다. 원본 migration 이력 전체 행의 SHA-256 `7e3c699f131797a77066ca24b92e9fe2add20f2f6af7ab3e3690797781c65525`가 실행 전후 같았다. 실행 로그 (`output/subscriptions-local-proof-20261014/canonical327-complete-clone-sql.txt`)를 보존한다. 조회 시각만 앞당겨야 하는 미래 회차는 아직 발송하지 않은 합성 fixture 행을 같은 정체성으로 재삽입한다. 모델 시간을 흘려보내며 실제 한 달을 기다린 시험이 아니며, 기존 약관이나 발송된 회차를 바꾸거나 불변 trigger를 끄지 않는다.

| 설계의 필수 항목 | 이번 직접 검증과 독립 결과 | 증거 |
| --- | --- | --- |
| 같은 회차 worker 경쟁 | A가 claim 행 잠금을 보유하는 동안 B가 `SKIP LOCKED`로 작업 없음. lease 한 개만 남음 | `claim-first.log`, `claim-second.log` |
| 해지 대 dispatch | 해지 transaction이 먼저 actor 잠금을 보유. 실제 대기한 worker는 commit 뒤 stale fence로 거절. 주문 canceled, dispatch/attempt 없음 | `cancel-lock-probe.log`, `cancel-readback.log` |
| 동의·가격 변경 대 place/dispatch | 상품 가격 writer가 catalog 행 잠금 보유. 기다린 다음 회차 worker는 현재 가격을 읽어 `needs_confirmation`으로 중지. 새 주문/attempt 없음 | `price-change-dispatch-lock-probe.log`, `price-change-readback.log` |
| 카드 교체 대 dispatch | 검증된 새 카드로 변경 확정을 먼저 처리. 같은 actor 잠금에서 대기한 이전 회차 worker는 stale fence로 거절. 새 카드 참조만 현재 plan에 저장 | `card-replacement-dispatch-lock-probe.log`, `card-change-readback.log` |
| 계정 fence 대 finalizer | provider Fake 승인은 먼저 존재. 계정 fence가 actor 잠금 아래 먼저 commit하면 대기한 finalizer는 needs_review를 남기고 외부 승인 evidence 한 건을 보존. 주문 pending, 미래 plan paused | `account-fence-finalizer-lock-probe.log`, `account-fence-finalizer-readback.log` |
| 일반 카트 대 같은 재고/회원 구매 한도 | 동일 상품·회원의 카트 place와 다음 회차 worker를 동시에 처리. 재고 1/회원한도 1, 재고 5/회원한도 1의 두 경우를 각각 확인 | 아래 최종 결과 파일의 `cartSubscriptionRaces` |
| unknown 회수 대 늦은 이전 worker | provider 승인 후 DB finalize 전 프로세스 중단을 합성. 다른 psql 프로세스가 같은 provider 원장을 조회. 새 prepare가 actor 잠금을 보유하는 동안 이전 worker 완료를 실제로 대기시킨 뒤 기존 token을 거절하고 같은 주문 결제를 한 번만 확정 | `fake-new-process-inspect.log`, `reclaimed-lease-late-worker-b.log`, `recovered-readback.log` |
| 같은 operation 중복 | 두 실제 transaction이 같은 신청 확정을 호출하고 두 번째가 lock 대기. 원래 order/cycle receipt가 같고 결제/예약이 한 번만 생성됨 | `same-confirm-operation-a.log`, `same-confirm-operation-b.log` |
| 환급 대 webhook 재조회 | Fake의 전액 취소를 확인한 뒤 기존 취소 finalizer와 billing wrapper의 webhook형 reconciliation 완료가 경쟁. 환급/재고를 중복 복원하지 않고 금융 binding 보존 | 아래 최종 결과 파일의 `refundWebhookReadback` |

각 증거 파일은 동시 실행 결과 디렉터리 (`output/subscriptions-local-proof-20261014/concurrency/result.json`)에 모인다. 결과가 `PASS`인 최신 실행의 파일만 완료 근거로 사용한다. 네트워크를 사용하는 Toss SDK/API, 실제 메일 전송은 0회다.

[거래 SQL](../../../supabase/tests/goods_subscriptions_transactions.sql)은 첫 회차 11,000원(상품 10,000 − 쿠폰 1,000 − 적립금 1,000 + 선불 배송 3,000), 향후 기준 13,000원(C=R=0), 실제 카트 수량 5 유지, 재고 한 개 예약, 주문 한 개, 일시정지·재개·해지·카드 폐기·주소/키 정리 후 금융 binding 유지와 기존 finalizer 복구를 확인한다.

[조회·정리 SQL](../../../supabase/tests/goods_subscriptions_console.sql)은 고객 신청 105건을 50+50+5, 회차 66건을 50+16으로 중복·누락 없이 읽는다. 운영자 검색 조건 전체 105건 export, 다른 회원/일반회원의 권한 거절, 주소·결제 비밀 미포함, snapshot 위변조 거절, 암호문 SHA 감사, 24시간 지난 auth 암호문과 export payload 정리를 확인한다.

## 계정 정리의 동의 증거

[34238 보완](../../../supabase/migrations/20261020085355_goods_subscription_contract_retention.sql)은 초기 helper의 동의 증거 누락을 수정한다. 최신 clone 로그 (`output/subscriptions-local-proof-20261014/canonical327-complete-clone-sql.txt`)는 최초 confirm과 resume의 recordedAt/revision/terms 연결, 서로 다른 두 terms hash·주기, 최초 11,000원·향후 13,000원, 회차별 terms 참조를 검사한다. 추가한 별도 privacy fixture는 주소·직접 입력·카드·auth canary를 포함하지만 전체 보존 projection에서 해당 값과 필드가 빠지는 것을 확인한다. 원래 정상 거래 시험과 방어적 projection 시험을 구분한다.

기존 계정 삭제의 실제 legal snapshot 생성→서비스 cleanup→private terms 삭제 뒤 snapshot이 지속하는 통합 시험도 계정 삭제 담당의 독립 clone 로그 (`output/goods-transaction-design-20261014/final-six-ordered-clone-test.log`)에서 PASS했다. 실제 저장된 두 계약 snapshot이 원래 동의된 terms와 같고 cleanup 재호출 뒤에도 유지됨을 검사했다. projection 단독 결과와 실제 저장·삭제 통합 결과를 구분한다.

## 공통·선물 검증과의 관계

공통 Module의 [5개 경합 코드](../../../supabase/tests/goods_transaction_concurrency.py)는 runtime OFF 대 quote, quote 대 cart 수정, catalog 대기 중 견적 만료, 동일 key place 두 번, 운영 정지와 cart/quote의 세 연결을 소유한다. 공통 증거 manifest (`output/goods-transaction-design-20261014/operations-proof-manifest.json`)의 실행 결과와 별개로, 위 표의 카트↔정기배송은 이번에 직접 실행한다. 정기배송도 `private.lock_goods_transaction_source`, `private.quote_goods_transaction`, `private.place_goods_transaction`을 그대로 호출하며 재고/가격 계산을 복제하지 않는다.

[선물 경합 코드](../../../supabase/tests/gift_order_concurrency.py)는 수신자 경쟁·만료·정지/fence 양방향·주소/닫기 대 place·quote 대 주소·catalog/order/origin 잠금을 검증한다. 해당 결과를 구독 카드 교체·빌링 finalizer·환급 또는 카트 재고 경쟁을 수행한 근거로 인용하지 않는다. 기존 금융 shell 스크립트도 이번 실행 로그가 없다면 이번 PASS 목록에 포함하지 않는다.

## 프론트엔드·서버 경계와 남은 환경 검증

Vitest 결과 (`output/subscriptions-local-proof-20261014/subscription-vitest.txt`)는 24 suites / 243 tests PASS다. 암호화 AAD·nonce·owner/profile mismatch, 고정 write version, old-MID 조회, Toss 증거 불일치, durable Fake Interface, 월말/KST, 의도치 않은 재청구 방지, 계정/session 변경 뒤 늦은 응답 차단, 불명확 요청의 같은 closure 재시도, DB 저장 후 readback 실패 잠금, sales 권한 재확인, 암호화 실패/감사 실패 시 파일 미응답과 평문 버퍼 삭제, 메일 훅 실패 시 결제 유지 등을 포함한다. 테스트에서 PG fetch와 메일 훅은 mock 또는 로컬 Fake다.

실제 브라우저 증거 (`output/subscriptions-local-proof-20261014/ui-final-proof.json`)는 로컬 전용 4334 런타임과 승인된 OWN259→261에서 실행했다. 고객 신청·Fake 카드 등록 2회·첫 쿠폰/적립금·결제 응답 유실 후 같은 요청 재확인과 새로고침·일시정지/재개·주기/가격 재동의/배송지/결제카드 변경·해지·두 카드 폐기를 완료했다. 20,000원에서 복수구매 2,000원·쿠폰 1,000원·적립금 1,000원을 뺀 첫 온라인 금액 16,000원과 향후 18,000원, 별도 착불 3,000원을 화면과 DB에서 대조했다. 응답 유실 뒤에도 주문·결제·최초 확정 operation은 각각 한 건이며 독립 카트 수량 5는 그대로였다.

관리자 검색·7회차 조회·정기배송 정책 저장/재열기와 암호화 XLSX 실제 다운로드·복호화 (`output/subscriptions-local-proof-20261014/ui-export-readback.json`)를 확인했다. 파일 1행이 화면과 일치하고 주소·연락처·결제 비밀은 없으며 파일 SHA-256이 감사 원장과 같았다. 카드 폐기 후에도 기존 금융 binding으로 전액 Fake 환급 16,000원을 확인해 주문 canceled, payment refunded, refund done, 재고 20, 착불 void로 마쳤다. PC 1440px와 모바일 390px를 직접 확인했고, 전환 애니메이션 종료 후 관리자 sidebar 56px·document scrollWidth 380px였다.

UI 중 발견된 기존 주문 취소의 localhost 정규화 오류는 공통 Host/origin 검사와 4 suites / 64 tests로 수정했다. PostgREST의 읽기 전용 거래에서 행 잠금이 거절된 배송 조회는 승인된 42553 보완으로 HTTP 200을 확인한 뒤 재개했다. 초기 의도적 응답 중단과 외부 폰트 차단에 따른 오류를 최종 앱 오류와 구분하며, 마지막 정상 흐름의 pageerror는 0개다. 외부 정적 폰트는 사용했고 실제 PG·메일 호출은 0회다.

정상 퇴역 증거 (`output/subscriptions-local-proof-20261014/ui-retirement-result.json`)는 금융/감사/기존 migration 보존, 임시 common·subscription·credit policy 원복과 store/gift 불변, 상품/IP 비공개·출고지/Fake 프로필 비활성, 합성 계정 2개의 권한·세션 회수·로그인 차단을 확인한다. 자기 런타임·브라우저 탭과 복사한 자격 증명 파일도 정리했다. 실제 Toss 계약·키·API·메일·클라우드 배포/cron·호스팅 로그 마스킹은 아직 실행하지 않은 별도 검증이다.

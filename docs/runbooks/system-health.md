# 시스템 상태 확인과 미종결 결제 처리

자동 작업(Vercel cron·pg_cron)의 실패·멈춤, 미종결 결제 시도, 메일 발송 실패를 운영 화면에서 확인하고 처리하는 절차다(원장 OPS-039·OPS-040·PAY-067·PAY-063·CUS-066).
구현: `supabase/migrations/20261118162000_system_health_alerts.sql`, `lib/system-health/`, `app/admin/(shell)/settings/system`, `app/api/cron/payment-reconciliation`.

## 어디서 보나

| 표면 | 권한 | 무엇 |
|---|---|---|
| 판매자 정보 → 시스템 상태(`/admin/settings/system`) | `platform.manage`(통합·주매니저) | 자동 작업 표(실패 중·멈춤·기록 없음·정상·꺼짐), 최근 24시간 실패 50건, 미종결 결제 건수, 메일 발송 실패·반송(24시간) |
| 같은 화면의 미종결 결제 목록·'결제 상태 다시 확인' | `sales.manage` | 주문번호·결제사·금액·사유·경과·마지막 확인, 건별 재확인 |
| 운영 알림 '시스템' 분류 | `platform.manage` | 앱 자동 작업 실패, 결제 기한 만료 정리의 건너뛴 주문. 같은 작업은 한 시간에 하나. 요약 메일에는 출고 보류·발송 지연도 같은 분류로 든다(아래 '외부 알림') |
| 할 일 '시스템 점검' | `platform.manage` | 지금 문제가 있는 작업 수 + 미종결 결제 수 + 메일 발송 실패(24시간) 수. 반송은 받는 주소 문제라 세지 않는다 |
| Vercel 로그 | 개발팀 | `[cron] job failed`(실패마다), `[system-alert]`(작업별 그 시간 첫 실패), `[cron] run record failed`(기록 실패) |

판정 기준:

- **실패 중**: 앱 작업은 마지막 실행이 5xx·예외로 끝났다. DB 작업은 마지막 실행이 `failed`이거나, 실행 안에서 건너뛴 행이 주기의 두 배 + 10분 안에 있었다.
- **멈춤**: 주기의 두 배 + 10분 동안 기록이 없다(앱 작업 — cron이 불리지 않거나 함수가 시간 초과로 끝나 기록하지 못함) 또는 성공이 없다(DB 작업). DB 작업은 `cron.job_run_details` 최근 20,000회(약 2.8일)만 보므로, 표본이 그보다 짧은 동안(매일 작업의 2일 10분 기준 등)은 멈춤을 판정하지 않는다. `cron.job`에는 등록 시각이 없어 처음 본 시각을 `private.system_pg_cron_jobs`에 남기고(10분 주기 정리 잡 `system-job-records-maintenance`), 처음 본 지 멈춤 기준이 지나지 않은 잡은 멈춤으로 보지 않는다.
- **기록 없음**: 이 배포에서 한 번도 돈 적이 없는 앱 작업, 또는 표본 안에 실행이 없는 DB 작업(막 등록한 잡 포함). 로컬·미리보기에서는 Vercel cron이 돌지 않아 앱 작업이 전부 이렇게 보인다. 운영에서 배포 하루 뒤에도 기록 없음이면 `vercel.json` 등록·`CRON_SECRET`(401은 기록하지 않는다)을 확인한다. 기록 없음은 할 일 건수에 세지 않는다.
- 미종결 결제: `payment_attempts.state`가 `unknown`·`needs_review`이거나, 리스(`claim_expires_at`)가 지난 `confirming`.

## 자동 작업이 실패 중·멈춤일 때

1. 화면의 작업 이름·오류 코드·시각을 개발팀에 전달한다. 오류 원문·개인정보는 기록하지 않으므로 상세는 로그에서 본다.
   - 앱 작업: Vercel 로그에서 `[cron] job failed`와 같은 시각의 라우트 로그. 오류 코드 `db:<SQLSTATE>`는 DB 오류, `exception:<이름>`은 앱 예외, `unhealthy_result`는 응답이 503(일부 건 실패 — 상세 숫자는 실패 기록 `detail`), 그 밖의 snake_case(예: `subscription_work_unavailable`)는 라우트가 던진 코드다.
   - DB 작업: SQL 편집기(읽기)에서
     `select runid, status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = '<잡 이름>') order by runid desc limit 20;`
2. 원인을 고친 뒤 앱 작업은 Vercel 대시보드의 cron 수동 실행(Run)으로, DB 작업은 다음 회차로 회복을 확인한다. 화면에서 '정상'으로 바뀌면 끝이다(운영 알림은 읽음 처리).
3. **결제 기한 만료 정리(`expire-stale-checkouts`)의 '일부 건 건너뜀'**: 한 주문의 오류는 그 주문만 건너뛰고 나머지는 정리한다(예전에는 매분 sweep 전체가 되돌아가 다른 주문의 재고·쿠폰까지 묶였다). 건너뛴 주문 id는 실패 기록에만 있다 —
   `select occurred_at, error_code, detail from private.system_job_failures where job_key = 'expire-stale-checkouts' order by occurred_at desc limit 10;`
   `detail.targets`의 주문을 주문 상세에서 확인하고 오류 코드(`sqlstate_*`)와 함께 개발팀에 전달한다. 고치기 전까지 그 주문은 매분 다시 시도되고 실패 기록이 쌓인다(30일 보존).

## 미종결 결제 처리

미종결 결제는 닫힐 때까지 재고·쿠폰·적립금을 잡고 있다.

- **자동 재확인**: `/api/cron/payment-reconciliation`이 10분마다 결과 불명(`unknown`)·멈춘 확인(리스가 지난 `confirming`)을 최대 3건 골라 결제사 조회 API로 다시 확인한다. 고르는 규칙은 DB(`service_claim_payment_reconciliation_candidates`): 조회 API가 있는 시도(굿즈 토스·나이스페이, 티켓 토스) 중 이 배포에 결제사 설정이 있는 것(앱이 설정된 게이트웨이 목록을 넘긴다), 마지막 변경 뒤 10분, 만든 지 7일 안, 30분 안에 누구도(웹훅·운영자·cron) 확인하거나 이 cron이 뽑지 않은 것을 마지막 확인이 오래된 순(한 번도 확인하지 않은 것이 먼저)으로. 뽑는 순간 표식(`private.payment_reconciliation_auto_checks`)을 남기므로 결제사 조회 전에 끝난 후보(설정 없음·claim 전 실패)도 30분 동안 다시 뽑히지 않아, 조회할 수 없는 시도가 큐 앞자리를 막지 않는다. 그래서 같은 시도의 조회는 30분에 한 번, 회차당 3건이다. 설정된 결제사가 하나도 없는 배포는 DB도 부르지 않는다. `needs_review`는 고르지 않는다(사람 몫). 확정은 기존 재정합 seam(claim 리스 10분·DB 멱등 finalizer)이 해서 웹훅·운영자와 겹쳐도 안전하다. 굿즈 승인으로 닫히면 그 사이 자동 승인된 취소의 결제사 전액 취소를 응답 뒤에 발행한다(내부 재정합 라우트와 같은 규칙).
- **운영자 재확인**: 시스템 상태 → 미종결 결제의 '결제 상태 다시 확인'(`sales.manage`). DB가 감사 기록(`audit_log.action = 'admin.payment_attempt.reconcile_requested'`, `diff.caseRef`)을 남긴 뒤 서버 액션이 같은 seam을 서버 안에서 부른다(내부 HTTP·비밀값 없음). 재정합 감사(`private.goods_payment_reconciliation_audits` 등)에 같은 `caseRef`(`admin-<요청번호>`)가 남아 두 기록이 이어진다. 같은 시도는 1분에 한 번만 새로 확인한다.

결과별 다음 행동:

| 결과 | 뜻 | 다음 |
|---|---|---|
| 승인 확인 | 결제사 승인 → 결제 확정, 주문 확인 메일 | 없음(주문이 신규주문으로 들어온다) |
| 승인되지 않음·취소 | 결제 없이 닫힘, 재고·쿠폰 해제 | 없음 |
| 결과 불명 | 결제사 응답 없음 | 잠시 뒤 다시(자동 재확인도 이어진다). 하루 넘게 이어지면 결제사 관리자 화면에서 주문번호로 거래를 찾는다 |
| 결제사·주문 불일치 | 금액·주문 식별자 불일치 등 | 결제사 관리자 화면에서 거래를 확인하고 개발팀에 전달. 결제사에 승인 거래가 있는데 주문이 결제되지 않았으면 결제사에서 그 거래를 전액 취소하고 다시 확인한다 |
| 다른 처리가 확인 중 | 다른 claim 리스(10분)가 살아 있음 | 10분 뒤 새로고침 |

조회 API가 없는 시도:

- 코페이(`korpay`): '결제사 조회 불가 · 수동 처리' — 수동 복구 seam(`claim_goods_manual_payment_recovery`·`finalize_goods_manual_payment_recovery`, `docs/runbooks/korpay-production-rollout.md`)으로 닫는다.
- 무통장입금: 주문관리 → 미결제 확인(`/admin/sales/unpaid`).

내부 재정합 라우트(`/api/internal/payments/{goods,tickets}/reconcile`, Bearer `PAYMENT_RECONCILIATION_SECRET`)는 그대로 쓸 수 있다 — 화면에 접근할 수 없는 상황(예: 운영 DB 장애 복구 직후 스크립트 일괄 처리)에만 쓴다.

## 메일 발송 실패·반송

화면의 '메일 발송 실패(24시간)'는 `public.email_deliveries`(주문 확인·배송 안내 등)의 `failed`와 발송 의도(`private.email_intents`, 지연 안내·안전재고 요약·초대 등)의 `failed`·`unknown`·`needs_review`, '반송'은 발송 의도의 `bounced`·`complained`·`suppressed`다(Resend 웹훅 `/api/webhooks/resend`가 기록). 실패가 이어지면 Resend 키·발신 도메인·`RESEND_WEBHOOK_SECRET`을 확인하고, 건별 결과는 혜택/마케팅 → 메일 발송 이력(`/admin/messaging/emails`)에서 본다.

## 외부 알림: 운영 알림 요약 메일

시스템 장애는 운영 알림 메일로 나간다(설정 화면: 시스템 상태 → 운영 알림 메일, `platform.manage`). 원장 `private.admin_operation_alerts`의 `category='system'` 행에는 원래 앱 cron의 실행 중 실패(`record_system_job_failure`)만 올라왔고, Vercel cron 미호출·시간 초과·401, pg_cron 실패·멈춤, 메일 발송 실패, 미종결 결제는 이 화면의 판정(`system_health_report`)에만 있었다. 그래서 `private.prepare_ops_alert_digest`가 요약을 만들 때(같은 잠금 안) `private.raise_system_health_alerts`로 판정의 실패 중·멈춘 작업, 메일 발송 실패 건수, 미종결 결제 건수를 시간 단위 event_key(`system_job:<작업>:<시각>`·`system_job_stalled:…`·`system_unresolved_payments:<시각>`, 메일 발송 실패는 `system_email_failures:<가장 늦은 실패 시각>`)로 '시스템' 알림 행에 올린 뒤 요약에 담는다(운영 알림 벨에도 보인다). 멈춘·실패한 작업과 미종결 결제는 문제가 이어지는 동안 한 시간에 한 번씩 다시 알린다(돈·정지 상태라 반복이 맞다). 메일 발송 실패는 새 실패가 생겼을 때만 올린다(같은 실패가 24시간 창 동안 매시간 다시 올라오지 않는다). 5분마다 도는 `/api/cron/ops-alert-digest`가 한 통의 요약 메일로 보낸다(10분에 한 통까지). 구현은 `supabase/migrations/20261119107000_ops_alert_digest.sql`, `lib/email/ops-alert-digest*.ts`다.

**출고 보류·발송 지연(2026-11-25, 원장 SHP-107·SHP-135).** 같은 '시스템' 범주에 두 가지가 더 올라간다(`20261125235900_ops_alert_digest_fulfillment.sql`의 `private.raise_fulfillment_digest_alerts`, `prepare_ops_alert_digest`가 `raise_system_health_alerts` 바로 뒤에 부른다). ① 해제되지 않은 출고 보류(`private.order_fulfillment_holds.released_at is null`, 취소된 주문 제외): 이미 창고로 넘어간 출고지시는 시스템이 붙잡지 못하므로 창고 전달 뒤에 걸린 보류(결제사 취소·입금 되돌림·에스크로 취소 요청)는 **사람이 창고에 연락해 출고를 멈춰야 한다.** event_key는 `system_fulfillment_holds:<가장 늦게 생긴 보류 시각>`이라 새 보류가 생길 때만 새 알림이 오르고 제목에 그 시점의 전체 건수가 든다. ② 발송 지연: 관리자 첫 화면 '처리할 업무'·발주·발송 '발송 지연' 탭과 같은 기준(발주확인된 주문의 발송 전 배송 건 중, 처음 약속한 출고 예정일이 있으면 그 날짜가 오늘(KST)보다 앞선 건, 없으면 발주확인 뒤 3일 지난 건). event_key는 `system_shipment_delays:<가장 늦게 늦어진 시각>`이라 새로 늦어진 건이 있을 때만 새 알림이 오른다(건수는 그 시점의 전체). 두 알림 모두 제목에 건수만 있고 주문번호·고객 정보는 없다. '시스템' 범주를 끈 설정에서는 올리지 않고, 켠 시각 이전·6시간 넘은 알림을 세지 않는 규칙은 그대로라서 켠 직후 한 번은 이미 쌓인 보류·지연이 알림 한 건씩으로 나간다.

`lib/system-health/alert-sink.server.ts`의 `notifySystemIncident`는 로그 한 줄만 남기고 **메일을 직접 보내지 않는다.** 서버리스 함수는 응답 뒤 끊겨 즉시 발송이 사라질 수 있고, DB 알림 행과 중복 메일이 나기 때문이다. 메일 말고 다른 채널(메신저 등)을 붙일 때만 이 함수를 바꾼다. 켜는 절차·확인·장애 대응은 [inquiry-realtime.md의 운영 알림 요약 메일](./inquiry-realtime.md)을 따른다.

## 새 pg_cron 잡을 더할 때

migration이 `cron.schedule`로 잡을 더하면 정리 잡이 10분 안에 처음 본 시각을 남긴다. 그 전까지와 처음 본 뒤 멈춤 기준(주기 × 2 + 10분)이 지나기 전까지는 실행 기록이 없어도 '기록 없음'이고 할 일 건수에 들지 않는다 — 매일 도는 새 잡이 첫 실행 전에 '멈춤'으로 뜨지 않는다. 기준이 지나도 성공이 없으면 그때 멈춤이다. 운영자용 이름은 `lib/system-health/cron-jobs.ts`의 `PG_CRON_JOB_LABELS`에 더한다(없으면 잡 이름 그대로 보인다).

## 새 cron 라우트를 더할 때

`vercel.json`의 `crons`, `lib/system-health/cron-jobs.ts`의 `CRON_JOBS`(이름·주기), 라우트의 `startCronRun('<작업>')`·`run.finish(...)`·`run.fail(error, ...)`를 함께 더한다. `lib/system-health/cron-jobs.test.ts`가 셋의 일치, 인증(401) 뒤 기록 시작, 기록 없는 `catch {}`가 없음을 강제한다.

## 보존

pg_cron `system-job-records-maintenance`(10분마다)가 실패 기록 30일, 30일 동안 실행이 없던 앱 작업 상태 행, 미종결이 아니게 된 시도의 자동 재확인 표식을 지우고, 없어진 pg_cron 잡의 처음 본 기록을 지운다. `cron.job_run_details` 자체의 정리는 이 작업 범위가 아니다.

## 배포 뒤 스모크(OPS-060)

`pipeline.yml`의 별도 job `smoke-production`(`needs: deploy-vercel`, 결과가 success일 때만 실행)이 `scripts/post-deploy-smoke.mjs`로 운영 주소(`lib/site-domains.mjs`의 `CANONICAL_SITE_ORIGIN`, 도메인 전환 3단계에서 정규 주소가 바뀌면 같이 따라간다)의 홈·`/shop`·`/login`·`/api/health`를 익명으로 부른다. 경로마다 10초 간격 5회까지 재시도하고, 상태 200 외에 앱 셸(`<html lang>`)과 soft 404·오류 표지가 없는지 본문까지 확인한다(Next 16은 `notFound()`도 200). 정상 페이지도 RSC 페이로드(`<script>`)에 404 화면 문구를 싣기 때문에 문구 표지는 `<script>`를 걷어낸 본문에서만 찾는다(실제 운영 HTML 표본이 `scripts/fixtures/post-deploy-smoke/`에 고정돼 있다). `/api/health`는 비밀 없이 `{ ok, database, commit, deploymentId }`만 돌려주고 DB 공개 읽기(`get_storefront_settings`) 하나가 닿는지로 503을 낸다.

- **배포 id 비교**: deploy-vercel이 `vercel deploy`가 출력한 배포 URL을 job output으로 넘기면 스모크가 Vercel API(`GET /v13/deployments/{host}`, `VERCEL_TOKEN`·`VERCEL_ORG_ID`)로 배포 id(`dpl_…`)를 찾아 `/api/health`의 `deploymentId`(런타임 시스템 변수 `VERCEL_DEPLOYMENT_ID`)와 맞춘다. 롤백 등으로 방금 올린 배포가 도메인에 붙지 않았는데 이전 배포가 200을 주는 경우를 잡는다. URL·토큰이 없거나 조회가 안 되면 경고(`Deployment id check skipped`)만 남기고 비교를 건너뛴다(조회 API 형식은 Vercel 문서 기준이며 첫 운영 배포에서 경고가 나오는지 확인한다).
- **실패의 영향**: 스모크가 별도 job이라 실패해도 로그인 복구 템플릿 활성화·shared preview 동기화·staging 배포·PR preview 가드는 그대로 진행되고, 이 job만 빨갛게 되어 GitHub 실패 알림이 간다. 배포는 이미 올라간 뒤라 자동 롤백은 하지 않는다 — 운영 화면을 직접 확인하고 필요하면 Vercel에서 이전 배포로 되돌린다. run 전체 결론은 failure가 되지만 `production_redeploy`의 원본 run 검사는 smoke job 하나만 실패한 run을 허용한다(deploy-supabase·deploy-vercel 성공, 다른 job 실패 없음).
- **옛 run 재실행 주의**: main이 앞서 나간 뒤 옛 run의 스모크를 `rerun --failed` 하면 그 run이 올린 배포 id와 지금 도메인에 붙은 배포가 달라 다시 실패한다(정상). 최신 run에서만 다시 돌린다.
- **다시 돌리기**: 일시 실패면 해당 run에서 `gh run rerun <run-id> --failed`로 이 job만 다시 돌린다(배포·DB는 다시 실행하지 않는다).
- staging 배포에는 붙이지 않았다(별칭이 보호 모드일 수 있고 운영 판단 근거가 아니다). `SMOKE_ORIGIN` 환경 변수로 다른 주소에 같은 스크립트를 돌릴 수는 있다.
- 외부 가동 감시(UptimeRobot 등)가 필요하면 `/api/health`를 그대로 지정한다(사람 단계). 운영 알림 메일 cron이 멈추면 그 사실은 메일로 알릴 수 없으므로 이 외부 감시가 유일한 안전망이다.

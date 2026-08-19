# 열린 13개 이슈 종료 증거 계획

> **삭제원장 backend 정정:** 아래 GCP append service 서술은 2026-08-12 검토 시점 기록이다. 현행 방향은 운영 Supabase와 backup 계보가 분리된 **별도 Supabase compliance 프로젝트**다([`account-deletion-retention-policy.md`](../../account-deletion-retention-policy.md) · [#215](https://github.com/icons-hq/icons-ip/issues/215)).

> 상태: 내부 결정 반영본 · GitHub 미게시 · 작성 2026-08-11 · 결정 2026-08-12
>
> 기준: `icons-hq/icons-ip` open issue 13개, local/main `e54dd9e37944`
>
> 목적: 체크박스나 PR merge만으로 완료를 단정하지 않고, 각 이슈가 실제로 닫힐 수 있는 증거를 고정한다.

## 공통 종료 원칙

1. 사람 결정 이슈는 결정자·결정일·근거와 후속 owner가 default branch 문서 또는 GitHub에 기록돼야 한다.
2. 구현 이슈는 승인된 공개 계약의 실패 테스트→구현→회귀 테스트, schema/RPC 검증, review 가능한 PR과 CI가 필요하다.
3. Production·외부 처리자 이슈는 코드/CI만으로 닫지 않는다. 마스킹된 설정 sync, controlled canary, rollback과 운영 owner가 필요하다.
4. epic은 하위 이슈가 닫혔다는 이유만으로 닫지 않는다. 사용자·운영 end-to-end 결과와 canonical 문서 정합성을 확인한다.
5. post-launch/V2로 미룬 범위는 해결된 것이 아니다. 계속 open으로 두거나, 제품이 범위를 명시적으로 폐기하고 관련 PRD·ADR을 supersede한 경우에만 close한다.
6. GitHub 본문·label·Project 변경은 승인된 문서가 default branch에 merge된 뒤 현재 상태를 재검증하고 수행한다.
7. 2026-08-11 현재 live #137·#168·#188·#191 본문은 이 문서의 fence·제한 canary·versioned consent·권리 기준보다 약하다. 승인된 문서 merge 뒤 [`open-issue-body-sync-draft.md`](./2026-08-11-open-issue-body-sync-draft.md)를 live 본문에 적용하고 read-back하기 전에는 기존 체크박스만으로 이 네 이슈를 close하지 않는다.

## 이슈별 종료 증거

| 이슈 | 종료에 필요한 authoritative evidence | 현재 판정 |
|---|---|---|
| [#66](https://github.com/icons-hq/icons-ip/issues/66) Expo WebView | ADR-0008, PRD·ADR-0002·README·online-popup 문서를 current web-only scope로 정합화하고 closure comment에 유지 범위·재진입 조건 기록 | 범위 제거 결정 완료 · default branch merge 뒤 `not planned` close |
| [#87](https://github.com/icons-hq/icons-ip/issues/87) 실제 판매 계약 | 사업자 정보 6종·A/S·권리행사 연락처, 통신판매업·Toss live 상점 확인, Production 4-key 원자 전환, `PAYMENT_STATUS_CHANGED` 등록, fresh GET 검증, Log Drain redaction, 승인된 controlled 실결제의 webhook 1회 확정·환불/rollback 증거 | 사람·Production 승인 대기 |
| [#102](https://github.com/icons-hq/icons-ip/issues/102) 탈퇴·보존 정책 | 답변된 확인서, 공식 근거 연구, 내부 위험결정 승인 상태의 정책, 시행 전 fail-closed gate와 #137 handoff를 default branch에 반영. 구현 완료를 정책 이슈의 선행조건으로 만들지 않음 | 내부 결정 완료 · merge 뒤 close 가능 |
| [#110](https://github.com/icons-hq/icons-ip/issues/110) 커뮤니티 정책 | 답변된 법률위험·운영 확인서, 자연인 수령인·backup·도구 미비 시 신규 write OFF, 후속 구현 범위를 default branch에 반영 | 내부 결정 완료 · merge 뒤 close 가능; 공개 시행은 별도 |
| [#115](https://github.com/icons-hq/icons-ip/issues/115) online-popup epic | ADR-0008, PRD·ADR·readiness·online-popup historical 배너를 정합화하고 closure comment에 유지 범위·재진입 조건 기록 | 범위 제거 결정 완료 · default branch merge 뒤 `not planned` close |
| [#134](https://github.com/icons-hq/icons-ip/issues/134) recovery 계약 | recovery 전용 queryless callback, signed purpose state와 PKCE-local recovery marker defense-in-depth, allowlist 오류·세션/cookie 정리 계약과 TDD 구현 완료. marker를 provider assertion으로 오인하지 않으며 cross-browser는 `browser_mismatch`로 fail closed. Redirect/template/TTL의 Preview·Production read-back과 same-browser·cross-browser·만료·중복·unsafe-next·Production controlled recovery 증거를 이슈에 남기고, 3,600초+안전 여유 뒤 legacy branch를 제거 | 로컬 구현·전체 테스트 완료 · 원격 설정/smoke/legacy 제거 대기 |
| [#137](https://github.com/icons-hq/icons-ip/issues/137) 탈퇴 구현 | 1단계 self-only preview/request와 Auth 삭제 후에도 URL 비밀값 없이 동작하는 만료형 opaque status cookie·private ledger·fence, purging 진입 시 session revoke와 응답 기반 cookie cleanup, #191의 fence epoch·in-flight drain seam, 2단계 Storage/DB/Auth cleanup·외부 cutoff·restore replay. 2026-08-12 내부 검토의 GCP append service/read-only verifier, 별도 인프라 issue, snapshot catalog·hold·append/scan·key/TTL/restore drill, 동의 receipt·연령 review·assurance subject/reviewer/provenance/transaction-ref purge와 잔여 0건, nullable 작성자 feed·preview·block/filter/reaction 회귀, nullable `report_subjects`·report trigger·admin moderation query/type/UI에서 삭제 작성물의 신고·숨김·감사는 유지하되 계정 제재는 만들지 않는 증거, ACL, FK 밖 식별자, fault injection, controlled deletion canary를 통과하고 외부 `purge_completed` ack 전 완료가 불가능함을 증명 | 내부 계약·ADR 완료 · 실제 인프라 issue·backend·#188/#191 구현 대기 |
| [#168](https://github.com/icons-hq/icons-ip/issues/168) 첫 실판매 epic | #87·#177·#190·#179·#191 증거, 고시정보/상세와 WMS 재고 대조, 비승인 사용자의 UI·`place_order`를 모두 막는 server-side canary allowlist, 그 경계 안의 live 주문→webhook→출고→운송장→배송/환불, 종료 직후 public `stock='soldout'` read-back·WMS reconciliation. 별도 public-sale 승인 전에는 `stock='ok'`·양수 재고만으로 일반 구매가 열리지 않음을 증명 | 운영 critical path·제한 canary gate 대기 |
| [#177](https://github.com/icons-hq/icons-ip/issues/177) 물류 사양 | WMS/택배 계약, 출고·운송장 입출력, 반품 주소·처리, 도서산간, 운영사 법인명과 개인정보 위탁 H1~H7의 실제 담당자 답변·운영 runbook 반영 | 물류 담당자 답변 대기 |
| [#179](https://github.com/icons-hq/icons-ip/issues/179) 할당 재고 | WMS에서 ICONS 물량 격리, g13~g15 실제 수량·동기화 주체·불일치 중단 절차 승인, Production `stock_qty`를 실제 값으로 입력하되 public `stock='soldout'` 유지, admin·DB·WMS 3자 대조. `stock='ok'` 전환과 oversell live 증거는 #168의 제한 canary/public-sale 승인 경계에서 수행 | #177·#190 및 운영 입력 대기 |
| [#188](https://github.com/icons-hq/icons-ip/issues/188) 만 14세 gate | 승인된 5상태·권리 matrix; KST/2월29일 classifier; immutable consent receipt; 자가신고와 분리된 provider-neutral `verified_14_plus` 원장·server callback·raw DOB/CI 미저장·보호 액션 fail-closed; purpose onboarding·age-out RPC; 신규 `underage_rejected`의 #137 durable 삭제; 기존 제한 계정 재동의+연령확인; legacy 비승격; backfill dry-run·staff/admin abort gate; 법정 문서와 전체 회귀 테스트 | 내부 제품·위험결정 완료 · provider 사실·구현 대기 |
| [#190](https://github.com/icons-hq/icons-ip/issues/190) 홍실 데이터 | g13~g15의 고시정보 7항목, 설명·갤러리·상세 이미지, A/S 연락처를 승인된 실제 값으로 Production 입력. 공개 화면 렌더와 admin 재조회, 라이선스·접근성·모바일 검수 증거 | #87 및 콘텐츠 owner 입력 대기 |
| [#191](https://github.com/icons-hq/icons-ip/issues/191) 이메일 Production | DPA·국외이전·data/event/suppression/backup TTL, Send Email Hook·공통 fence epoch, provider 호출 전 승인된 외부 backend의 `email_outbound_intent` durable ack, provider 전송 결과의 `accepted|failed` ack와 검증 webhook의 `(provider,outbound_id,provider_event_id)`별 append·역순 reducer 뒤 DB mirror 갱신, fence 뒤 신규 claim 0·pre-fence lease drain, 외부 purge locator, raw 오류/log redaction. Hook route·서명/health를 먼저 배포하고 별도 단계에서 활성화·read-back하며 controlled Auth-mail canary에서 direct SMTP 0건을 증명. 외부 backend issue를 분리해도 그 ack가 실제 연결되기 전에는 Production 발송·#191 종료 불가 | 법무·처리자·외부 인프라·Production 승인 및 구현 대기 |

## 비순환 실행·종료 순서

1. #87 연락처·법률 판단, #102/#110 공동 정책, #188 제품·법무 계약, #191 처리자 계약을 확정한다.
2. #134를 열린 채 승인된 TDD 구현과 설정 rollout·Production controlled recovery까지 완료한 뒤 닫는다. decision-only 범위로 명시 변경한 경우에만 실제 연결된 별도 구현 issue로 넘긴다.
3. 승인된 2026-08-12 내부 검토를 기준으로 별도 인프라 issue를 만들고 GCP backend·Production-like drill을 수행한다. #137 1단계와 외부 backend 구현은 병행할 수 있다.
4. #191의 DB/Hook/provider 절편을 구현하되 외부 durable ack backend drill 전에는 Production 발송을 활성화하거나 닫지 않는다. 그 뒤 #137 2단계가 삭제·복원을 닫는다. #188 classifier·guard는 병행하되 신규 거절 E2E는 공유 worker 뒤에 닫는다.
5. #177→#190→#179를 실제 운영값으로 닫고 #87·#191과 함께 #168 controlled commerce smoke를 수행한다.
6. ADR-0008과 canonical 문서가 default branch에 merge되면 #66·#115를 `wontfix`, reason `not planned`로 닫는다. 이는 단순 연기가 아니라 current scope 제거다.
7. 각 close 직전 issue body, default branch, CI, Production/외부 증거를 다시 읽고 이 표의 모든 evidence를 충족하는지 감사한다.

## 연관 문서

- [이슈 본문 동기화 초안](./2026-08-11-open-issue-body-sync-draft.md)
- [#134·#137·#188·#191 TDD 구현 후보 계획](./2026-08-11-open-issue-implementation-candidate-plan.md)
- [제품·기술 결정 확인서](../../questionnaires/to-questionnaire-open-issue-decisions.md)
- [정책 법무 확인서](../../questionnaires/policy-legal-review.md)
- [커뮤니티 운영 승인 확인서](../../questionnaires/community-policy-operations-approval.md)
- [첫 실판매 준비](../../first-sale-readiness.md)
- [출시 준비](../../launch-readiness-plan.md)

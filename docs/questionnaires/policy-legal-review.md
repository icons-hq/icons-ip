# ICONS 탈퇴·커뮤니티 정책 법무 확인서

> **삭제원장 backend 정정:** 아래 GCP append service 서술은 2026-08-12 검토 시점 기록이다. 현행 방향은 운영 Supabase와 backup 계보가 분리된 **별도 Supabase compliance 프로젝트**다([`account-deletion-retention-policy.md`](../account-deletion-retention-policy.md) · [#215](https://github.com/icons-hq/icons-ip/issues/215)).

> 상태: **Answered — Interim legal-risk decision record** · 결정일 2026-08-12
>
> 성격: 회사 내 전담자가 없다는 제품 소유자의 위임에 따라 Codex가 공식 법령과 현재 서비스 사실을 기준으로 정한 보수적 운영 결정이다. 변호사 명의의 법률의견을 가장하지 않으며, 자연인 수령인·사업자 정보·처리자 계약처럼 실제 사실이 필요한 항목은 증거 전까지 관련 기능을 비활성화한다.

**Purpose:** 회원 탈퇴·법정 보존·미성년자 처리와 커뮤니티 신고 정책의 미확정 법률 항목을 승인해 [#102](https://github.com/icons-hq/icons-ip/issues/102), [#110](https://github.com/icons-hq/icons-ip/issues/110), [#188](https://github.com/icons-hq/icons-ip/issues/188)의 구현 기준을 확정합니다.

**From:** ICONS 개발·운영팀 — **To:** 대한민국 개인정보·전자상거래·온라인 플랫폼 담당 변호사 — **How your answers will be used:** [`account-deletion-retention-policy.md`](../account-deletion-retention-policy.md), [`community-moderation-policy.md`](../community-moderation-policy.md), 이용약관·개인정보처리방침과 후속 DB·운영 구현에 반영합니다.

## Context

ICONS는 실물 굿즈와 티켓을 직접 판매하고 팬 커뮤니티·디지털 카드 리워드를 제공하는 서비스입니다. NAVER·스마트스토어의 문구나 중개자·Npay 책임을 복제하지 않고, `상위 이용약관 → 개인정보처리방침 → 계정·게시물 운영정책 → 거래·배송 정책 → 권리보호 절차`라는 문서 계층과 처리 절차를 참고했습니다. 위 두 정책 문서는 아직 Draft·미시행이며, 답변 전에는 법률적으로 승인된 것으로 표시하지 않습니다.

## How to answer

**회신일:** `2026-08-12` · **결정 원칙:** 직접판매자 역할, 최소수집·목적제한, 법정기록 분리보존, 권리 경로 우선, 증거 없는 외부처리 fail closed
각 질문에 `승인 / 수정 필요 / 적용하지 않음` 중 하나를 표시하고, 수정할 문구·필드·기산점·법적 근거를 적어주세요. 일부 답변과 `추가 사실 필요`도 유효합니다. 실제 이용자 개인정보, 사건 자료, 계약서 원문이나 비밀값은 이 문서에 넣지 마세요.

## 서비스 지위와 문서 체계

### ICONS를 굿즈·티켓의 직접 통신판매자로 기술한 전제가 맞습니까?

> 판단: **맞음.** ICONS는 자신의 굿즈·티켓을 자신의 명의로 판매하는 직접 통신판매자다.
>
> 수정할 역할 또는 추가 책임: NAVER 스마트스토어·Npay의 중개·정산·판매자 관리 책임은 가져오지 않는다. 가격·고시정보·계약·결제·공급·청약철회·환급·고객지원 책임을 ICONS가 부담한다.
>
> 근거: 전자상거래법상 통신판매 정의와 현재 코드의 단일 seller·Toss 직접 결제 구조.

### 커뮤니티 서비스와 관련해 ICONS가 어떤 전기통신사업법상 지위에 해당합니까?

`부가통신사업자`, 불법촬영물등에 관한 `조치의무사업자`·`사전조치의무사업자` 해당 여부를 각각 판단해 주세요. 해당하지 않는 지위도 근거를 남겨주세요.

> 지위별 해당 / 비해당 / 추가 사실 필요: UGC 저장·공개 기능상 부가통신역무와 저장형 OSP에 해당할 가능성을 전제로 더 엄격한 보호절차를 운영한다. 이는 법적 지위·신고 완료·safe-harbor 충족을 확정하는 문구가 아니다. 사전조치의무사업자는 규모·서비스 유형·지정 요건이 확인되지 않아 적용 여부를 단정하지 않는다.
>
> 필요한 신고·등록: 실제 법인 자본금, 서비스 기능, 수익·통제 구조를 확인해 신고 또는 면제 증거와 OSP 유형을 문서화하기 전에는 community write를 활성화하지 않는다.
>
> 인지 후 삭제·차단·신고 의무: 신고·인지 즉시 임시 접근제한, 최소 메타데이터 보전, 관계기관 인계 판단, 신청인·게시자 통지와 게시판 공시를 수행한다. 불법 원본을 일반 운영 저장소에 복제하지 않는다.
>
> 사전 기술·관리조치 의무: 현재 사전조치의무사업자로 단정하지 않지만 신고 UI, hash/URL 기반 격리, 재게시 방지, 접근 capability·감사를 기본 통제로 구현한다.
>
> 보존·보고할 기록과 기간: 사건 ID·접수/조치/통지시각·category·content hash·관계기관 인계 ref만 3년 보존을 기본으로 하고, 원본은 명시적 법적 근거·격리·기한부 접근 없이는 보존하지 않는다.
>
> 근거: 정보통신망법상 권리침해 조치 절차와 전기통신사업법상 불법촬영물등 조치 체계를 위험 기준으로 적용한다.

### ICONS는 저작권법상 어떤 온라인서비스제공자 유형에 해당합니까?

전기통신사업법상 지위와 별도로 저작권법 제102조 제1항의 유형을 서비스 기능별로 판단해 주세요.

> 기능별 온라인서비스제공자 유형 / 비해당 / 추가 사실 필요: post/comment/image를 이용자 요청으로 저장·공개하는 **hosting/storage 유형 OSP**로 취급한다. 단순 전송·cache·검색링크 전용 유형은 현재 기능에 적용하지 않는다.
>
> 중단 사실을 통지할 대상: 법무가 해당 유형에 요구하는 게시자와 권리주장자 모두. 게시자 계정이 삭제됐으면 지정된 연락수단이 있을 때만 최소 통지하고 공개로 개인정보를 노출하지 않는다.
>
> 통지서에 첨부할 중단요청서 사본·기타 서류: 법정 중단요청서 사본과 제출된 권리·대리권 증빙 목록. 주민번호·주소·서명 등 불필요한 개인정보는 가린다.
>
> 게시자에게 안내할 재개요구 방법·기한: `/legal/rights-protection`의 본인확인된 재개요구 form, 필요한 권리 소명, 접수 뒤 처리 단계와 법정 기한을 안내한다.
>
> 3일 이내 정당성 결정의 기준·담당 역할: 권리 보유·이용허락·법정 허용사유와 제출서류의 일관성을 ICONS 권리보호 책임자가 판단한다. 불명확하면 재개하지 않고 외부 법률 검토 대상으로 둔다.
>
> 정당하다고 인정한 경우 권리주장자에게 보낼 내용: 재개요구 사실, 재개예정일, 대상 content ref, 이의·법적 구제 안내만 보낸다.
>
> 근거: 저작권법 제102조·제103조와 시행령 제43조의 중단·재개 절차.

### 저작권법 제103조의 중단·재개 요구 수령인을 지정·공개해야 합니까?

제103조 적용 온라인서비스제공자라면 시행령 제44조는 수령인의 성명·소속부서명, 전화번호·팩스번호·전자우편주소와 우편 수령 주소를 누구나 쉽게 알 수 있게 표시하도록 합니다. ICONS 기능별 OSP 유형 판단과 연결해 답해 주세요.

> 적용 / 비적용 / 추가 사실 필요: hosting/storage OSP로 운영하므로 **적용을 전제로 한다.**
>
> 수령인을 개인명으로 지정 / 직무·부서명으로 대체 가능: 시행령이 성명을 요구하므로 실제 자연인 지정이 필요하다. 현재는 지정 사실을 만들 수 없으므로 community 공개 write와 법정 절차 시행을 보류한다.
>
> 공개해야 할 정확한 필드와 법인 대표 연락처 사용 가능 범위: 수령인 성명·소속부서, 업무 전화·팩스·이메일, 우편 수령 주소. 검증된 법인 업무 연락처만 사용하고 개인 연락처는 공개하지 않는다.
>
> 변경 공지 시점·휴일 대체 담당 요건: 변경 효력 전 즉시 갱신하고, 휴일에도 접수시각을 고정할 전자 form과 대체 담당 역할을 둔다.
>
> 적용 시작일·근거: 실제 수령인·업무 연락처 검증 및 `/legal/rights-protection` 활성화와 같은 날. 그 전 정책은 Draft다.

### 정책 문서를 상위 약관·개인정보·커뮤니티 운영·거래배송·권리보호 절차로 분리해 연결하는 구조를 승인합니까?

> 판단: **승인.** 문구가 아니라 NAVER의 계층·절차를 참고하고 ICONS 역할을 독립적으로 쓴다.
>
> 합치거나 추가할 문서: 상위 이용약관, 개인정보처리방침, community 운영정책, 거래·배송·청약철회 정책, 권리보호 절차, 계정/연령·탈퇴 안내를 상호 링크한다.
>
> 근거: 사용자가 적용 문서와 권리 경로를 한 화면에서 찾게 하면서 책임·보존·절차를 혼합하지 않기 위함.

## 탈퇴와 거래기록 보존

### 계약·청약철회 기록을 아래 최소 필드로 분리 보존하는 범위를 승인합니까?

현재안은 계약 또는 청약철회 기록 생성일부터 5년입니다.

> 승인할 필드: 제안 필드 승인. `currency`, 계약 terms/version, 판매자/고시정보 snapshot hash를 추가한다.
>
> 제외하거나 추가할 필드: 자유서술 취소사유·provider raw·배송메모는 제외한다. 정상화된 policy code·결정·통지시각만 둔다.
>
> 기산점 또는 기간 수정: 계약 성립 또는 청약철회 기록 생성일부터 각각 5년. 후속 기록은 자신의 생성일부터 5년을 보장한다.
>
> 근거: 전자상거래법 시행령 제6조의 계약·청약철회 기록 5년.

### 대금결제·환급·공급 기록을 아래 최소 필드로 분리 보존하는 범위를 승인합니까?

현재안은 각 기록 생성일부터 5년이며 `payments.raw` 전체는 제외합니다.

> 승인할 필드: 제안 필드와 `currency`, provider 거래 상태의 정규화 code, 승인·취소·환급시각을 승인한다.
>
> 제외하거나 추가할 필드: `payments.raw`, provider body/message, 카드번호·인증값은 제외한다. `payment_key`는 아래 별도 결정에 따른 암호화 필드다.
>
> 기산점 또는 기간 수정: 각 결제·환급·공급 기록 생성일부터 5년. 배송 완료가 뒤에 생기면 해당 공급 기록은 완료일부터 5년을 보장한다.
>
> 근거: 전자상거래법 시행령 제6조의 대금결제·재화 공급 기록 5년.

### 티켓 계약·결제·공급·검표·취소 기록을 아래 최소 필드로 분리 보존하는 범위를 승인합니까?

현재안은 기록별 5년이며 예매 시점 회차명·가격·수량 snapshot은 신규 구현 대상입니다.

> 승인할 필드: 제안 필드와 행사 일시·장소 snapshot, 통화, 결제/환급 ref를 승인한다.
>
> 제외하거나 추가할 필드: 자유서술·provider raw는 제외한다. 검표는 결과·시각·gate ref만 남긴다.
>
> 계약 / 결제 / 공급 / 검표 / 취소별 기산점·기간: 각 기록 생성일부터 5년. 검표 기록은 행사 종료/검표시각 중 늦은 시각부터 5년 이내 계약 공급증빙에 포함한다.
>
> `reservation_key`, `qr_token`, 자유서술, 검표자 ID의 파기 조건: reservation key와 QR 원문은 예매 만료·검표·취소 중 먼저 terminal이 된 뒤 즉시 파기한다. 자유서술은 사건 종료+30일 이내, 검표자 ID는 승인된 audit ref/HMAC으로 바꾸고 원 FK를 제거한다.
>
> 근거: 전자상거래 계약·결제·공급 기록과 QR 재사용 위험 최소화.

### 주문 확인·배송 이메일의 발송 증빙을 거래기록으로 별도 보존해야 합니까?

현재 행의 recipient는 주문 시점 snapshot이 아니라 **각 발송 시점의 mutable `profiles.email`**입니다. 재시도는 같은 행의 recipient·subject·완료시각을 마지막 시도 값으로 덮어써 시도별 이력이 없고, HTTP 2xx를 `sent`로 기록할 뿐 실제 수신·교부를 확인하지 않습니다. 실제 교부 본문의 version·hash, provider message ID와 delivery event도 없습니다. 따라서 현재 행 전체를 완전한 교부 증거로 장기 보존하는 안은 제안하지 않습니다.

> 보존 필요 / 탈퇴 시 파기: 완전한 이메일 원문과 provider attempt는 법정 5년 기록으로 자동 승격하지 않고 처리자별 운영 TTL에 따라 파기한다. 계약내용 전자문서 교부의 최소 증빙이 필요하면 order 계약 snapshot에 template/version·content hash·교부 사건 시각만 분리한다.
>
> 필요한 최소 필드: 5년 계약 snapshot에는 order ref, template/version, content hash, 교부 사건 시각만 둔다. recipient provenance digest, provider message ID와 delivery/bounce event는 전송 정합화용 단기 원장에만 둔다.
>
> 실제 교부 내용의 hash·version 또는 provider 증빙 필요 여부: 둘 다 필요. HTTP 2xx는 접수 증거일 뿐 교부 완료로 단정하지 않는다.
>
> 주문 시점의 불변 recipient provenance — 원문 / keyed digest / 불필요: keyed digest와 capture 시각을 기본으로 하고 원문은 실제 발송 window까지만 암호화 보관한다.
>
> 시도별 불변 원장·provider message ID·delivery event 필요 여부: 필요. retry가 앞선 attempt를 덮어쓰지 않게 한다.
>
> 기산점·기간·접근 역할: 계약 snapshot은 계약기록과 같은 기간, 발송 attempt·provider locator는 처리자 데이터 종류별 실제 TTL과 외부 삭제 확인+7일까지만 유지한다. 둘 다 server/compliance 전용이며 일반 staff/admin 직접 조회를 금지한다.
>
> 기존 행을 증거로 사용할 수 있는 범위: 마지막 provider 요청 시도와 앱 상태의 보조자료일 뿐 주문시점 recipient·실제 교부·정확한 본문 증거로 쓰지 않는다.

### 외부 이메일 처리자 사본을 탈퇴 시 어떻게 파기·고지해야 합니까?

기본 Resend API와 Supabase Auth SMTP는 수신주소·message metadata·본문을 외부 처리자에게 전송합니다. Resend 공개 문서는 일반 email data 30일 보존을 안내하지만, event log·suppression·backup과 회원별 삭제 지원은 실제 계약·설정 확인이 필요합니다.

> 처리자별 탈퇴 삭제 지시 의무: message ID/locator가 있으면 회원별 삭제를 지시하고 ack를 추적한다. 지원하지 않으면 계약상 자동 만료를 task로 등록한다.
>
> 개별 삭제가 없을 때 허용할 자동 만료기간·기산점: 일반 email data의 공식 30일과 event·suppression·backup·support copy를 분리한다. 각 항목은 실제 plan·DPA·관리화면 read-back으로 기간과 삭제 경로를 확정하며 하나라도 미확정이면 Production 메일을 활성화하지 않는다.
>
> event log / suppression / backup별 허용 잔여기간: 처리자 계약·설정의 실제 값을 사용한다. suppression 원문을 provider가 요구하면 ICONS가 HMAC으로 전환했다고 표시하지 않는다. 확인된 기간이 없으면 해당 처리자를 활성화하지 않는다.
>
> provider message ID·locator digest 보존기간: 처리자별 삭제/만료 due와 외부 확인기간뿐 아니라, 각 `purge_committed_at`보다 앞선 상태를 복원할 수 있는 catalog artifact 전부의 `max(expires_at)`+최대 replay 지연+7일까지 필요한 linkage를 유지한다. 45일 hard cap을 두지 않고 거래 snapshot에는 opaque provider ID를 자동 5년 보존하지 않는다.
>
> 처리자 ack 또는 만료 확인 요건: API/관리화면 read-back 또는 계약상 expiry evidence와 timestamp가 필요하다. 단순 요청 전송을 완료로 보지 않는다.
>
> 사용자에게 알릴 외부 잔여기간·수신자 메일함 사본 문구: 처리자·데이터 종류별 실제 기간을 표에 표시하고 “이미 수신된 개인 메일함 사본은 이용자가 직접 관리합니다”라고 고지한다. 전체 사본을 “최대 30일”로 묶어 고지하지 않는다.
>
> DPA·국외이전 고지의 수정 문구: 처리자 법인명·국가·목적·항목·이전시점/방법·보유기간·거부 영향·문의 경로를 실제 계약값으로 명시한다.

### Production 메일을 Send Email Hook과 durable outbound intent로 통제하는 안을 승인합니까?

현재 Auth custom SMTP와 앱 거래메일은 별도 경로입니다. 제안안은 Production 활성화 전에 Auth 발송의 실행 경계를 Supabase Send Email Hook으로 전환하고, 모든 메일에서 withdrawal·`underage_rejected` fence를 먼저 확인합니다. 허용된 발송도 provider 호출 전에 복원 독립 intent를 남기고 idempotency key·PII 없는 tag·provider message ID·검증된 event로 reconcile합니다. Hook route·health를 먼저 배포한 뒤 별도 단계에서 활성화하며, controlled canary 전에는 기존 SMTP 호환 설정을 즉시 제거하지 않습니다.

> 개인정보 처리·탈퇴 고지 관점의 승인 / 수정 필요: **승인.** Auth·transactional mail을 같은 fence와 durable intent 계약으로 통제한다.
>
> fence epoch 뒤 신규 intent·claim 0건과 fence 전 in-flight lease의 drain·terminal 취소를 입증할 기준: DB constraint/RPC test, queue scan, 외부 event replay에서 0건이어야 하고 race fault test를 통과해야 한다.
>
> fence 이전 intent의 provider 수락·event drain 완료 기준: 각 outbound가 외부 `accepted|failed` durable ack 또는 명시적 terminal cancel을 가져야 하며 ambiguous 0건이어야 한다. webhook은 `(provider, outbound_id, provider_event_id)`별 immutable event와 reducer checkpoint로 별도 drain한다.
>
> 모호 응답을 24시간 뒤 자동 재발송하지 않는 안 승인 / 수정: 승인. provider 조회·지원으로 수동 판정하고 새 발송은 별도 사용자 action으로만 한다.
>
> provider별 삭제·자동 만료 cutoff의 승인된 기산점: `max(provider_fence_acked_at, last_provider_acceptance_at, auth_delete_acked_at)`.
>
> 암호화 recipient의 기본 24시간 보존과 attempt/event 내용의 처리자 만료+7일 상한 승인 / 수정: 승인. 단, 복원 후 처리자 purge를 재구성할 최소 subject/provider locator linkage는 attempt와 분리해 §GCS의 restore horizon까지 유지한다. 별도 legal hold가 없으면 각 목적 기한을 넘겨 연장하지 않는다.

### GCS 외부 원장 후보를 별도 ADR·인프라 issue로 검토할 조건을 승인합니까?

이 질문의 내부 답변으로 GCP append service + read-only verifier 구조와 interface를 2026-08-12 내부 검토에 승인했습니다. 이는 실제 GCP project·DPA·region·billing·IAM·Bucket Lock 또는 #137/#191 Production backend 활성화 승인이 아닙니다. Production-like drill 전에는 bucket/object retention이나 외부 삭제 barrier를 켜지 않고, core event도 내부 event ID로 다시 연결될 수 있는 동안 익명정보로 단정하지 않습니다.

> Google Cloud를 개인정보 처리자·수탁자에 추가하는 법적 근거, current DPA·subprocessor 검토자와 승인일: 삭제 이행·복원 방지라는 계약·법적 의무 수행 목적의 수탁자로만 승인 후보로 둔다. current DPA·subprocessor를 read-back하고 개인정보처리방침을 고치기 전에는 Production 활성화 금지다.
>
> Seoul `ASIA-NORTHEAST3`는 저장 위치일 뿐 모든 처리 위치가 국내라는 보장이 아니라는 전제의 국외이전·지원·로그 처리 고지: 승인. 지원·보안·로그 처리 위치를 포함한 실제 이전국가/항목/기간을 고지한다.
>
> retention-class별 locked Bucket Lock bucket / GCP append service + 별도 read-only verifier 중 선택과 별도 ADR·인프라 issue owner: **GCP append service + 별도 verifier**. 개발 agent가 ADR·issue·IaC를 준비하고 Production project 생성은 별도 승인한다.
>
> 삭제 core / email core / purge 증거별 retention class·기산점·lifecycle과 lock 전 test bucket drill·법무/보안 서명: 각 `purge_committed_at`보다 앞선 상태를 복원할 수 있는 catalog artifact 전부의 `max(expires_at)`+최대 replay 지연+7일 또는 미완료 처리 필요기간 중 긴 값으로 계산하고 hard cap으로 자르지 않는다. 45일을 넘으면 해당 restore artifact를 먼저 영구 폐기·검증한다. test project drill 전 lock 금지.
>
> 암호화 subject / recipient / provider locator별 TTL, application envelope DEK·key registry·rotation·파기 owner: recipient는 terminal 정합화에 필요한 최단시간(기본 24시간), subject/locator는 purge 완료와 위 restore horizon 중 늦은 시각까지 둔다. record/subject별 DEK와 공유 KMS KEK를 분리하고 expiry purger가 ciphertext·wrapped DEK·모든 recoverable generation을 파기한다. 공유 KEK version을 개인별 파기 수단으로 쓰지 않는다.
>
> Supabase daily/PITR, manual export, clone, DR·분석 사본을 포함한 전체 restorable snapshot catalog와 artifact별 삭제 전 상태 복원 가능 여부·durable watermark: catalog 등록·owner·expiry 없는 사본은 금지한다. 기본 30일 restore window를 넘기거나 catalog가 바뀌면 별도 승인과 ledger TTL 재계산이 필요하다.
>
> linkage가 이미 파기된 cutoff의 restore 거부, durable watermark 기반 lossless replay drill과 legal hold 시 linkage·record DEK 보존 연장 승인: 승인. wall-clock·GCS generation은 전역 cursor로 쓰지 않고 복원보다 재파기 가능성을 우선한다.
>
> 외부 immutable `legal_hold_set|released` event, GCS temporary hold 적용·해제와 별도 compliance principal·2인 승인: 2인 승인은 Production legal-hold 기능 활성화 조건이다. 제2 승인자가 없으면 새 hold를 만들지 않으며 불가피한 기관 요청은 검증된 외부 법률 검토자를 제2 승인자로 지정한 뒤 처리한다. 이미 설정된 hold는 근거 종료 시 명시적으로 release·파기하며 인력 부족으로 무기한 보존하지 않는다.
>
> bucket 생성 시 soft delete 0일·Object Versioning off read-back, 배포별 drift alert, 기존·신규 soft-deleted/noncurrent generation 잔여 확인과 provider-side 삭제 기간 고지: 승인. 설정이 되돌아가거나 recoverable generation이 남으면 삭제 완료로 표시하지 않는다.
>
> team issuer·audience·`owner_id`·`project_id`·production environment·exact subject로 제한한 Vercel OIDC/WIF, Preview/Development 거부와 bucket/service 최소 권한: 필수. wildcard·장기 service account key 금지.
>
> create-only writer, append service, read-only verifier, restore/decrypt, expiry purger, legal-hold operator, key destroy, project lien break-glass의 분리 owner: 서로 다른 service account·IAM·감사 sink로 분리한다. append service는 caller별 event-type·선행 ack·허용 상태전이를 검증하고 앱 writer의 `purge_completed|legal_hold_released|key destroy`를 거부한다. 단일 자연인이 운영하더라도 credential·승인 경계는 합치지 않는다.

### 주문 이메일에 현재 배송지 전체를 넣는 것이 목적상 필요한 최소 처리입니까?

현재 주문 확인 본문은 수령인명·전화·우편번호·주소·배송메모를, 배송 시작 본문은 운송장 정보를 포함합니다.

> 필드별 유지 / 제거 / 링크로 대체: 이메일에는 주문 reference, 상품명·수량·금액·상태만 둔다. 수령인명은 마스킹하고 전화·전체 주소·배송메모는 제거해 인증된 주문 상세 링크로 대체한다. 배송 시작 메일은 택배사와 마스킹 운송장/안전한 조회 링크만 둔다.
>
> message content storage 비활성 또는 암호화 링크 필요 여부: provider content storage를 끌 수 있으면 비활성화한다. 주문 상세는 짧은 이메일 token이 아니라 기존 인증 session을 요구한다.
>
> 거래 서면 교부와 데이터 최소화의 조정 기준: 계약의 핵심 품목·수량·금액·판매자·청약철회 안내는 이메일 본문 또는 첨부 snapshot으로 제공하되 배송 개인정보는 인증된 상세에서만 보여준다.

### Vercel runtime log와 Log Drain의 탈퇴·보존 계약을 어떻게 정해야 합니까?

Vercel은 `console.*`를 plan에 따라 1시간~30일 보존합니다. 통신비밀보호법상 접속기록과 애플리케이션 디버그 로그를 구분해 답해 주세요.

> runtime log의 허용 개인정보·금지 식별자: allowlist 오류 code, latency, route, random request ID, domain-separated HMAC ref만 허용. 이메일·주소·전화·DOB·주문 UUID·paymentKey·QR·token·provider body/error 원문 금지.
>
> 실제 plan·Log Drain별 허용 TTL: runtime/Log Drain 모두 기본 7일, 보안 incident 전용 익명 집계 30일. 더 긴 plan default는 application-level PII 금지와 자동 expiry로 제한한다.
>
> 회원별 삭제가 불가능할 때의 자동 만료·고지: TTL 자동 만료만 사용하고 “즉시 개별 삭제”라고 고지하지 않는다.
>
> 접근·반출·감사 역할: on-call service principal과 최고관리자만 time-bound 조회. 원문 반출 금지, query·actor·목적·시각 감사.
>
> 내부 보안로그 3개월과 별도 운영할 최소 필드·저장소: timestamp, pseudonymous account/session ref, source IP의 보호된 최소값, action/result만 별도 security store에 최대 3개월 둔다. 전기통신사업자 지위와 통신사실확인자료 범위가 확인되기 전에는 이를 “법정 접속기록”으로 부르지 않는다.
>
> 개인정보처리방침의 Vercel 보유기간 수정 문구: “애플리케이션 runtime log는 원문 개인정보를 기록하지 않으며 최대 7일 자동 만료합니다. 별도 내부 보안로그는 최소 필드로 최대 3개월 보관합니다. 적용 법령이 확인되면 법정 대상 필드·기간을 별도 표에 표시합니다.”

### `payment_key`를 법정 거래·분쟁 증거로 보존해야 합니까?

> 보존 / 파기: `payment_key`는 법정 결제증빙이 아니라 provider 재조회·취소·환급을 위한 operational secret이다. field-level 암호화하고 raw payload·로그 사본은 파기한다.
>
> 필요 목적: provider 재조회·환급·chargeback/분쟁 정합화와 결제 증빙 연결.
>
> 보존기간·기산점: provider 계약의 취소·환급·분쟁 처리 가능기간과 실제 미종결 사건 중 긴 기간까지만 유지한다. 기간이 문서화되지 않으면 live 결제를 활성화하지 않으며, 법정 5년을 이유로 자동 보존하지 않는다.
>
> 암호화·접근 조건: field-level envelope encryption, 서비스 취소 worker와 목적 승인된 compliance 조회만 복호화. 일반 staff/admin·runtime log 금지.

### 배송지 중 법정 증거로 남겨야 하는 필드는 무엇입니까?

현재안은 승인된 필드만 암호화하고 `phone`, `deliveryNote`와 주소록 형태의 재사용은 제외합니다.

> `recipientName`: 발송·반품·진행 분쟁에 필요한 동안만 암호화 보존.
>
> `postalCode`: 발송·반품·진행 분쟁에 필요한 동안만 암호화 보존.
>
> `address1`: 발송·반품·진행 분쟁에 필요한 동안만 암호화 보존.
>
> `address2`: 배송·분쟁 처리에 실제 사용된 값만 같은 단기 범위로 암호화 보존.
>
> 기타 필드: phone과 deliveryNote는 배송 완료·반품/분쟁 종료 후 30일 이내 파기. tracking carrier/number는 공급증빙으로 암호화 보존한다.
>
> 기산점·기간·근거: 배송 완료·반품·분쟁 종료 중 늦은 시각부터 30일 안에 원문을 파기한다. 공급 증빙은 order/item/delivery event와 택배사 opaque ref로 남기고, 전체 주소를 5년 자동 보존하지 않는다. 명시적 분쟁·기관 요구는 사건별 legal hold로만 연장한다.

### 소비자 불만·분쟁 기록 3년의 기산점을 무엇으로 정해야 합니까?

> 사건 접수일 / 기록 생성일 / 최종 처리일 / 필드별 다름: 각 처리기록은 자체 생성일부터 3년을 계산한다. 종결 결정도 생성 시점부터 자체 3년을 가지며, 종결만으로 앞선 모든 기록의 기간을 다시 시작하지 않는다.
>
> 장기 진행 사건 처리: 90일마다 review하고, 소송·기관 요구로 과거 기록의 만료를 멈춰야 할 때만 사건별 legal hold를 사용한다.
>
> 근거: 시행령의 소비자 불만·분쟁처리 기록 3년을 충족하면서 처리 결과 생성 후 보존기간이 짧아지지 않게 함.

### 표시·광고 기록을 노출 종료일부터 6개월 보존하는 안을 승인합니까?

현재안은 실제 노출 본문 snapshot, `content_hash`, `effective_from`, `effective_to`만 보존하고 회원과 연결하지 않습니다.

> 판단: **승인.** 이용자 식별자 없이 노출 사실만 보존한다.
>
> 수정할 필드·기산점·기간: content snapshot/hash, 가격·조건·고시정보 version, effective_from/to, channel. 각 노출 기록을 6개월 보존한다. 마지막 노출 종료일부터 6개월을 두는 것은 campaign 전체 노출을 포괄하기 위한 내부 구현규칙이다.
>
> 근거: 전자상거래법 시행령 제6조의 표시·광고 기록 6개월.

### 분리보존 기록의 조회·복호화·반출·파기 권한을 어떻게 제한해야 합니까?

계약·결제·환급·배송·티켓·표시광고 범주별로 답해 주세요. 앱의 일반 `staff`·`admin` 권한이 자동으로 보존 원장 접근권한을 뜻하지 않는 구조를 전제로 합니다.

> 범주별 조회 역할: 계약·공급은 CS에 redacted view만; 결제·환급은 finance/compliance service; 티켓은 해당 거래 CS redacted view; 표시광고는 content compliance. 일반 admin role만으로 직접 table 조회 불가.
>
> 복호화 가능 역할과 사유: 승인된 server function이 주문 해결·법정 권리행사·분쟁 대응 목적별 최소 필드만 복호화한다.
>
> 외부 반출 승인자·2인 승인 필요 여부: 법원·기관 요구 또는 본인 권리행사에만 허용하고 2인 승인을 원칙으로 한다. 현재 2인이 없으므로 자동 외부 반출은 금지한다.
>
> 만료 파기 실행·실패 재처리 역할: expiry service account, 실패는 별도 queue와 최고관리자 경보. 조회 역할과 분리한다.
>
> 필수 감사 항목·감사 보존기간: actor/service, purpose code, case/order ref HMAC, fields, result, timestamp; 원문 값 없이 3년.
>
> 정기 접근권한 검토 주기: 월 1회 자동 diff, 분기 1회 최고관리자 승인. 인력 변경 즉시 회수.

## 탈퇴 후 권리행사와 본인확인

### 주문·예매 시점 연락처의 keyed HMAC digest를 거래별로 고정하는 방식을 승인합니까?

원문 프로필을 유지하지 않고 탈퇴 후 후보 거래를 찾는 1차 조건으로만 사용합니다.

> 판단: **승인.** 거래시점 연락처를 소급 추정하지 않고 생성 트랜잭션에서 고정한다.
>
> 허용할 입력 항목: 정규화 이메일·전화의 purpose-separated keyed HMAC만. 주소·이름·DOB는 lookup digest로 사용하지 않는다.
>
> 보존기간·키 관리 조건: 해당 거래 법정 기록과 같은 5년. lookup/observability/log 키를 분리하고 연 1회 rotation하며 이전 키는 연결 record 만료까지만 KMS에서 유지한다.
>
> 근거: 탈퇴 후 거래 열람을 위한 후보 식별 최소화와 current mutable profile 오인 방지.

### HMAC 일치 후 현재 통제하는 이메일 magic link 또는 전화 OTP를 추가 검증하는 방식을 승인합니까?

> 판단: **승인.** HMAC 일치는 후보 검색일 뿐 본인확인 완료가 아니다.
>
> 허용 채널: 현재 통제하는 거래시점 이메일 magic link 또는 전화 OTP. 둘 다 없으면 수동 심사.
>
> 추가 본인확인 조건: order/ticket reference, 대략적 거래일·금액/품목 일치, IP·digest별 rate limit과 일시 잠금. 결과는 최소 필드만 반환한다.
>
> 근거: 과거 주문정보 탈취만으로 거래기록이 노출되는 것을 막기 위함.

### 기존 연락 채널을 통제하지 못하는 이용자의 수동 최소정보 심사 기준은 무엇입니까?

> 받을 수 있는 최소 자료: 주문/예매 reference, 대략적 날짜·금액·품목, 거래 당시 연락처 일부, 현재 회신 가능한 채널. 필요한 항목을 단계적으로 요청한다.
>
> 받으면 안 되는 자료: 주민등록번호, 주민등록증·여권 전체 사본, 얼굴 셀피, 계좌 비밀번호·카드 전체번호, 불필요한 가족정보.
>
> 승인 역할·처리기한: 개인정보 권리처리 capability를 가진 최고관리자. 접수 10일 안에 처리 또는 구체적 지연/보완 사유를 통지한다.
>
> 거절 통지 요건: 불일치 항목을 과도하게 공개하지 않고 거절 사유, 재신청·이의·감독기관 경로를 안내한다.

## 커뮤니티·권리침해 사건 보존

### 일반 커뮤니티 신고 기록의 보존 근거와 기간을 어떻게 정해야 합니까?

> 법적·계약상 근거: 서비스 안전·운영정책 집행과 이의 처리의 정당한 필요. 신고만으로 장기 legal record를 만들지 않는다.
>
> 보존할 필드: case ID, category, target content ref, reporter/subject keyed ref, 접수·조치·통지·이의 시각, 정규화 reason/result, content hash. 자유서술·원본 첨부는 30일 내 최소화한다.
>
> 기산점·기간: 최종 조치/이의 종료일부터 90일. 반복 abuse 조사나 명시적 legal hold만 별도 승인한다.
>
> `staff` 조회 범위: 배정된 사건의 redacted content·category·상태·필요 최소 증거만.
>
> `admin` 조회·반출 범위: 목적기반 capability와 감사가 있는 사건만. 외부 반출은 법적 요구·본인 권리행사 외 금지한다.

### 명예·사생활 침해 요청 기록의 보존 근거와 기간을 어떻게 정해야 합니까?

> 보존할 신청·통지·결정 필드: 신청인/게시자 keyed ref, 침해 주장 category·content ref, 소명서 version/hash, 접수·임시조치·통지·공시·재개/삭제 결정시각과 근거 code.
>
> 기산점·기간: 최종 조치·재개 또는 이의 종료일부터 1년. 소송·기관요구가 있으면 명시적 legal hold로 분리한다.
>
> 접근·반출 승인 역할: 권리보호 capability와 최고관리자. 사건 당사자 제공·기관 요구 외 반출 금지.
>
> 사건 종료 뒤 파기 조건: 원문 신청·첨부는 30일 안에 최소화하고 1년 만료 시 linkage·자유서술을 파기한다.

### 저작권 복제·전송 중단·재개 요청 기록의 보존 근거와 기간을 어떻게 정해야 합니까?

> 보존할 신청·대리권·통지·재개 필드: 법정 서식 version/hash, 권리·대리권 확인 결과, content ref/hash, 중단·게시자 통지·재개요구·정당성 결정·권리주장자 통지·재개 시각과 결과 code.
>
> 기산점·기간: 최종 재개/중단 결정일부터 3년. 별도 소송·수사에는 legal hold를 사용한다.
>
> 접근·반출 승인 역할: 지정 수령인·권리보호 capability. 외부 제공은 당사자·기관의 적법한 요청에만 허용한다.
>
> 사건 종료 뒤 파기 조건: 신분·주소·서명 등 원문 개인정보는 확인 후 30일 내 redaction/minimize하고 3년 만료 시 linkage와 첨부를 파기한다.

### 불법촬영물등·아동·청소년 성착취물 사건에서 원본을 일반 증거 저장소에 복제하지 않는 원칙을 승인합니까?

> 판단: **승인.** 일반 DB·로그·ticket 첨부에 원본을 복제하지 않는다.
>
> 보존 가능한 최소 메타데이터·해시: case ID, 신고 category, URL/content ID, cryptographic hash, 접수·차단·신고/인계시각, 기관 ref, 결과 code. 해시도 목적 종료 시 파기한다.
>
> 격리 접근 역할: 별도 `restricted_evidence_reviewer` capability와 기관 인계 service만.
>
> 사건별 접근의 2인 승인·기한부 권한·감사 요건: 원본 접근은 2인 승인·최대 1시간·download 금지·화면 watermark·전 조회감사. 현재 2인이 없으므로 원본을 열지 않고 즉시 차단·기관 인계한다.
>
> 일반 `staff`·`admin`에게 허용할 최소 메타데이터: case ID, category, 차단상태, assigned restricted reviewer 여부와 deadline만. URL·thumbnail·원문 hash는 숨긴다.
>
> 관계기관 신고·인계 조건: 법령상 의무 또는 생명·신체/아동 위험이 합리적으로 의심되면 지체 없이 지정 기관 절차로 인계한다. 일반 이메일 첨부 금지.
>
> 파기 조건: 인계 ack·법정 보전기간 또는 사건 종료 중 승인된 기준이 끝나면 원본 key를 파기한다. 최소 메타데이터는 최종 조치일부터 3년, 별도 hold 없으면 만료한다.

### 커뮤니티 정책 §5.3의 권리침해 처리 단계와 법정 기한을 그대로 시행해도 됩니까?

> 판단: **시행 절차로 승인.** 자연인 수령인·실제 연락경로와 운영 queue가 구현되기 전에는 Draft다.
>
> 수정할 단계·기한·통지 대상: 명예·사생활은 필요한 조치 뒤 신청인·게시자에게 지체 없이 통지하고 게시판에 공시한다. 저작권 재개요구는 접수일부터 3일 이내 정당성 판단, 정당한 경우 권리주장자에게 재개요구 사실·예정일 통지, 예정일은 접수 7~14일 사이로 한다.
>
> 명예·사생활 조치 사실의 게시판 공시 문구·시점·개인정보 최소화 기준: 조치 즉시 “권리침해 요청에 따라 이 콘텐츠를 임시로 제한했습니다. 사건번호와 이의 경로는 당사자에게 별도 안내됩니다.”만 표시한다.
>
> 저작권 중단요청서 사본·재개요구 안내 등 필수 첨부·안내: 게시자에게 redacted 중단요청서 사본·제출서류 목록·재개요구 form/기한/필요 소명을 제공한다.
>
> 적용 법령 또는 예외: 정보통신망법 제44조의2, 저작권법 제102·103조와 시행령 제41~43조. 더 엄격한 특별법/기관 명령이 있으면 우선한다.

## 작성물·legal hold·부정 이용

### 탈퇴자의 포스트 처리 기준을 관계별로 승인합니까?

> 타인 댓글이 없는 내 포스트 — **삭제.** text·tag·image·reaction·author link를 제거한다.
>
> 타인 댓글이 있는 내 포스트 — **중립 tombstone.** 타인 댓글의 문맥만 보존하고 본문·이미지·작성자 연결은 제거한다.
>
> tombstone에 남길 최소 필드·표시 문구: thread ID, 생성 순서/시각의 최소값, “탈퇴한 사용자의 삭제된 게시물입니다.”만.
>
> 탈퇴 전 일괄 삭제 기능 필요 여부: 필요. preview에서 대상 수·남을 댓글 링크를 제공한다.
>
> 근거: 작성자 개인정보·콘텐츠 통제와 다른 회원 댓글의 대화 맥락을 함께 보호.

### 타인 포스트에 작성한 탈퇴자의 댓글은 작성자 연결을 제거하고 본문을 유지해도 됩니까?

> 판단: **허용.** 다만 익명화 완료라고 표현하지 않는다.
>
> 삭제해야 하는 관계키·표시할 작성자명: user/profile ID·nickname·avatar·block/follow/reaction 연결을 제거하고 “탈퇴한 사용자”로 표시한다.
>
> 탈퇴 전 일괄 삭제 기능 필요 여부: 필요. 사용자가 본문 유지 대신 삭제를 선택할 수 있게 한다.
>
> 본문 유지 고지 문구: “다른 사람의 게시물에 남긴 댓글 본문은 계정 연결만 제거된 채 남을 수 있어요. 탈퇴 전에 직접 삭제할 수 있습니다.”
>
> 근거: thread 무결성과 이용자 사전 통제. 직접 식별정보는 후속 권리 경로로 제거한다.

### 유지되는 포스트·댓글 본문에 직접 식별정보가 있으면 어떤 사후 절차를 제공해야 합니까?

> 자동 redaction 대상: 명백한 이메일·전화·주민번호형 패턴은 preview 경고 대상으로 탐지하되 자동 본문 변조는 하지 않는다. 탈퇴 처리 시 선택한 삭제 대상만 확정적으로 지운다.
>
> 탈퇴 후 삭제·정정·권리침해 요청 경로: `/legal/rights-protection` 비로그인 form.
>
> 본인확인 방법·처리기한: 작성시점 account/content HMAC, 당시 연락채널 또는 최소 수동 심사; 개인정보 권리요청은 10일 이내 결과/지연 통지.
>
> 타인 권리와 충돌할 때 기준: 타인 댓글·증거 필요성을 고려해 직접 식별 부분만 redaction하거나 content를 비공개 보전한다. 공개 유지가 기본이 아니다.

### 탈퇴자의 사용자 업로드 객체를 관계없이 모두 삭제하는 안을 승인합니까?

> 판단: **승인.** 모든 bucket의 owner/path/DB reference를 함께 sweep한다.
>
> 포스트·댓글·프로필·기타 객체별 예외: 승인된 company catalog asset은 책임자를 이전한다. 개인 avatar·post/comment attachment·staging·legacy path는 삭제한다.
>
> 법정 보전이 필요한 경우의 격리·파기 조건: 사건 ID·근거·hold·review_at이 있는 최소 evidence만 별도 암호화 격리하고 일반 Storage 원본은 삭제한다.
>
> 삭제 완료 고지 문구: “서비스가 관리하는 업로드는 삭제했어요. 법령에 따라 별도 보전하는 최소 증거와 외부 처리자의 승인된 잔여기간은 별도로 안내합니다.”

### legal hold를 권한 있는 담당자의 명시적 해제 전까지 자동 파기하지 않는 안을 승인합니까?

현재안은 법적 근거, 사건 ID, 승인자, 다음 검토시각, 해제 승인자를 필수로 기록하고 검토일 경과만으로 hold를 해제하지 않습니다.

> 판단: **승인.** review 시각 경과는 경보이지 자동 해제가 아니다.
>
> 승인·해제 역할: legal-hold capability와 최고관리자. 설정과 해제는 서로 다른 승인 event로 기록한다. 제2 승인자가 없으면 새 hold를 만들지 않고 불가피한 기관 요청은 검증된 외부 법률 검토자를 제2 승인자로 지정한다. 이미 설정된 hold는 근거 종료 시 반드시 명시적으로 release·파기한다.
>
> 재검토 주기: 90일 또는 사건상 더 짧은 기한. 만료 7일 전·당일·경과 시 상향한다.
>
> 추가 통제: immutable 외부 event, encrypted linkage/key purge 정지, 범위 확대 금지, 기관/사건 종료 증거 뒤 명시적 release.

### 부정 이용 의심만을 이유로 별도 보존하지 않는 기본안을 승인합니까?

별도 anti-fraud 보존은 목적·대상·필드·기간·비교형량을 다시 승인한 경우에만 도입합니다.

> 판단: **승인.** 막연한 부정 이용 의심만으로 탈퇴 데이터를 남기지 않는다.
>
> 지금 필요한 예외: 결제 chargeback·계정 탈취·반복 환불처럼 실제 사건이 개설되고 구체적 위험이 있는 경우만.
>
> 예외의 필드·기간·근거: 사건 ID, 거래 HMAC ref, 정규화 risk code, 조치·시각만 90일. 법적 청구가 시작되면 별도 legal hold로 전환한다. IP·device fingerprint 원문 장기보존은 승인하지 않는다.

## 만 14세 미만 처리

### 생년월일 판정 전에 Auth 사용자와 이메일·최소 프로필을 생성하는 현재 가입 순서를 유지해도 됩니까?

> 유지 / 가입 전 연령 gate 필요: 현재 OAuth/email이 Auth를 먼저 만드는 구조는 **일시적으로 유지**하되 온보딩 첫 단계에서 DOB만 받아 즉시 판정하고 다른 profile·동의·팔로우를 쓰지 않는다. 더 나은 가입 전 gate는 provider UX 제약을 확인한 후 검토한다.
>
> 선행 수집의 법적 근거와 허용할 최소 필드: 가입 요청 처리와 연령 판정을 위한 Auth user ID·이메일·생년월일만. 마케팅·nickname·avatar·추천 follow 금지.
>
> 만 14세 미만 판정 시 삭제기한: durable request/fence를 즉시 만들고 새 이용을 차단한다. 외부 의무가 없으면 24시간 내 hard delete를 목표로 하며 실패는 멱등 재시도한다.
>
> 삭제 실패 중 허용할 최소 보존·접근: 암호화 subject, event ID, 연령 제한상태, retry code·시각만. 일반 앱 접근·메일 발송 금지.
>
> 필요한 가입 전 고지: “ICONS는 만 14세 이상만 가입할 수 있으며, 연령 확인 전에 이메일과 생년월일을 최소한으로 처리하고 대상이 아니면 계정을 삭제합니다.”

### 연령 판정 기준을 대한민국 시간대의 14번째 생일 당일부터 만 14세로 계산해도 됩니까?

> `Asia/Seoul` 달력일 기준 승인 / 수정: 승인. 14번째 생일 당일부터 허용하고 2월 29일생은 평년 3월 1일부터 허용한다.
>
> 해외 거주자·시간대 예외: v1은 대한민국 서비스 기준을 일관 적용하며 사용자 locale로 앞당기지 않는다.
>
> 생년월일 자가신고만으로 충분 / 추가 검증 필요: 자가신고는 candidate eligibility gate일 뿐 실제 연령확인 완료가 아니다. 보호 액션은 provider-neutral `verified_14_plus` assertion 전 fail closed한다.
>
> 추가 검증이 필요한 위험·시점·최소 자료: 최초 구매·예매·community write·게임·카드팩 개봉 전에 제3자 본인확인 사업자의 over-14 boolean·transaction ref·시각만 받는다. 미래/불가능 DOB, legacy 불일치, staff/admin은 `review_required`. 원 DOB·CI·신분증 원본은 받지 않는다.
>
> 근거: 개인정보보호법 제22조의2의 만 14세 미만 법정대리인 동의 부담을 회피하는 것이 아니라 해당 연령의 가입을 제공하지 않는 제품 제한.

### v1을 만 14세 이상으로 제한하고 법정대리인 동의 경로를 제공하지 않는 정책을 승인합니까?

> 판단: **승인.** 법정대리인 동의 경로를 제공하지 않는다.
>
> 필요한 고지 문구: “ICONS는 만 14세 이상만 이용할 수 있습니다. 입력한 생년월일로 1차 판정하고 보호 기능을 시작하기 전 최소한의 연령확인을 진행합니다. 결제 인증은 연령이나 법정대리인 동의 확인 수단이 아닙니다.”
>
> 시행 전 추가 조치: DB classifier·purpose RPC·보호/권리 matrix·기존계정 dry-run·법정문서 시행일·거절 삭제 worker를 같은 activation gate로 묶는다.
>
> 근거: 검증 인프라 없이 보호자 동의를 가장하지 않고 수집 범위를 최소화하기 위함.

### 신규 온보딩에서 만 14세 미만으로 판정되면 마케팅·보호 액션을 즉시 차단하고 durable 삭제 요청 후 계정·개인정보를 파기하는 안을 승인합니까?

> 판단: **승인.** durable fence ack 뒤 session·메일·보호 action을 즉시 차단한다.
>
> 삭제 전 보존할 수 있는 최소 항목: encrypted subject/key version, deletion event ID, underage restriction state, retry step/code, request/ack 시각. 원 DOB·이메일은 worker가 필요로 하는 최단시간만.
>
> 처리기한·실패 재시도 고지: “접근은 즉시 제한되며 계정 삭제는 보통 24시간 안에 처리합니다. 외부 처리·장애가 있으면 상태만 표시하고 완료라고 말하지 않습니다.”
>
> 근거: 법정대리인 동의 없는 추가 처리 확장을 막고 실패 시 계정이 다시 활성화되지 않게 함.

### 기존 만 14세 미만 계정은 새 보호 액션만 막고 기존 주문·티켓·환불·탈퇴·권리행사 경로를 유지하는 안을 승인합니까?

> 판단: **승인.** 기존 계정을 신규 거절과 동일하게 자동 삭제하지 않는다.
>
> 이용자·보호자 통지 방법: 로그인 시 상태 page와 인앱 알림. 실제 외부 연락처가 검증되면 등록 이메일에 generic 안내를 추가하되 계정 존재를 공개하지 않는다.
>
> 보존·파기 순서: 마케팅 false·새 mutation 차단 → 기존 거래/UGC/legal hold 집계 → 권리 경로 유지 → 사용자 탈퇴 또는 성년 도달 후 현재 문서 재동의.
>
> 근거: 이미 성립한 계약·환불·콘텐츠 통제·개인정보 권리를 연령 제한 때문에 박탈하지 않기 위함.

### 동의 receipt와 연령 수동심사 기록은 탈퇴 시 무엇을 얼마 동안 분리보존해야 합니까?

일반 서비스용 `private.consent_receipts`·`private.age_gate_reviews`·`private.age_assurance_receipts`는 탈퇴 시 삭제 또는 대상자 연결 해제가 기본입니다. 동의 사실의 법적 증명이 필요한 경우에만 최소 snapshot으로 분리하고, 정정 생년월일 provenance·reviewer 식별자·provider transaction-ref linkage를 제거합니다. 원본 신분증·CI·원 DOB·provider raw payload는 서비스 원장에 저장하지 않습니다.

> 보존할 최소 동의 항목과 법적 근거: terms/privacy document ID·version/hash, 필수/선택 항목, accepted_at, source, receipt ID. 동의 분쟁 대응 외 목적으로 사용하지 않는다.
>
> 기산점·`retain_until`: 일반 서비스 receipt와 assurance는 탈퇴 시 삭제한다. 실제 동의 분쟁/법적 청구가 있으면 사건 생성기록별 3년 내부 상한의 최소 snapshot만 별도 보존하고, 진행 중 청구는 case별 legal hold로만 연장한다.
>
> 조회·복호화·반출·파기 역할과 감사 요건: consent compliance function만 purpose-based 조회; 외부 반출 2인 승인. 현재 2인이 없으면 자동 반출 금지. 모든 조회/파기 audit.
>
> 정정 생년월일 provenance 파기 시점: 상태 결정·이의기간 30일 뒤 즉시, 진행 사건이면 close+30일. 원 DOB는 legal snapshot에 넣지 않는다.
>
> reviewer 식별자의 nullable 처리 / keyed HMAC 보존과 기간: 원 FK는 nullable. 감사가 필요한 경우 reviewer purpose-HMAC을 review 종료+1년 보존 후 파기한다.
>
> 원본 신분증·원문 증빙 수집 금지 승인 / 예외와 근거: **금지 승인.** 법령·기관이 특정 원본을 요구하는 별도 절차가 생기기 전에는 예외 없음.

## 시행과 고지

### 정책·약관 개정의 사전 고지 기간과 동의 재취득 범위는 무엇입니까?

> 문서별 고지 기간: 일반 변경 7일 전, 이용자에게 불리하거나 개인정보 목적·항목·권리·연령·유료조건의 중대한 변경은 30일 전.
>
> 개별 통지 대상: 계정 이용 가능 연령, 필수 동의, 처리 목적/국외이전, 유료조건·권리 제한이 바뀌는 기존 회원. 인앱+검증된 이메일을 사용한다.
>
> 재동의가 필요한 변경: 새 필수 개인정보 목적/항목, 선택동의를 필수화, 연령 제한 해제/보호자 경로, 기존 동의 범위를 넘는 콘텐츠/마케팅 이용. 단순 오탈자·법령 인용 정정은 재동의 불필요.
>
> 시행일 승인 절차: 코드·DB guard·문서 version/hash·notice·rollback이 같은 release manifest에 있고 Preview 회귀와 Production dry-run이 통과해야 최고관리자가 activation한다.

### 계정이 없어도 이용 가능한 권리행사·권리침해 접수 창구에 반드시 표시할 정보는 무엇입니까?

실제 전화·이메일은 [#87](https://github.com/icons-hq/icons-ip/issues/87)에서 별도로 확정합니다.

> 필수 담당자·연락처 표기: `ICONS 개인정보·권리보호 책임자` 역할, 검증된 업무 이메일/전화/우편 주소 또는 동일 효력의 접수 web form. 저작권법상 개인 성명이 필요하면 실제 지정 전 공개 시행 금지.
>
> 본인·대리인 확인 안내: 최소자료 단계심사, 대리권 확인 방법, 주민번호·신분증 전체사본 금지, 처리 목적·파기시점.
>
> 접수 확인·결과 통지 기한: 자동 접수번호 즉시, 개인정보 권리요청 10일 이내, 긴급 권리침해는 즉시 임시조치·일반 사건은 1영업일 분류/3영업일 1차결정. 법정 저작권 기한은 별도 우선.
>
> 공개해야 할 서식: 개인정보 열람·정정·삭제·처리정지, 명예/사생활 삭제요청, 저작권 중단·재개요구, 대리권, 이의·복원 서식과 처리 단계.

## Anything else?

### 시행 전에 추가로 검토하거나 제한해야 할 사항이 있습니까?

> 추가 제한: 실제 자연인 수령인·회사 연락처·부가통신사업 신고/면제 증거·처리자 DPA가 없으므로 정책은 구현 완료 뒤에도 해당 사실이 검증될 때까지 Draft다. community 신규 write, 공개 판매, Production 외부 메일·삭제원장은 각각 독립 kill switch를 기본 OFF로 둔다.

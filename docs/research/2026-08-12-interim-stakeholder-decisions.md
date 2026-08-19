# ICONS 미응답 정책·법무 질문의 임시 의사결정 근거

> **삭제원장 backend 정정:** 아래 GCP append service 서술은 2026-08-12 검토 시점 기록이다. 현행 방향은 운영 Supabase와 backup 계보가 분리된 **별도 Supabase compliance 프로젝트**다([`account-deletion-retention-policy.md`](../account-deletion-retention-policy.md) · [#215](https://github.com/icons-hq/icons-ip/issues/215)).

- 기준일: 2026-08-12 (KST)
- 상태: 내부 검토용 Research / 법률의견 아님
- 적용 범위: v1의 만 14세 gate, 동의 증빙, 탈퇴·보존, 커뮤니티 법정 절차, 직접 통신판매·OSP·표시광고, 이메일 처리자, 복원 독립 삭제원장
- 출처 원칙: 대한민국 법령·감독기관과 각 서비스 제공자의 공식 문서만 사용했다.

## 1. 결론

아래 안을 임시 기본값으로 채택하는 것이 가장 보수적이다.

| 주제 | 임시 결정 | 출시 조건 |
| --- | --- | --- |
| 만 14세 | v1은 만 14세 이상만 허용하고 법정대리인 동의 예외는 제공하지 않는다. 생년월일 서버 판정은 candidate gate이며, 현재 동의 receipt와 provider-neutral `verified_14_plus` assertion 전에는 보호 액션을 허용하지 않는다. | 본인확인 provider 계약·최소수집·callback, 미성년 거절·삭제 흐름이 없으면 출시 차단 |
| 동의 receipt | 약관·개인정보·선택 동의를 분리하고, 문서 버전과 수락 사실을 변경 불가능한 사건으로 남긴다. 과거 boolean을 receipt로 소급 생성하지 않는다. | 필수/선택 분리, 버전 registry, 재동의·철회·감사 테스트 |
| 탈퇴·보존 | 서비스 이용 개인정보는 지체 없이 파기한다. 다른 법률로 보존하는 최소 거래·사건 snapshot만 목적·기간·접근권한별로 분리한다. | 필드별 근거·기산점·만료 작업·복원 후 재삭제 검증 |
| 커뮤니티 | 일반 신고와 명예·사생활·저작권 등 법정 권리사건을 별도 queue·양식·통지·기한으로 처리한다. 정책은 담당자와 휴일 당직이 지정될 때까지 Draft다. | 공개 수령인, 주·부 담당자, 달력일 당직, 모의 사건 처리 |
| 사업자 지위 | ICONS가 자기 굿즈·티켓을 판매하는 범위에서는 직접 통신판매자다. NAVER 스마트스토어의 통신판매중개자 면책·Npay·판매자 전가 조항은 적용하지 않는다. | 실제 사업자 표시정보·통신판매업 신고·거래조건을 법무가 확인 |
| OSP | UGC 저장·노출 기능은 저작권법상 저장형 OSP일 가능성을 전제로 제103조 절차를 먼저 갖추되, 기능별 법적 유형은 법무가 확정한다. | OSP 유형, 수령인 공지 의무, 전기통신사업법상 지위 확인 |
| 표시·광고 | 상품·티켓 claim의 노출본과 근거를 별도 보존한다. 허위·과장·기만·부당 비교·비방 표현은 금지한다. | claim 승인자, 근거 자료, 노출 시작·종료 시각, 만료 파기 |
| 이메일 처리자 | Resend, Supabase, Vercel 및 Log Drain을 개인정보 처리자로 전제한다. 이메일에는 최소정보만 넣고 provider 응답을 실제 수신 증명으로 간주하지 않는다. | DPA·하위처리자·국외이전·요금제별 보존·삭제 경로 확인 |
| 삭제원장 | Supabase와 독립된 외부 durable ack가 복원 후에도 삭제 재실행의 기준이어야 한다. 후속 2026-08-12 내부 검토는 GCP append service + read-only verifier 경계를 채택했다. | 실제 GCP project·DPA·WIF/IAM, 외부 ack, snapshot catalog, restore/replay, hold/release, 만료 파기 drill |

개인 이름, 공개 연락처, 법인·통신판매업 신고정보, 매출·이용자 수, 실제 vendor plan·계약은 현재 문서만으로 확정할 수 없다. 이 값은 추정해 채우지 않고 각각 운영·법무·개인정보 책임자의 서명 항목으로 남긴다.

## 2. 역할별 임시 승인안

### 2.1 제품 책임자

1. v1의 대상 연령을 만 14세 이상으로 제한하고 법정대리인 동의 경로는 범위 밖으로 둔다.
2. 신규 사용자는 생년월일 판정 전에는 공개 탐색만 할 수 있다. 계정 생성이 기술적으로 먼저 일어나더라도 이메일 외의 선택정보를 받지 않고, 판정 실패 시 세션·recovery·보호 액션을 즉시 차단한 뒤 durable 삭제 요청을 시작한다.
3. 기존 미성년 의심 계정은 새 구매·작성·게임 등 보호 액션을 막되, 기존 주문·환불·티켓·탈퇴·열람·정정·권리구제는 막지 않는다.
4. staff/admin도 연령 예외를 두지 않는다. 업무 계정이 필요하면 소비자 계정과 별도 체계로 설계한다.
5. NAVER의 화면 문구나 중개자 역할을 복제하지 않는다. 계층형 정책 문서, 통합 접수, 단계형 제재 같은 구조·절차만 참고한다.

### 2.2 개인정보 책임자

1. 수집 전에 목적별 필수/선택 동의를 분리하고, 선택 동의 거절을 이유로 핵심 서비스를 거절하지 않는다.
2. 탈퇴 시 `삭제`, `익명화/연결 해제`, `법정 분리보존`, `사건별 legal hold`를 데이터 관계별로 구분한다.
3. “전자상거래법상 5년”을 이유로 전체 계정·프로필·배송지·raw webhook을 보존하지 않는다. 각 법정 기록을 재현하는 최소 snapshot만 보존한다.
4. 백업·PITR·clone·논리 export·분석 사본·로그를 전부 catalog에 넣고, 삭제 전 상태를 복원할 수 있는 모든 artifact의 만료와 외부 삭제원장 durable watermark·replay 범위를 관리한다.
5. 외부 처리자의 dashboard copy, suppression, log, backup, support access를 포함해 삭제 가능성 또는 자동 만료를 증명하지 못하면 “완전 삭제”라고 고지하지 않는다.

### 2.3 법무 책임자

1. 직접 판매자 전제와 실제 사업자 표시정보·통신판매업 신고정보를 확인한다.
2. 커뮤니티 기능별 저작권법상 OSP 유형, 전기통신사업법상 지위·신고 및 불법촬영물등 조치 의무 범위를 확인한다.
3. 명예·사생활 침해, 저작권 중단·재개, 수사기관 요청, legal hold의 양식·통지·달력일 기한을 승인한다.
4. 일반 신고·권리사건·거래 분쟁·광고 snapshot·동의 심사의 정확한 보존 근거와 기산점을 승인한다.
5. Resend·Supabase·Vercel·Google Cloud의 처리위탁, 국외이전, DPA, 하위처리자, 데이터 위치 고지를 승인한다.

### 2.4 운영 책임자

1. 일반 신고, 긴급 사건, 명예·사생활, 저작권, 수사기관, 복원 승인에 각각 주 담당자와 대체 담당자를 지정한다.
2. 법정 기한은 영업일 SLA와 분리해 달력일 기준으로 추적하고 휴일에도 queue를 확인한다.
3. `/legal/community`와 `/legal/rights-protection`에 실제로 응답하는 공개 연락처와 수령인 정보를 게시한다.
4. 불법촬영물등·아동·청소년 성착취물 원본을 일반 운영자가 복제·다운로드하지 않는 격리 절차를 훈련한다.
5. 월 1회 접수량·첫 조치 시간·기한 초과·복원·이의·접근기록·만료 파기 실패를 검토하고 승인 기록을 남긴다.

## 3. 만 14세 gate와 동의 receipt

### 3.1 법적 최소선

- 개인정보 보호법 제22조의2는 만 14세 미만 아동의 개인정보 처리에 동의가 필요한 경우 법정대리인의 동의를 받고 그 동의 여부를 확인하도록 한다. 동의를 받기 위한 법정대리인 이름·연락처의 최소정보만 동의 전에 수집할 수 있다. ([개인정보 보호법 제22조의2](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?ancYnChk=&chrClsCd=010202&lsJoLnkSeq=1029334873))
- 시행령 제17조의2는 휴대전화 통지, 카드정보, 서명 문서, 이메일, 전화 등 확인 방법을 열거한다. 단순히 아동이 “만 14세 이상” checkbox를 누르는 것은 법정대리인 확인 방식이 아니다. ([개인정보 보호법 시행령 제17조의2](https://law.go.kr/lsLinkCommonInfo.do?lspttninfSeq=182193))
- 동의는 구체적이고 명확하며 읽고 이해할 수 있는 방식이어야 한다. ([개인정보 보호법 시행령 제17조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1013462603))
- 개인정보보호위원회는 만 14세 미만 개인정보를 법정대리인 확인 없이 수집한 사업자를 제재했고, “만 14세 이상만 가입”하는 사업자도 실질적인 연령 확인 절차를 두도록 개선 권고했다. ([개인정보보호위원회 의결 보도자료](https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS074&mCode=C020010000&nttId=8776))
- 민법 제158조는 출생일을 산입해 연령을 계산하고, 법제처의 공식 해석례는 2월 29일생이 평년에는 3월 1일에 나이를 먹는다고 설명한다. ([민법 제158조](https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0158&lsiSeq=284415&urlMode=lsScJoRltInfoR), [법제처 해석례](https://www.moleg.go.kr/mpbleg/mpblegInfo.mo?mid=a10402020000&mn=03&mpb_leg_pst_seq=128993&yr=1992))

### 3.2 임시 구현 결정

- 기준 시각은 KST의 생년월일이며, 14번째 생일 당일부터 적격이다. 2월 29일생은 윤년 2월 29일, 평년 3월 1일부터 적격이다.
- 가장 안전한 순서는 `연령 화면 → 서버 판정 → 적격자만 Auth 가입/동의`다. Auth가 먼저인 현재 흐름을 잠시 유지하려면, 판정 전 수집을 가입 식별에 꼭 필요한 최소 이메일로 제한하고 부적격 판정 즉시 session/recovery fence와 외부 durable 삭제 요청을 수행해야 한다.
- 생년월일 자기기입과 서버 계산은 candidate gate이지 신원과 연령의 진실성을 증명하지 않는다. 후속 내부 결정은 최초 구매·예매·커뮤니티 작성·게임·카드팩 개봉 전에 provider-neutral `verified_14_plus`를 요구한다. provider 계약·DPA·서버 callback이 확인되지 않으면 보호 액션을 fail closed하며, 주민등록번호·신분증 원본·CI·provider raw payload는 ICONS가 직접 저장하지 않는다.
- v1 14+ 제한은 제품 범위 결정이지 법정대리인 동의를 대체하는 기술이 아니다. 향후 만 14세 미만을 허용하면 법정대리인 확인 경로를 별도 설계해야 한다.
- 수동 심사는 생년월일 불일치나 기존 권리 보존 같은 예외에만 사용하고, 심사자가 원본 신분증을 일반 저장소에 보관하지 않도록 한다.

### 3.3 receipt 계약

법령은 특정 DB schema를 명시하지 않는다. 아래는 동의 존재·내용·시점과 철회를 재현하기 위한 보수적 증빙 계약이다.

- `receipt_id`, `subject_id` 또는 최소 식별자
- 동의 항목·처리 목적·필수/선택 구분
- 약관/개인정보 문서의 불변 `version`, digest, 당시 공개 URL
- 서버 수락 시각, client source, age-policy version과 서버 판정 결과
- 마케팅 동의는 독립 receipt로 두고 기본값을 `false`로 한다.
- 철회·재동의는 기존 행 갱신이 아니라 별도 사건으로 남긴다.
- 과거 boolean을 근거 없이 불변 receipt로 backfill하지 않는다. `legacy_unknown`으로 두고 다음 보호 액션에서 재동의를 받는다.

탈퇴 때 서비스 이용 목적의 subject 연결과 수동심사 원본은 삭제한다. 분쟁·민원·법률상 보존 근거가 확정된 사건만 승인자·근거·만료일을 가진 최소 snapshot으로 분리한다. 모든 receipt를 일괄 장기보존하는 것은 승인하지 않는다. 개인정보가 아닌 문서 버전 registry는 계속 유지할 수 있다.

## 4. 탈퇴·법정 보존·복원

### 4.1 파기 원칙과 거래기록

- 개인정보 보호법 제21조는 보유기간 경과나 목적 달성으로 불필요해진 개인정보를 지체 없이 파기하고, 다른 법령 때문에 보존할 때는 다른 개인정보와 분리하도록 한다. ([개인정보 보호법 제21조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?ancYnChk=&chrClsCd=010202&lsJoLnkSeq=1020398651))
- 전자상거래법 시행령 제6조는 표시·광고 6개월, 계약 또는 청약철회 5년, 대금결제 및 재화 공급 5년, 소비자 불만 또는 분쟁처리 3년을 정한다. ([전자상거래법 시행령 제6조](https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1018638379))
- 개인정보 보호법 제16조에 따라 목적에 필요한 최소 개인정보만 수집해야 하고, 최소 범위를 넘는 정보 제공을 거절했다는 이유로 서비스 제공을 거절할 수 없다. ([개인정보 보호법 제16조](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029335671))

### 4.2 임시 보존 매트릭스

| 범주 | 보수적 최소 snapshot | 기간 | 임시 기산점 |
| --- | --- | --- | --- |
| 계약·청약철회 | order/ticket id, 상품·공연, 수량·가격, 계약/철회/취소 시각·상태 | 5년 | 계약 또는 철회 사건 발생 시각별 |
| 결제·환급·공급 | order id, 금액·통화, 승인/취소/환급 시각·상태, 공급·배송 사건 | 5년 | 각 결제·공급 사건 발생 시각별 |
| 소비자 불만·분쟁 | case id, 쟁점, 접수·조치·종결 시각, 결정 근거·결과 | 3년 | 최종 종결 시각을 임시값으로 사용하되 법무 확인 |
| 표시·광고 | 노출 claim, 상품/티켓, 가격·제한, 근거자료 digest, 노출 시작·종료 | 6개월 | 마지막 노출 종료를 임시값으로 사용하되 법무 확인 |

시행령은 기간을 정하지만 모든 필드와 모든 기산점을 정하지 않는다. 위 필드와 “최종 종결/마지막 노출 종료”는 개인정보 최소화에 맞춘 운영안이며 법무 서명 전에는 확정 법률 해석으로 고지하지 않는다.

다음은 기본적으로 법정 snapshot에 넣지 않는다.

- 전체 profile, 현재 배송지, 배송 메모, 전화번호 원문
- 토스 `paymentKey` 원문과 provider raw webhook 전체
- 주문 이메일 HTML·전문 또는 일반 runtime log
- 결제·배송과 무관한 커뮤니티 활동과 마케팅 이력

필요성이 입증된 값은 목적별로 별도 승인한다. 후속 권리행사를 위해 연락처 keyed HMAC을 쓰더라도 거래별 digest, key rotation·폐기, 추가 이메일 magic link/전화 OTP, 실패 시 수동 최소정보 심사를 함께 요구한다. digest 하나만으로 본인확인을 완료하지 않는다.

### 4.3 legal hold

- 단순한 “부정 이용 의심”은 보존 근거가 아니다.
- hold는 사건별 법적 근거, case id, 대상 object/row, 승인자, 설정 시각, 다음 검토일, 해제 조건을 가져야 한다.
- 자동 무기한 hold를 금지한다. 단, 명시적 해제 전 자동 파기는 막고 정기 재승인을 요구한다.
- 해제는 별도 감사 사건으로 남기고 본래 만료일이 지났다면 즉시 파기한다.
- 수사기관 보존요청과 법률상 제출금지는 통상 운영자에게 원문을 더 복제할 권한을 주지 않는다.

### 4.4 백업 복원

Supabase의 backup/PITR은 DB를 과거 시점으로 되돌릴 수 있고, project clone은 Database·Auth와 root encryption key를 복제할 수 있다. Storage는 database backup과 clone에 포함되지 않는다는 점도 별도 catalog가 필요하다는 뜻이다. ([Supabase Backups](https://supabase.com/docs/guides/platform/backups), [Supabase Clone Project](https://supabase.com/docs/guides/platform/clone-project))

따라서 “운영 DB에서 삭제됨”은 복원 독립 삭제 완료가 아니다. 다음을 출시 조건으로 둔다.

1. daily backup, PITR, logical export, clone, DR 사본, Storage, analytics, log drain을 포함한 snapshot catalog
2. 각 snapshot의 생성·만료·복원 가능 시각, 외부 원장 durable watermark와 삭제 전 상태 복원 가능 여부
3. cutoff 이전 snapshot 복원 거부 또는 격리 환경에서만 복원 허용
4. 모든 writer·job·queue·hook·webhook·callback·provider egress를 차단하고 stable event key의 lossless replay·잔여 0건·checkpoint ack 뒤 public traffic을 마지막에 재개
5. 보존 만료·hold 해제·provider expiry까지 포함한 drill 증거

### 4.5 탈퇴자의 작성물·업로드

다음은 법률에 적힌 일률 규칙이 아니라 개인정보 파기와 다른 이용자의 대화 맥락을 함께 보호하기 위한 임시 제품정책이다.

- 다른 회원 댓글이 없는 본인 포스트는 본문·태그·이미지·reaction·작성자 관계를 삭제한다.
- 다른 회원 댓글이 있는 본인 포스트는 thread 순서에 필요한 최소값과 중립 tombstone만 남기고 본문·이미지·작성자 관계를 삭제한다.
- 다른 회원 포스트에 쓴 댓글은 작성자 관계를 제거하고 “탈퇴한 사용자”로 표시한 뒤 본문을 유지할 수 있다. 이는 익명화 보장이 아니므로 탈퇴 preview에서 남는 댓글과 일괄/개별 삭제 선택을 제공한다.
- 유지 본문에 이메일·전화번호 등 직접 식별정보가 있으면 비로그인 `/legal/rights-protection`에서 사후 삭제·정정을 요청할 수 있게 한다. 타인 댓글이나 사건 증거와 충돌하면 공개 유지가 아니라 직접 식별 부분 가림 또는 암호화 비공개 보전을 우선 검토한다.
- avatar, post/comment attachment, staging, legacy path를 포함한 이용자 소유 Storage object는 모든 bucket의 owner·path·DB reference로 sweep한다. 회사 catalog 자산만 새 비개인 책임자에게 명시적으로 이전한다.
- 법정 보전이 필요한 업로드는 사건 id·근거·hold·review 시각이 있는 최소 evidence만 별도 격리하며 일반 Storage 원본을 관행적으로 복제하지 않는다.

이 선택은 탈퇴 전에 결과와 남는 본문을 명확히 보여주고, 탈퇴 후에도 계정 없이 접근 가능한 권리행사 경로가 실제 운영될 때만 시행한다.

## 5. 커뮤니티 법정 절차와 OSP

### 5.1 두 queue를 분리한다

| queue | 대상 | 임시 처리 원칙 |
| --- | --- | --- |
| 일반 운영 신고 | 스팸, 괴롭힘, 커뮤니티 규칙 위반, 일반 사기 의심 | 1영업일 분류·3영업일 1차결정은 내부 SLA일 뿐 법정 기한이 아님 |
| 법정 권리사건 | 명예·사생활 침해, 저작권 중단·재개, 불법촬영물등, 수사기관·법원 요청 | 법정 양식·증명·양 당사자 통지·달력일 기한·복원 요건을 별도 workflow로 적용 |

정보통신망법 제44조의2는 권리 침해를 주장하는 사람이 삭제·반박내용 게재를 요청할 수 있게 하고, 정보통신서비스 제공자가 필요한 조치를 지체 없이 하고 신청인과 정보게재자에게 즉시 알리도록 한다. 판단이 곤란할 때 임시조치는 30일 이내이며 절차를 약관에 명시해야 한다. ([정보통신망법 제44조의2](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029562697))

저작권법 제103조는 적법한 요청을 받은 해당 OSP가 복제·전송을 즉시 중단하고 요청자와 게시자에게 알리며, 정당한 권리의 counter-notice가 있으면 법정 절차에 따라 재개하도록 한다. ([저작권법 제103조](https://law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000979116)) 시행령은 공식 요청서·증명, 3일 이내 통지, counter-notice와 복원 시점 등 달력일 절차를 둔다. ([저작권법 시행령 제40조~제44조](https://law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=63336))

### 5.2 OSP·전기통신사업자 지위

저작권법 제102조는 서비스 기능에 따라 단순도관, caching, 이용자 지시에 따른 저장, 검색·연결 등 OSP 유형을 구분한다. ([저작권법 제102조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1029423289)) ICONS가 이용자 글·댓글·이미지를 저장하고 공개한다면 저장형 유형을 우선 가정해 제103조 절차를 구현하는 것이 안전하다. 다만 safe-harbor 충족과 유형은 기능·인지·통제·수익구조 사실에 따라 달라지므로 법무가 기능별로 확정해야 한다.

전기통신사업법상 부가통신사업 신고 여부와 불법촬영물등 유통방지 의무도 매출·이용자 수·서비스 유형에 따라 달라진다. 신고·변경·폐업 의무의 법률 근거는 제22조다. ([전기통신사업법 제22조](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031736197)) 불법촬영물등을 인지한 경우의 삭제·접속차단 등 의무는 제22조의5에 있고, 사전조치의 일부 대상 기준에는 전년도 매출액 10억원 이상 또는 일평균 이용자 10만명 이상 등의 조건이 있다. ([전기통신사업법 제22조의5](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029562969), [같은 법 시행령 제30조의6](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lspttninfSeq=162857))

매출·DAU·서비스 유형 사실이 없는 현재 단계에서는 적용/비적용을 단정하지 않는다. 임시로는 24/7 긴급 신고와 즉시 격리·상향을 제공한다.

### 5.3 접수·통지·보존 결정

- `/legal/rights-protection`에는 실제 법정 사건을 수령할 이름/부서, 우편주소, 전화·팩스 또는 이메일 등 법무가 승인한 공개 필드를 둔다. 존재하지 않는 담당자나 주소를 문서에 채우지 않는다.
- 명예·사생활·저작권 사건은 요청자·게시자에게 조치, 보완, 기각, counter-notice, 복원 결과를 각각 통지한다. 수사 방해·피해자 안전·법률상 비공개 사유가 있을 때만 승인자가 일부 유예·가림 처리한다.
- 저장형 OSP에 해당하지 않는 기능에 시행령상 게시자 통지 규칙을 그대로 확장할지는 법무가 결정한다. 임시 운영은 법률이 금지하지 않는 범위에서 양 당사자 통지를 더 엄격한 정책으로 적용한다.
- 일반 신고 raw 증거는 종결 후 30일 이의기간과 90일 운영 buffer를 임시 상한으로 제안하고, 이후 비식별 통계만 남긴다.
- 명예·사생활·저작권 사건의 최소 사건기록은 최종 조치 후 3년을 임시 상한으로 제안한다. 이는 민법 제766조의 불법행위 손해배상 단기 소멸시효를 참고한 내부 위험관리안이지 해당 플랫폼 기록의 법정 보존기간이 아니다. 10년의 외부 기간과 사건별 hold 적용 여부를 법무가 승인해야 한다. ([민법 제766조](https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1004360999))
- 불법촬영물등·아동·청소년 성착취물의 원본은 일반 증거 저장소에 복제하지 않는다. URL, 암호학적 digest, 신고·조치 시각, 조치 유형 등 최소 metadata만 남기고 원본 접근은 법무/수사기관 요구가 있을 때 시간 제한·2인 승인으로 격리한다.

담당자, 공개 연락처, 휴일 당직, 이해관계자 회피 대체자, 최종 복원 승인자가 지정되지 않으면 커뮤니티 정책은 계속 `Draft / 미시행`으로 둔다.

## 6. 직접 통신판매자·표시광고·NAVER 경계

전자상거래법 제13조는 통신판매자가 상호·대표자·주소·전화번호·이메일·통신판매업 신고번호 등을 표시하고, 공급 전에 거래조건을 알리며 계약내용 문서를 교부하도록 한다. ([전자상거래법 제13조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1027062829))

ICONS가 자기 재고의 굿즈와 자기 책임의 티켓을 판매한다는 현재 전제에서는 ICONS가 seller of record다. 결제·배송 외부사를 써도 판매자 책임이 NAVER 또는 결제사로 이전되지 않는다. 전자상거래법 제20조의 “통신판매의 당사자가 아님” 고지는 중개자의 고지이므로 ICONS 자체 판매 화면에 복제하지 않는다. ([전자상거래법 제20조](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1022341995))

표시광고법 제3조는 거짓·과장, 기만, 부당 비교, 비방 광고를 금지하고 시행령 제3조가 유형을 구체화한다. ([표시광고법 제3조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1029943741), [표시광고법 시행령 제3조](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900553990)) 따라서 상품·티켓별로 가격, 수수료, 수량·좌석·연령·지역 제한, 취소·환불, 공급일, 배송 claim과 substantiation을 승인 시점의 snapshot으로 보존한다.

NAVER·스마트스토어는 다음 구조만 참고한다.

- 서비스약관, 운영정책, 개인정보, 권리보호 절차를 계층화하고 서로 연결하는 방식 ([NAVER 서비스 이용약관](https://policy.naver.com/rules/service.html))
- 게시물·쇼핑·지식재산권 신고를 하나의 권리보호 진입점에서 분기하는 방식 ([NAVER 권리보호센터 안내](https://help.naver.com/service/30041/contents/22779?lang=ko&osType=COMMONOS))
- 안내·제한·정지 같은 단계형 제재와 긴급 예외를 문서화하는 방식 ([스마트스토어 이용정지 정책](https://safety.smartstore.naver.com/main/rules/safety/credit))

반대로 NAVER의 “통신판매중개자이며 거래 당사자가 아님”, Npay 결제 구조, 판매회원 책임 전가, NAVER 사업자 정보·기한·조직명은 복제하지 않는다.

## 7. 이메일 처리자와 로그

### 7.1 법적·계약 경계

개인정보 처리업무를 위탁하면 문서화, 목적 외 처리 금지, 보호조치, 공개, 수탁자 감독이 필요하다. ([개인정보 보호법 제26조](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025127467)) 국외 처리위탁·보관은 개인정보 보호법 제28조의8의 근거와 공개 또는 개별 고지 항목을 충족해야 한다. ([개인정보 보호법 제28조의8](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334953))

공식 문서에서 확인되는 범위는 다음과 같다.

- Resend DPA는 Resend를 processor로 두고 주 처리 위치를 미국으로 설명하며, 종료 후 customer/end-user data 삭제에 최대 90일을 둔다. 하위처리자 변경 통지는 14일 전이다. 이는 특정 수신자 이메일의 모든 사본이 즉시 삭제된다는 증거가 아니다. ([Resend DPA](https://resend.com/legal/dpa), [Resend Subprocessors](https://resend.com/legal/subprocessors))
- Resend는 일반 요금제의 email data를 30일 보관한다고 안내하지만 suppression 주소의 정확한 보존기간은 공개 문서에서 확정되지 않는다. content storage 비활성화는 적격 유료 team/add-on에 한정된다. ([Resend data retention](https://resend.com/docs/dashboard/webhooks/how-to-store-webhooks-data), [Resend suppressions](https://resend.com/docs/dashboard/emails/email-suppressions), [Resend content storage](https://resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend))
- Resend webhook은 at-least-once이며 중복·순서 역전이 가능하므로 `svix-id` 등 event id로 멱등 처리해야 한다. ([Resend Webhooks](https://resend.com/docs/webhooks/introduction))
- Supabase Send Email Hook은 built-in sender를 대체해 외부 provider 호출을 통제할 수 있다. ([Supabase Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook?language=http&queryGroups=language))
- Vercel runtime log 기본 보존은 plan/Observability 옵션에 따라 1시간, 1일, 3일 또는 30일 등으로 다르다. 실제 plan과 Log Drain이 별도 진실원이다. ([Vercel Runtime Logs](https://vercel.com/docs/logs/runtime))
- Vercel DPA의 데이터 삭제는 계약·서비스 맥락의 상업적으로 합리적인 절차이지, 특정 탈퇴자의 모든 runtime copy에 대한 즉시 삭제 API 보장이 아니다. ([Vercel DPA](https://vercel.com/legal/dpa))
- Supabase·Google Cloud도 DPA, 하위처리자와 처리 위치를 실제 계약·project 설정에 맞춰 검토해야 한다. Seoul region 선택은 지원·하위처리자까지 국내에만 있다는 뜻이 아니다. ([Supabase DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [Supabase Regions](https://supabase.com/docs/guides/platform/regions), [Google Cloud CDPA](https://cloud.google.com/terms/data-processing-addendum), [Google Cloud Subprocessors](https://cloud.google.com/terms/subprocessors), [Google Cloud Locations](https://cloud.google.com/about/locations))

### 7.2 임시 운영 계약

1. 주문·티켓의 상세 내용은 인증된 account page와 다운로드/인쇄 가능한 계약 문서에 둔다. 이메일은 order/ticket opaque id, 상태, 안전한 first-party link 중심으로 최소화한다.
2. 배송지 전체, 전화번호, 배송메모, `paymentKey`, raw provider 오류를 메일·runtime log에 넣지 않는다.
3. provider `2xx`, accepted, delivered event는 각각 API 처리·전송 사건일 뿐 사람이 계약서를 실제 읽었다는 증명이 아니다.
4. Send Email Hook 앞에 탈퇴·미성년·수신 목적 fence를 두고, production은 확인 실패 시 발송하지 않는다.
5. durable outbound intent는 idempotency key와 최소 상태만 보존한다. provider message id는 opaque locator로 취급하고 수신자·본문 원문은 삭제원장에 넣지 않는다.
6. open/click tracking은 별도 목적·법적 근거·고지·보존이 승인되기 전에는 비활성화한다.
7. 탈퇴 시 ICONS와 처리자의 관리 범위는 삭제/자동 만료로 정리하되, 이미 수신자의 mailbox에 도착한 사본은 수신자와 mailbox provider가 통제하므로 ICONS가 원격 삭제할 수 없음을 정확히 고지한다.

## 8. 복원 독립 삭제원장 후보

### 8.1 결정 경계

삭제 상태가 Supabase table에만 있으면 오래된 backup/PITR/clone 복원으로 삭제 전 계정과 “삭제 요청 없음” 상태가 함께 되살아날 수 있다. 따라서 외부 원장은 다음 interface를 만족해야 한다.

- 동일 `event_id`의 create는 멱등이고, 이미 존재하는 사건의 payload가 다르면 거부한다.
- backend는 외부 durable create/ack를 받은 뒤에만 irreversible hard-delete 단계로 진행한다.
- 복원 verifier는 외부 사건을 stable event key로 lossless replay해 복원 DB에서 다시 파기한다. replay 중에는 모든 writer·job·queue·hook·webhook·callback·provider egress를 막고 잔여 0건·checkpoint ack 뒤 public traffic을 마지막에 연다.
- 원장 실패는 삭제 완료로 처리하지 않고 retry 가능한 상태로 남긴다.

후속 내부 위험결정에서 2026-08-12 내부 검토로 GCP append service + 별도 read-only verifier 구조와 interface를 승인했다. 이는 실제 GCP project·billing·region·IAM 또는 Bucket Lock 활성화 승인이 아니며, 별도 인프라 변경과 Production-like drill 전에는 production ledger를 켜지 않는다.

### 8.2 권장 후보 구조

1. 채택 구조: GCP append service가 create 전용 작업을 수행하고 별도 read-only verifier가 복원 replay를 수행한다. Vercel에는 service invoke 권한만 주고 bucket read/write/retention 권한을 주지 않는다.
2. Vercel이 retention bucket에 `roles/storage.objectCreator`로 직접 쓰는 단순안은 앱 principal이 storage surface를 직접 아는 경계 때문에 채택하지 않았다. 이 역할은 object 생성은 가능하지만 조회·삭제·overwrite는 허용하지 않는다는 점만 비교 근거로 남긴다. ([Cloud Storage IAM roles](https://docs.cloud.google.com/storage/docs/access-control/iam-roles))
3. create에는 `ifGenerationMatch=0`을 사용한다. 같은 이름의 live object가 있으면 precondition failure가 되어 overwrite를 막고 재시도를 멱등화한다. ([Cloud Storage request preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions))
4. `core`에는 event id/type/state, opaque digest, 시간, generation만 둔다. subject·recipient·provider locator는 별도 암호화 `sensitive linkage`에 둔다. link 가능한 core도 개인정보일 수 있으므로 “익명”이라고 단정하지 않는다.
5. core/sensitive를 retention class별 bucket으로 나누고 재연결 가능한 core digest와 sensitive linkage는 record/subject별 DEK로 암호화한다. 공유 KMS KEK에는 wrapped DEK만 두고 raw 이메일·배송지·이름·전화·DOB·payment payload는 WORM object에 넣지 않는다.
6. sensitive linkage의 TTL은 단순히 Supabase 요금제의 backup TTL을 복사하지 않는다. 각 `purge_committed_at`보다 앞선 상태를 복원할 수 있는 모든 artifact의 `max(expires_at)`+최대 replay 지연+7일까지 유지한다. 미등록·expiry 미상 artifact와 catalog 변경은 fail closed하고 기존 TTL을 단축하지 않는다. 개인별 파기는 ciphertext·wrapped DEK·모든 recoverable generation을 제거하며 공유 KEK version을 개인별 파기 수단으로 쓰지 않는다.

### 8.3 WORM·hold·삭제 함정

- Bucket Lock은 retention policy를 영구 고정하고 기간을 줄이거나 제거하지 못하게 한다. retention 중 object·bucket·project 삭제가 막히고 lien이 생기며, 암호화 key version도 retention 전에 파기할 수 없다. 즉 잘못 잠그면 개인정보가 법정 필요기간보다 오래 삭제 불가능해진다. ([Cloud Storage Bucket Lock](https://docs.cloud.google.com/storage/docs/bucket-lock))
- legal hold에는 immutable `legal_hold_set`/`legal_hold_released` 사건과 GCS temporary hold를 함께 쓰는 안을 검토한다. 같은 case의 core와 sensitive linkage·envelope key·expiry job에 hold/release를 원자적으로 전파하고 일부만 해제되는 상태를 verifier가 차단한다. event-based hold는 해제 시 retention clock을 다시 시작하므로 무심코 사용하지 않는다. ([Cloud Storage object holds](https://docs.cloud.google.com/storage/docs/object-holds))
- soft delete를 `0`으로 바꿔도 기존 soft-deleted object는 기존 기간이 끝날 때까지 남는다. ([Disable soft delete](https://docs.cloud.google.com/storage/docs/disable-soft-delete))
- Object Versioning을 끄더라도 기존 noncurrent generation은 자동 삭제되지 않는다. ([Object Versioning](https://docs.cloud.google.com/storage/docs/object-versioning))

따라서 lock 전 test bucket에서 retention class·record/subject DEK·hold 설정/해제·만료 파기·lien·provider deletion caveat를 훈련한다. 활성화와 매 배포에 soft delete 0, versioning off를 read-back하고 drift alert하며, 모든 기존·신규 soft-deleted/noncurrent generation이 0건이거나 승인된 만료 일정을 가져야 한다.

### 8.4 WIF와 권한

정적 service-account key를 쓰지 않고 Workload Identity Federation과 immutable claim 조건을 사용한다. Google은 dedicated pool/project, attribute condition과 provider-specific audience를 권장한다. ([Google Cloud WIF](https://docs.cloud.google.com/iam/docs/workload-identity-federation), [WIF best practices](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation))

Vercel production token은 다음을 모두 exact match한다.

- issuer: 해당 Vercel team issuer
- audience: GCP provider에 지정한 고유 audience; custom audience를 쓰지 않으면 Vercel 기본 audience를 그대로 명시
- subject: `owner:<TEAM>:project:<PROJECT>:environment:production`
- claims: `owner_id`, `project_id`, `environment=production`
- Preview/Development deny

Vercel의 공식 claim 형식과 GCP federation 절차를 기준으로 실제 team/project ID를 배포 시 주입한다. ([Vercel OIDC reference](https://vercel.com/docs/oidc/reference), [Vercel OIDC with GCP](https://vercel.com/docs/oidc/gcp), [Vercel custom OIDC audiences](https://vercel.com/changelog/custom-oidc-token-audiences))

service account는 `invoke`, `append`, `verify/read`, `restore/decrypt`, `expiry purge`, `hold`, `break-glass/lien`으로 분리한다. production backend가 verify/read, retention 변경, key destroy, hold release를 겸하지 않는다. hold/release와 break-glass는 2인 승인과 별도 감사가 필요하다.

### 8.5 완료 기준

다음을 모두 통과하기 전에는 탈퇴·이메일 이슈를 “복원 독립 완료”로 닫지 않는다.

1. 모든 snapshot class·artifact expiry·durable ledger watermark catalog 승인
2. 외부 create/ack 장애·중복·payload conflict test
3. backup 복원 중 모든 writer·egress 격리, lossless event replay, checkpoint ack와 마지막 traffic gate test
4. core/sensitive 각각의 retention 만료·record/subject DEK·provider purge test
5. legal hold set/release와 연체 hold review test
6. soft-deleted/noncurrent object inventory와 자동 만료 검증
7. exact WIF claim·Preview deny·IAM 권한 상승 test
8. DPA·하위처리자·국외이전·region 고지 승인

## 9. questionnaire에 반영할 답

### 9.1 제품·기술 결정 확인서

- `#188 만 14세 gate`: 14+ only, 평년 2월 29일생은 3월 1일 age-out, 신규 미성년은 즉시 fence+durable 삭제, 기존 계정은 새 보호 액션만 차단하고 권리는 보존, staff/admin 예외 없음으로 임시 승인한다.
- 다섯 연령 상태와 receipt backfill: `eligible`, `underage_rejected`, `legacy_unknown`, `manual_review`, `age_out_reconsent_required`처럼 명시 상태를 유지하되 이름은 구현 spec에서 확정한다. 과거 동의 receipt는 합성하지 않는다.
- `#137/#191`: 외부 durable ack requirement는 승인하되 GCS 구현은 별도 ADR·인프라 issue 후 결정한다. ADR → phase 1/infra 병행 → backend/restore drill 순서를 유지한다.

### 9.2 탈퇴·커뮤니티 정책 법무 확인서

- 직접 판매자·정책 계층화: `예`. 다만 실제 법인/대표/주소/연락처/신고번호는 법무가 확인한다.
- 전기통신사업·OSP 유형·제103조 수령인: `법무 사실확인 전 미확정`. 저장형 OSP를 보수적으로 가정해 절차는 준비하고 공개 수령인은 실명·연락처 확정 뒤 게시한다.
- 거래·티켓·광고·불만 기록: 제4.2의 최소 snapshot을 임시안으로 사용하고 기산점·세부 필드는 법무가 승인한다.
- 이메일: Send Email Hook + durable intent + 발송 전 fence는 `승인`. 외부 사본의 즉시 삭제를 약속하지 않고 실제 plan/DPA/보존을 확인한다.
- 배송 이메일: 전체 배송지·전화·배송메모는 기본 제외한다. 인증된 주문 화면에서 제공한다.
- runtime log: allowlist와 요금제/Drain별 TTL을 고정하고 raw 개인정보를 기록하지 않는다.
- payment key·배송지: 원문 장기보존은 기본 `아니오`; 사건별 필요성과 대체 식별자를 법무/결제 책임자가 승인한다.
- 커뮤니티 기록: 일반 신고와 법정 사건을 분리한다. 제5.3의 기간은 내부 임시 상한이며 법정 기간으로 표현하지 않는다.
- 불법촬영물등 원본 일반 저장 금지: `승인`.
- legal hold: 사건별 명시 hold/release·정기 review 조건으로 `승인`; 의심만으로 blanket hold하지 않는다.
- 가입 순서: pre-auth age gate로 전환을 권고한다. auth-first를 유지하는 동안에는 최소수집·즉시 fence+삭제가 출시 조건이다.
- 동의 receipt/수동심사: 탈퇴 시 기본 삭제하고 법적 근거가 있는 사건의 최소 snapshot만 만료일과 함께 분리한다.

### 9.3 커뮤니티 운영 승인 확인서

다음 값은 조직 사실이므로 research로 채울 수 없다.

- 최종 운영 책임자, 매일 확인 1차 담당자, 야간·휴일 당직
- 명예·사생활 및 저작권 사건의 주·부 담당자
- 법무·수사기관 상향 담당자와 이해관계 회피 대체자
- 공개 이메일/전화/우편주소와 복원 최종 승인자
- 월간 점검 승인자·보관 위치·공개 시행 승인자·목표일

모두 지정되고 실제 연락 테스트와 휴일 모의훈련을 통과할 때까지 `docs/community-moderation-policy.md`는 Draft로 유지한다. 일반 신고 SLA는 내부 목표이고, 법정 권리사건은 법무가 승인한 달력일 timer를 별도로 사용한다.

## 10. 출시 전 서명 체크리스트

### 제품

- [ ] 14+ only/no-parental-consent scope와 기존 계정 권리 경계 승인
- [ ] DOB gate 위치, KST/윤일, 재동의 상태 승인
- [ ] 직접 판매자 화면과 공개 탐색/보호 액션 경계 승인

### 개인정보

- [ ] 데이터별 삭제·연결해제·분리보존·hold matrix 승인
- [ ] consent receipt와 legacy 처리 승인
- [ ] processor/국외이전 공개와 backup catalog 승인

### 법무

- [ ] 법인·통신판매업 정보와 거래조건 확인
- [ ] 전기통신사업·OSP 유형과 권리보호 수령인 확인
- [ ] 거래/광고/커뮤니티 기록 필드·기산점·기간 승인
- [ ] 법정 양식·통지·달력일·legal hold 승인

### 운영·보안

- [ ] 공개 연락처, 주·부 담당자, 24/7 긴급 경로 확인
- [ ] 불법촬영물등 격리와 이해관계 회피 훈련
- [ ] 외부 원장 restore/replay/expiry/hold/WIF drill
- [ ] 실제 vendor plan, retention, log drain, subprocessor inventory read-back

위 항목의 사람·연락처·계약·법적 지위가 비어 있으면 NAVER 문구로 대신 채우지 않는다. 해당 기능을 Draft 또는 fail-closed 상태로 유지한다.

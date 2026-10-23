# 성인 인증(NHN KCP 휴대폰 본인확인 V2) 운영 런북

19금 굿즈 구매를 위한 성인 인증의 설정·검증·개방·롤백 절차다. 결정과 근거는
[ADR-0024](../adr/0024-adult-verification-kcp.md)에 있다.

> 이 저장소는 공개다. KCP 사이트코드·웹사이트코드·가맹점 인증키(ENC_KEY), KCP 샘플 소스,
> 테스트 인증키, 본인확인 결과 값은 저장소·이슈·PR·로그·명령 인자에 남기지 않는다.

## 현재 상태

- 코드와 DB는 배포돼도 **닫혀 있다.** 공개 스위치와 canary가 비어 있으면 인증을 시작할 수 없고,
  증거가 없으니 19금 굿즈 구매 경계도 그대로 닫혀 있다.
- 상점관리자 설정 상태(2026-10-23 확인):
  - 인증결과URL: `https://iconsip.com/` 등록됨, "설정함".
  - 신규 연동방식(V2) 사용여부: **미전환.** 전환은 되돌릴 수 없어 운영 개방 직전에 한다.
  - 가맹점 인증키: **미발급.** 발급에는 대표 상점ID에 등록된 휴대폰 본인인증이 필요하다.
- 테스트 서버(`testcert.kcp.co.kr`)에서 우리 암호 구현으로 거래등록이 `0000`으로 성공했다.

## 흐름

1. 마이 › 성인 인증(`/my/adult-verification`)에서 시작한다. 서버 액션이 세션 행을 만들고 KCP
   거래등록을 한 뒤 인증창 주소·거래등록키만 브라우저에 준다. 데스크톱은 팝업, 그 밖은 페이지 전환이다.
2. KCP 인증창이 `/api/identity/kcp/return/<nonce>`로 결과를 POST한다(Ret_URL). 처리기는 nonce
   다이제스트 + 거래등록키로 세션을 선점하고, KCP 결과조회·복호화로 성인 여부만 판정해 보류한다.
3. 같은 브라우저가 `/api/identity/adult/complete/<nonce>`로 돌아온다. 로그인 세션이 세션 주인과
   같을 때만 DB가 증거를 확정한다. 결과 화면은 `/my/adult-verification/result`다.

## 환경변수

| 이름 | 설명 | Production | Preview·로컬 |
| --- | --- | --- | --- |
| `KCP_CERT_MODE` | `production` 또는 `test` | `production` | `test` |
| `KCP_CERT_SITE_CODE` | KCP 사이트코드(5자리) | 계약 사이트코드 | KCP 공용 테스트 사이트코드 |
| `KCP_CERT_ENC_KEY` | 가맹점 인증키 | 상점관리자에서 발급 | KCP 샘플의 테스트 키 |
| `KCP_CERT_WEB_SITE_ID` | DI 발급 기준 웹사이트코드(12자리) | **필수** | 생략 가능 |
| `ADULT_VERIFICATION_DIGEST_SECRET` | DI·거래번호 HMAC 비밀값(32자 이상) | 새로 생성, **바꾸지 않는다** | 환경별 임의값 |
| `SITE_URL` | Ret_URL origin | `https://iconsip.com` | https 또는 로컬 개발 호스트 |
| `ADULT_VERIFICATION_ENABLED` | `true`면 모든 회원에게 개방 | 개방 시점에 `true` | QA 때만 |
| `ADULT_VERIFICATION_CANARY_USER_ID` | 공개 전 단일 canary 계정 UUID | canary 때만 | 선택 |

- 환경과 모드는 짝이 맞아야 한다. Production은 운영 모드만, Preview·로컬은 테스트 모드만 받는다(ADR-0006).
  어긋나거나 값이 비면 설정 전체가 닫힌다.
- Production은 공용 테스트 사이트코드를 거절하고 웹사이트코드를 요구한다.
- 비밀값은 사람이 Vercel에 직접 등록한다. 값을 채팅·이슈·PR에 붙이지 않는다.
- `ADULT_VERIFICATION_DIGEST_SECRET` 예: `openssl rand -base64 48`.

## 상점관리자 설정 (본인확인 계약 계정)

메뉴는 본인확인 계약 계정으로 로그인해야 보인다(PG 계정에서는 "휴대폰 본인확인서비스 이용 가맹점만 접근 가능").

1. **가맹점 인증키 발급** — 기술관리센터 › 인증센터 › 가맹점 인증키관리. 대표 상점ID에 등록된 휴대폰으로
   본인인증 후 발급된다. 재발급은 심사를 거친다.
2. **신규 연동방식(V2) 사용** — 부가서비스 › 휴대폰본인확인 › 연동방식 설정 › 사용여부 변경하기.
   전환 완료일을 고른다. **"사용"으로 바꾸면 "미사용"으로 되돌릴 수 없다.** 신규 가맹점은 V2만 쓰므로
   잃는 것은 없지만, KCP 안내대로 테스트를 마치고 운영 개방 일정에 맞춰 바꾼다.
3. **인증결과URL** — 부가서비스 › 휴대폰본인확인 › 인증결과URL 설정. `https://iconsip.com/`이 기본 등록돼 있다.
   `www` 등 다른 호스트로 Ret_URL을 보내면 그 도메인을 추가한다. 등록·삭제는 실시간 반영이 아니므로
   바꿀 때는 추가 후 삭제한다.
4. 샘플·가이드: 연동방식 설정 화면의 "V2 연동 샘플 다운로드"(개발지원센터로 이동). 받은 샘플은 로컬에서만 본다.

## 검증

### DB

```bash
docker exec -i <격리 DB 컨테이너> psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/adult_verification.sql
```

### 로컬 E2E (테스트 서버)

1. 격리 스택을 띄우고(`SUPABASE_WORKDIR`) 저장소 밖 env 파일에 테스트 모드 값과 `SITE_URL=http://<이름>.localhost:<포트>`,
   `ADULT_VERIFICATION_ENABLED=true`를 둔다. 테스트 인증키는 KCP 샘플에서 읽는다.
2. `npm run build:local` → `npm run start:local -- -H 127.0.0.1 -p <포트>`.
3. 로컬 테스트 계정으로 로그인해 `/my/adult-verification`에서 인증한다. 휴대폰 인증은 사람이 한다.
4. 결과 화면과 `private.adult_verifications`의 행(판정·만료·해시만 있는지)을 확인한다.

## 개방 순서

1. 개인정보처리방침 개정 시행(아래 초안) — 시행 전에는 공개 스위치를 켜지 않는다.
2. 상점관리자: 인증키 발급 → V2 사용 전환.
3. Vercel Production env 등록(위 표) → 새 Production 배포 → 설정 readback(설정 여부만, 값은 출력하지 않는다).
4. canary: `ADULT_VERIFICATION_CANARY_USER_ID`에 내부 계정 하나 → 배포 → 실제 휴대폰으로 인증 → 결과·DB 확인.
5. 공개: `ADULT_VERIFICATION_ENABLED=true` → 배포.
6. 19금 판매 개방은 별도 트랙이다(가림 카드·상세 게이트·주문 서버 게이트, 코페이 gate). 이 런북만으로 구매가 열리지 않는다.

## 롤백

- `ADULT_VERIFICATION_ENABLED`를 지우고(또는 `false`) 배포하면 새 인증 시작이 닫힌다.
- KCP 콜백 처리는 공개 스위치가 아니라 설정 여부를 본다 — 이미 인증창에 들어간 사용자의 결과는 끝까지 처리된다.
  설정 env까지 지우면 진행 중이던 인증은 invalid로 끝난다.
- 이미 생긴 증거는 남는다. 증거 일괄 해제가 필요하면 별도 migration으로 `revoked_reason='operator'`를 기록한다.

## 운영 메모

- 비용·트래픽: 기본 제공 건수를 넘으면 다음 달 청구된다. 이벤트로 트래픽이 몰릴 때는 시작 3~5일 전 KCP에 공유한다.
- 장애·문의: KCP 1666-6410(내선 1), 기술지원 support@kcp.co.kr, 응답코드 https://developer.kcp.co.kr/code/error.
- 인증 시작 한도: 계정당 1시간 10회·하루 30회. 세션은 30분 뒤 만료되고, 같은 계정의 새 시작은 이전 세션을 닫는다.
- 결과 코드: 세션 `result_code`에 `kcp_window_<코드>`(인증창 실패)·`kcp_result_<코드>`(조회 실패)·`kcp_result_decrypt` 등이 남는다.

## 개인정보처리방침 개정 초안 (법무 확인 후 시행일과 함께 반영)

- 제1조 표에 행 추가 — 구분 "성인 인증(휴대폰 본인확인)": 본인확인기관(NHN KCP)이 인증 결과로 전달하는 이름, 생년월일,
  성별, 내·외국인 구분, 휴대폰번호, 통신사, 연계정보(CI), 중복가입확인정보(DI). 19세 이상 여부 판정에만 쓰고 저장하지 않으며,
  회사는 인증 여부·인증 일시·유효기간과 중복가입확인정보·인증 거래번호를 복원할 수 없게 변환한 값만 보관한다.
  수집 시점: 회원이 19금 굿즈 이용을 위해 성인 인증을 진행한 경우.
- 제2조 목록에 추가 — 청소년 보호법에 따른 19세 이상 여부 확인(19금 굿즈 열람·구매 자격 관리)과 한 명의로 여러 계정을
  인증하는 부정 이용 방지.
- 제5조 위탁 표에 행 추가 — 엔에이치엔케이씨피 주식회사: 휴대폰 본인확인(성인 인증) 서비스 제공, 위탁계약 종료 시까지.
- 성인 인증 기록은 회원 탈퇴 시 함께 파기된다(제3조 일반 원칙). 유효기간은 인증일부터 1년이다.

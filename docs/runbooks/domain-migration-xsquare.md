# 운영 도메인 전환: iconsip.com → xsquare.kr

운영 도메인을 `iconsip.com`에서 `xsquare.kr`로 옮기는 절차다. 코드의 운영 도메인 단일 출처는
[`lib/site-domains.mjs`](../../lib/site-domains.mjs)다.

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | DNS를 Cloudflare로 옮기고 Vercel에 임시 연결 | 완료(2026-11-18) |
| 1 | 두 도메인 병행 준비(코드·Auth 리디렉션·메일 발신 도메인) | 완료(2026-11-18, PR #675) |
| 2 | 외부 서비스·PG·법정 신고 등록(사람) | 기술 항목 완료, 법정·계약 신고는 아래 체크리스트 |
| 3 | 전환(정규 주소·env·리디렉션 방향 교체) | 2026-11-25 |
| 4 | 정리(문서·옛 도메인 유지 기간) | 문서는 3단계 PR에 포함, 옛 도메인은 최소 1년 유지 |

## 결정과 제약

- `.kr`은 KISA 인증을 받은 국내 등록대행자만 등록할 수 있다. Cloudflare Registrar와 Vercel 모두
  `.kr` 등록·이전을 지원하지 않는다(2026-11-18 각 공식 TLD 목록 확인). 그래서 **등록은 후이즈에 두고
  DNS만 Cloudflare로 옮겼다.** 후이즈는 만료일(2030-03-25) 연장과 네임서버·등록인 정보 변경에만 쓴다.
- 후이즈의 네임서버 변경은 **등록인 2단계 인증**(등록인 이메일 또는 휴대폰 인증번호)이 필요하다.
  등록인 연락처를 확인할 수 없으면 등록정보 변경부터 해야 한다.
- DNS는 `iconsip.com`과 같은 Cloudflare 계정의 존이다. Vercel 앞에는 Cloudflare 프록시를 두지 않는다
  (모든 레코드 DNS only).
- 같은 후이즈 계정의 `x-square.kr`(하이픈)은 이 절차 범위 밖이다.

## 0단계 결과(현재 구성)

Cloudflare `xsquare.kr` 존(네임서버 `rick.ns.cloudflare.com`·`wanda.ns.cloudflare.com`):

| 타입 | 이름 | 값 | 용도 |
|---|---|---|---|
| A | `xsquare.kr` | `216.150.1.1`, `216.150.16.1` | Vercel(권장 1순위 값) |
| CNAME | `www` | `c26854343e2059c1.vercel-dns-017.com` | Vercel |
| TXT | `resend._domainkey` | Resend 발급 DKIM 공개키 | 메일 서명 |
| CNAME | `send` | `send.forge.rmta.net` | Resend 반송 경로(SPF) |
| CNAME | `rsend` | `rsend-apne1.forge.rmta.net` | Resend 발신(SPF) |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | DMARC(관찰 모드) |

- Vercel 프로젝트 `icons-ip`에 `xsquare.kr`·`www.xsquare.kr`가 붙어 있고, **전환 전까지는 경로를 유지한 채
  `iconsip.com`으로 307 리디렉션**한다. 반쯤 동작하는 사이트가 새 도메인으로 노출되지 않게 하려는 것이다.
- Resend에 `xsquare.kr`를 Forge·도쿄(ap-northeast-1)로 추가했고 2026-11-18 검증을 마쳤다(발신 가능).
  받는 메일(`Enable receiving`)은 켜지 않았다.

## 1단계: 두 도메인 병행 준비

정규 주소와 운영 `SITE_URL`은 계속 `https://iconsip.com`이다. 이 단계에서 바뀌는 것은 "새 도메인을 받아도
깨지지 않게" 하는 것뿐이다.

- `lib/site-domains.mjs`가 운영 도메인 목록(`iconsip.com`·`xsquare.kr`)과 정규 주소를 정한다.
- 운영 `SITE_URL` 검사(결제 게이트웨이 준비 상태, KCP Ret_URL, 정기결제 콜백, Vercel 빌드 env 검사)는 두 도메인의
  **루트 origin**을 받는다. `www`는 받지 않는다 — PG·KCP에 등록하는 주소가 루트다. 이 검사가 이전처럼
  `iconsip.com` 하나만 받으면, 3단계에서 env만 바꿨을 때 결제와 성인 인증이 스스로 꺼진다.
- 로그인·메일 링크 허용 출처는 두 도메인의 루트와 `www`를 받는다.
- 어드민 "URL로 추가"는 두 도메인과 그 하위 호스트의 상품 주소를 받는다.
- Supabase Auth 리디렉션 허용 목록(`pipeline.yml`의 `REDIRECT_URLS`)에 `xsquare.kr`·`www.xsquare.kr`의
  `/auth/callback`·`/auth/recovery/callback`을 추가했다. main 배포 때 동기화된다.

## 2단계: 외부 등록(사람)

웹훅을 보내는 서비스와 서버 간 호출은 대개 리디렉션을 따라가지 않는다. Node `fetch`처럼 따라가더라도 **교차 출처
리디렉션에서 `Authorization` 머리글을 버린다**(fetch 표준). 그래서 3단계에서 옛 도메인을 308로 돌리는 순간 아래
"전환 직후 교체" 항목은 옛 주소로 오면 실패한다. Vercel Cron은 커스텀 도메인이 아니라 배포의 `*.vercel.app` 주소를
부르므로 영향이 없다.

전환 전에 끝낼 것:

- [x] **Resend**: `xsquare.kr` 발신 도메인 검증(2026-11-18), 루트 SPF(Apple 릴레이용) 추가.
- [x] **Apple**: Email Sources에 `xsquare.kr`·`send.`·`rsend.` 등록(2026-11-18). Services ID `com.iconsip.web`은
      Supabase 도메인만 쓰므로 `xsquare.kr` 등록이 필요 없다.
- [x] **카카오 developers**: `iconsip.com`을 등록한 곳이 없다(로그인 리다이렉트는 Supabase 콜백, JS SDK·제품 링크
      도메인 비어 있음). 앱 소유자는 회사 계정 `playxmd@kakao.com`(2026-11-18 이전).
- [x] **Turnstile**: 위젯 `xsquare-auth`의 호스트에 `iconsip.com`·`xsquare.kr`가 모두 있다(하위 도메인 포함).
- [x] **Search Console**: `xsquare.kr`·`iconsip.com` 도메인 속성 DNS TXT 확인(2026-11-18, 계정 `sangwopark19icons`).
- [x] **KCP 휴대폰본인확인**: 인증결과URL에 **도메인 형식** `xsquare.kr`를 추가했다(2026-11-25, 저장 뒤 재조회로 확인).
      프로토콜을 붙인 주소만 있으면 운영 거래등록이 `CS13`으로 실패하고, KCP는 등록이 실시간 반영이 아니라고 안내한다.
      [kcp-adult-verification.md](kcp-adult-verification.md).
- [x] **Resend 키**: Resend 키는 발신 도메인에 묶여 있다(`icons-ip-app-transactional`은 `iconsip.com` 전용). 앱 메일용
      `icons-ip-app-transactional-xsquare`(sending, `xsquare.kr` 전용)를 새로 만들었다(2026-11-25).
      [transactional-email.md](../transactional-email.md).

주소 교체(옛 주소는 308이 되어 받지 못한다). 3단계 1번 뒤에는 `xsquare.kr`가 같은 앱을 직접 서비스하므로 **옛 도메인
308 전에** 바꿀 수 있고, 그러면 끊기는 틈이 없다. 2026-11-25에는 1번 직후 이렇게 했다:

- [x] **토스페이먼츠 웹훅**: 개발자센터에는 주소 수정이 없어 새로 등록 후 옛 항목을 지웠다. MID `iconsi0xvd`(라이브·테스트)
      모두 웹훅 `xsquare-ICONS` 하나(`https://xsquare.kr/api/webhooks/tosspayments`, `PAYMENT_STATUS_CHANGED`·`DEPOSIT_CALLBACK`)만
      남겼다. 옛 테스트 항목 `iconsip`(옛 공유 MID `gsangwbzqu`)은 ICONS 상점 것이 아니라 두었다. 놓친 결제 상태는 10분마다
      도는 결제 재정합이 따라잡는다.
- [x] **카카오 계정 상태 변경 웹훅**: `https://xsquare.kr/api/webhooks/kakao/account-status`(User Unlinked만, Editor 계정으로 수정).
      [kakao-account-unlink.md](kakao-account-unlink.md).
- [x] **Resend 웹훅**: 기존 웹훅(이벤트 7개)의 주소만 `https://xsquare.kr/api/webhooks/resend`로 고쳤다(새로 만들면 서명
      비밀값이 바뀐다). 이 웹훅은 Resend 계정 전체 이벤트를 받는다.
- [ ] **AX ERP 연동**: AX 서버 `infra/.env`의 `MALL_ERP_URL=https://xsquare.kr`로 바꾸고 재시작(사람 — AX 서버 설정).
      옛 주소로는 Bearer 토큰이 리디렉션에서 빠져 401이다. 이어 읽기 커서가 있어 늦게 바꿔도 몰 데이터를 잃지 않는다.
- [x] **Supabase Auth custom SMTP**: 발신 주소를 `no-reply@xsquare.kr`로 바꾸고(2026-11-25), SMTP 비밀번호로 쓰는 기존 키
      `icons-ip-supabase-auth`의 Resend 도메인 제한을 `iconsip.com`에서 `xsquare.kr`로 고쳤다. 비밀값을 다시 넣지 않아도 되는
      방법이다. 둘이 어긋나면 가입 확인·재설정 메일이 실패하므로 연달아 바꾼다.

법정·계약(기술 전환을 막지 않음, 사람):

- [ ] **통신판매업 신고**(신고번호 `2025-서울마포-1494`, 관할 마포구): 인터넷 도메인 변경 신고. 정부24
      '통신판매업 변경신고'는 온라인이면 **본인(법인)만, 대리인 불가**라 법인(대표) 공동인증서로 로그인해야 한다.
      수수료 없음·처리 3일, 신고증 기재사항이 바뀌면 기존 신고증 원본(또는 분실확인서)을 낸다. 지금 신고된 도메인은
      공정위 사업자정보(`ftc.go.kr/bizCommPop.do?wrkr_no=1098627576`, 보안문자)에서 확인한다. 2026-11-25 사용자 결정으로
      보류(메모만).
- [x] **토스페이먼츠 홈페이지 주소**: 상점관리자 › 계약·운영 › 회사정보 › MID 정보 › 기본 정보 '변경'에서
      `iconsi0xvd`·`iconsi8sr4`를 `https://xsquare.kr/`로 변경 신청(2026-11-25 접수, 심사 2~5 영업일 — 반영 전까지 화면은
      옛 값). 심사 중인 `icons_usd`는 변경 버튼이 잠겨 있어 **심사가 끝나면** 같은 화면에서 바꾼다.
- [ ] **나이스페이**: 계약 전(2026-11-25). 계약·개통 때 사이트 주소를 `xsquare.kr`로 등록한다.
- [x] **코페이**: drain 전용이라 바꾸지 않는다. 2026-11-25 기준 코페이 결제 시도 0건이라 옛 주소로 올 콜백이 없다.
      브라우저 콜백은 308을 따라오고, `PRODUCTION_SITE_DOMAINS`에 `iconsip.com`을 남긴다.
- [ ] **Google OAuth 브랜딩**: 홈페이지·개인정보처리방침 칸이 비어 승인 도메인 저장이 막혀 있다. 로그인은 Supabase
      콜백이라 영향 없다 — 브랜딩을 채울 때 `xsquare.kr`로.
- [x] **Google Search Console**: `iconsip.com` 속성 '주소 변경'으로 `xsquare.kr` 이전 등록(2026-11-25, 유효성 통과 —
      경고는 두 옛 호스트가 같은 홈으로 가는 '대상 중복'뿐). `xsquare.kr` 속성에 사이트맵 제출 → 상태 '성공', 페이지 61.
- [ ] **네이버 서치어드바이저**: Claude in Chrome·앱 내장 브라우저 모두 `searchadvisor.naver.com`을 안전 제한으로 막아
      사람이 한다. 사이트 `https://xsquare.kr` 등록 → 소유확인 'HTML 태그'의 content 값을 Vercel production env
      `NAVER_SITE_VERIFICATION`에 넣고 재배포(main 배포 또는 `workflow_dispatch` `production_redeploy`) → 소유확인 →
      사이트맵 `https://xsquare.kr/sitemap.xml` 제출. 소유확인은 계정별이라 회사 네이버 ID가 생기면 그 계정으로 다시
      등록·확인하고 env 값을 그 계정 값으로 바꾼다.

### 실운영 점검(2026-11-25, 전환 직후)

- 로그인 메일: Supabase 대시보드에서 직원 계정으로 재설정 메일을 보내 `"X SQUARE" <no-reply@xsquare.kr>`·배달 완료를
  Resend에서 확인했다(전송은 Supabase 기본 메일이 아니라 custom SMTP → Resend). 같은 메일의 `email.sent`·`email.delivered`가
  `https://xsquare.kr/api/webhooks/resend`에서 200.
- 비밀번호 재설정 흐름: 로그인 화면 '비밀번호 찾기' → 같은 브라우저에서 메일 링크 → `/update-password` 새 비밀번호 화면까지
  2026-11-25 실측 통과. **대시보드의 'Send password recovery' 메일은 흐름 시험에 못 쓴다** — 링크가 `{{ .RedirectTo }}`
  기본값(Site URL 루트)으로 가고, 앱은 요청한 브라우저의 서명 state가 있어야 재설정을 연다. 발신·배달 확인 용도로만 쓴다.
- 앱 메일(주문 확인 등, 키 `icons-ip-app-transactional-xsquare`)은 시험 발송 기능이 없어 첫 실제 주문 때 Resend에서
  발신자·배달을 확인한다. 이 과정에서 만든 미사용 키 `icons-ip-supabase-auth-xsquare`는 지웠다.
- 운영 env에 메일 주소를 덮어쓰는 `RESEND_API_KEY`·`RESEND_FROM`·`RESEND_REPLY_TO`·`EMAIL_REPLY_TO`가 없다.
  Supabase Auth Hooks는 하나도 없다(메일 훅 꺼짐). 운영 DB 콘텐츠·pg_cron에 `iconsip.com`이 없다.
- 카카오톡 채널 웹훅은 등록돼 있지 않다(비즈니스 채널 미연결). 채널 '엑스 스퀘어' 프로필의 웹사이트·쇼핑몰 링크는
  `https://www.x-square.kr/`(하이픈, 이 문서 범위 밖)로 연결돼 있다 — 새 몰로 보내려면 채널 관리자 계정으로 바꾼다.
- 토스 API 키 접근 정책: 토스가 일괄 적용한 라이브 정책은 국가 '대한민국' 허용이다. 운영 함수는 `icn1`(서울)에서 돌아
  결제 승인·취소·재정합 호출이 허용 범위다. 해외 서버에서 라이브 키로 부르면 `API_KEY_ACCESS_DENIED`.
- 정기결제(빌링)를 열 때 빌링 MID가 `iconsi0xvd`와 다르면 그 MID에도 `xsquare.kr` 웹훅을 등록한다.
- 사람이 Bearer로 부르는 내부 라우트(`/api/internal/payments/*/reconcile`)는 `xsquare.kr`로 부른다 — 옛 주소로 부르면
  308에서 `Authorization`이 빠져 401이다.
- 외부 가동 감시(UptimeRobot 등)는 아직 없다. 만들 때 `https://xsquare.kr/api/health`를 지정한다.

## 3단계: 전환

**순서가 중요하다.** 0단계의 `xsquare.kr → iconsip.com` 307이 남은 채로 옛 도메인을 `xsquare.kr`로 돌리면 두 도메인이
서로 넘기는 무한 리디렉션이 된다. 그래서 새 도메인을 먼저 직접 서비스하게 하고(1단계 덕분에 두 도메인 모두 정상 동작),
옛 도메인 리디렉션은 맨 끝에 건다.

1. Vercel 도메인: `xsquare.kr`의 리디렉션을 없애 직접 서비스하고, `www.xsquare.kr`는 `xsquare.kr`로 308.
2. Vercel production env(다음 배포부터 적용): `SITE_URL=https://xsquare.kr`, `EMAIL_FROM=no-reply@xsquare.kr`,
   `EMAIL_PROVIDER_API_KEY`=`icons-ip-app-transactional-xsquare` 값(sensitive, 값은 기록에 남기지 않는다 — 콘솔 복사 →
   권한 600 임시 파일 → `vercel env update … --sensitive < 파일` → 파일 삭제).
   발신 주소와 키는 반드시 같은 배포에 들어가야 한다.
3. 코드 PR 머지 → `main` 파이프라인: `CANONICAL_SITE_ORIGIN`·Supabase Auth Site URL(production sync 두 곳)이
   `https://xsquare.kr`가 되고, 배포 스모크가 `xsquare.kr`를 본다.
4. 배포 성공 뒤 Vercel 도메인: `iconsip.com`·`www.iconsip.com` → `xsquare.kr` **308**(경로·메서드 유지).
5. 2단계의 "주소 교체" 항목 중 남은 것을 처리한다(1번 뒤 미리 했으면 확인만).

영향: 로그인 쿠키가 도메인에 묶여 있어 **기존 회원은 한 번 다시 로그인**한다. 전환 순간 결제·인증 중이던 사람은
돌아오는 주소의 쿠키가 없어 다시 로그인해야 할 수 있다(결제 확정은 서버 재정합이 맡는다).

확인: `xsquare.kr` 200, `www.xsquare.kr`·옛 주소의 308과 경로 유지, 이메일·카카오·구글·Apple 로그인, 비밀번호 재설정
메일 링크와 발신자, 주문 확인 메일 발신자, 토스 결제와 취소·웹훅 도착, KCP 성인 인증, `robots.txt`·`sitemap.xml`·OG
절대 주소, 카카오·Resend 웹훅 시험 발송.

되돌리기: Vercel 도메인 리디렉션 방향을 원래대로 돌리고(`iconsip.com` 직접 서비스, `xsquare.kr` → `iconsip.com`),
`SITE_URL`·`EMAIL_FROM`·`EMAIL_PROVIDER_API_KEY`를 `iconsip.com` 값(옛 키 `icons-ip-app-transactional`)으로 되돌린 뒤
재배포한다. 1단계 덕분에 두 `SITE_URL` 값이 모두 검사를 통과하므로 결제·본인확인은 env만으로 돌아온다.
`CANONICAL_SITE_ORIGIN`과 `pipeline.yml`의 Auth Site URL은 되돌리는 커밋으로 맞춘다. 웹훅 주소도 옛 값으로 돌리고,
Supabase SMTP 발신 주소와 키 `icons-ip-supabase-auth`의 도메인 제한을 함께 `iconsip.com`으로 되돌린다.

## 4단계: 정리

- 결제·본인확인·결제수단 runbook과 `README.md`·`docs/ARCHITECTURE.md`의 운영 주소 표기는 3단계 PR에서 갱신했다
  (지난 기록의 날짜가 붙은 `iconsip.com` 표기는 그때의 사실이라 남긴다).
- `iconsip.com`은 PG 영수증·지난 메일 링크·검색 색인 때문에 **최소 1년** 리디렉션으로 유지한다.
  드레인 중인 콜백이 끝나기 전에는 `PRODUCTION_SITE_DOMAINS`에서 빼지 않는다.

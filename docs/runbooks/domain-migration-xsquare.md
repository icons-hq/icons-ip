# 운영 도메인 전환: iconsip.com → xsquare.kr

운영 도메인을 `iconsip.com`에서 `xsquare.kr`로 옮기는 절차다. 코드의 운영 도메인 단일 출처는
[`lib/site-domains.mjs`](../../lib/site-domains.mjs)다.

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | DNS를 Cloudflare로 옮기고 Vercel에 임시 연결 | 완료(2026-11-18) |
| 1 | 두 도메인 병행 준비(코드·Auth 리디렉션·메일 발신 도메인) | 이 문서를 만든 PR |
| 2 | 외부 서비스·PG·법정 신고 등록(사람) | 대기 |
| 3 | 전환(정규 주소·env·리디렉션 방향 교체) | 대기 |
| 4 | 정리(문서·옛 도메인 유지 기간) | 대기 |

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
- Resend에 `xsquare.kr`를 Forge·도쿄(ap-northeast-1)로 추가했다. 받는 메일(`Enable receiving`)은 켜지 않았다.

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

전환 전에 끝내야 한다. 웹훅을 보내는 서비스는 대개 리디렉션을 따라가지 않으므로, 웹훅 주소는 **전환 순간에
새 주소로 바꾸거나, 병행 등록이 되면 미리 추가**한다.

- [ ] **토스페이먼츠**: ICONS 상점(MID `iconsi0xvd`)의 사이트 주소 변경 신고와 재심사 여부 확인.
      웹훅 `https://xsquare.kr/api/webhooks/tosspayments` 등록. 절차는 [toss-production-rollout.md](toss-production-rollout.md).
- [ ] **나이스페이**: 가맹점 사이트 주소·결제 복귀 도메인 등록. [nicepay-production-rollout.md](nicepay-production-rollout.md).
- [ ] **KCP 휴대폰본인확인**: 인증결과URL에 **도메인 형식** `xsquare.kr`를 추가한다. 프로토콜을 붙인 주소만
      있으면 운영 거래등록이 `CS13`으로 실패한다. [kcp-adult-verification.md](kcp-adult-verification.md).
- [ ] **코페이**: drain 전용이다. 진행 중 콜백이 `iconsip.com`으로 돌아오므로 옛 도메인 리디렉션과
      운영 도메인 목록의 `iconsip.com`을 유지한다.
- [ ] **카카오 developers**: 플랫폼 Web 사이트 도메인에 `https://xsquare.kr` 추가(로그인·공유).
      카카오 채널 웹훅 `https://xsquare.kr/api/webhooks/kakao/channel`. [signup-contact-channels.md](signup-contact-channels.md).
- [ ] **Google OAuth**: 동의 화면의 승인된 도메인에 `xsquare.kr` 추가.
- [ ] **Apple**: Services ID의 도메인, Sign in with Apple 이메일 릴레이 발신 도메인 등록. 릴레이는 발신 도메인
      루트의 SPF를 요구하므로 Resend 검증 뒤 루트 SPF 레코드를 함께 넣는다.
- [ ] **Resend**: `xsquare.kr` 검증 완료 확인. 웹훅 `https://xsquare.kr/api/webhooks/resend`(전환 때 교체).
- [ ] **Supabase Auth custom SMTP**: 발신 주소를 `no-reply@xsquare.kr`로 바꿀 준비(전환 때 교체).
- [ ] **검색엔진**: Google Search Console·네이버 서치어드바이저에 `xsquare.kr` 등록, 전환 뒤 주소 변경 도구와 사이트맵 제출.
- [ ] **법정 표기·신고**: 통신판매업 신고의 인터넷 도메인 변경, 이용약관·개인정보처리방침·사업자 정보 화면의
      도메인 표기 확인.

## 3단계: 전환

트래픽이 적은 시간에 한 번에 한다. 결제 진행 중인 건이 있을 수 있으니 전환 직후 PG 대사를 확인한다.

1. 코드: `CANONICAL_SITE_ORIGIN`을 `https://xsquare.kr`로 바꾸고, `pipeline.yml`의 Supabase Auth `SITE_URL`
   (production sync 두 곳)을 `https://xsquare.kr`로 바꾼다.
2. Vercel production env: `SITE_URL=https://xsquare.kr`, `EMAIL_FROM`을 `no-reply@xsquare.kr` 발신자로 교체.
3. 배포 뒤 Vercel 도메인 리디렉션 방향을 뒤집는다 — `xsquare.kr`·`www.xsquare.kr`는 직접 서비스,
   `iconsip.com`·`www.iconsip.com`은 `xsquare.kr`로 **308**(경로·메서드 유지).
4. 2단계의 웹훅·SMTP 발신 주소를 새 도메인으로 교체한다.

영향: 로그인 쿠키가 도메인에 묶여 있어 **기존 회원은 한 번 다시 로그인**한다.

확인: 이메일·카카오·구글·Apple 로그인, 비밀번호 재설정 메일 링크, 토스·나이스페이 결제와 취소,
KCP 성인 인증, 주문 확인 메일 발신자, `robots.txt`·`sitemap.xml`·OG 절대 주소, 옛 주소의 308 리디렉션.

되돌리기: 리디렉션 방향을 원래대로 돌리고 `SITE_URL`·`EMAIL_FROM`을 `iconsip.com` 값으로 되돌린 뒤 재배포한다.
1단계 덕분에 두 `SITE_URL` 값이 모두 검사를 통과하므로 결제·본인확인은 env만으로 바로 돌아온다.
`CANONICAL_SITE_ORIGIN`(SITE_URL이 없을 때의 기본값·로그인 기본 출처)은 뒤이은 커밋으로 되돌린다.

## 4단계: 정리

- 결제·본인확인·결제수단 runbook과 `README.md`·`docs/ARCHITECTURE.md`의 운영 주소 표기를 갱신한다.
- `iconsip.com`은 PG 영수증·지난 메일 링크·검색 색인 때문에 **최소 1년** 리디렉션으로 유지한다.
  드레인 중인 콜백이 끝나기 전에는 `PRODUCTION_SITE_DOMAINS`에서 빼지 않는다.

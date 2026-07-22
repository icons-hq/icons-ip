# Google·Apple·Kakao 소셜 로그인 설계

## 목표

GitHub Issue #17의 Google·Apple·Kakao 로그인 버튼을 Supabase Auth의 관리형 OAuth 흐름에 연결한다. 소셜 로그인 사용자도 기존 이메일 가입 사용자와 동일하게 계정 정지 확인, 온보딩 완료 판정, 안전한 원래 경로 복귀를 거친다.

외부 공급자와 Supabase에는 ICONS 전용 앱과 자격 증명을 사용한다. 기존 Grapit 또는 다른 서비스의 OAuth 앱·동의 화면·키를 재사용하지 않는다.

## 현재 상태

- production Supabase project ref는 `sbutbsghcxmxmxgrshwq`다.
- Google, Apple, Kakao provider는 production Supabase에서 모두 활성화되어 있다.
- 세 공급자가 등록할 Supabase callback URL은 `https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1/callback`이다.
- production 앱 callback은 `https://iconsip.com/auth/callback`이며 기존 Supabase redirect allow-list에 포함되어 있다.
- `components/screens/Login.tsx`의 세 버튼은 UI만 있고 동작하지 않는다.
- `app/auth/callback/route.ts`는 PKCE code exchange, `getUser()` 재검증, 계정 정지, 온보딩, 안전한 `next` 복귀를 이미 처리한다.
- 기존 Google Cloud `grapit-491806`은 재사용하지 않았다. ICONS 전용 project `icons-503202`, Auth Platform 앱 `ICONS`, Web client `ICONS Web`을 만들고 production으로 게시했다.
- Kakao Developers에는 `(주) 아이콘스` 비즈 앱 `ICONS`(ID `1520482`)와 `ICONS Web` REST API 키를 만들고 Kakao Login·client secret·Supabase callback을 설정했다. `account_email`은 필수 동의·계정 정보 수집이며 Supabase의 이메일 없는 사용자 허용은 꺼져 있다.
- Apple Developer Program 개인 멤버십과 최신 계약 수락을 확인했다. primary App ID `com.iconsip.app`, Services ID `com.iconsip.web`, Sign in with Apple key와 Supabase callback 구성을 완료했다.
- 공개 이용약관·개인정보처리방침 라우트는 아직 없다. Google 브랜드 인증이나 공급자 심사에 필요해지면 별도 정책 이슈로 다루며, 이 작업에서 임시 법무 문구를 만들지 않는다.

## 선택한 접근

### Supabase 관리형 OAuth

각 버튼은 같은 Server Action에 공급자 식별자와 안전한 `next`만 제출한다. Server Action은 `google`, `apple`, `kakao`만 허용하고 Supabase server client의 `signInWithOAuth()`를 호출한다. 브라우저에서 공급자 client secret이나 공급자 token을 직접 다루지 않는다.

대안은 다음 이유로 채택하지 않는다.

- 기존 Grapit OAuth 앱 재사용: 동의 화면 브랜드, 승인 도메인, 운영 키 수명과 장애 범위가 섞인다.
- Google One Tap·Apple JS·Kakao JS SDK 직접 통합: 공급자별 client code와 nonce/token 교환 경계가 늘어나고 현재 Next.js SSR PKCE callback 계약을 우회한다.
- 공급자별 별도 callback route: 기존 검증·온보딩 로직이 중복되고 오류 처리 차이가 생긴다.

## 앱 인증 흐름

1. 사용자가 `/login?next=<safe-path>`에서 소셜 로그인 버튼을 누른다.
2. Server Action은 공급자를 allow-list로 검증하고 `next`를 `safeNextPath()`로 정규화한다.
3. Server Action은 10분 수명의 서명된 httpOnly `icons_auth_next` 쿠키에 `purpose: 'oauth'`와 안전한 `next`를 저장한다.
4. Supabase `signInWithOAuth()`를 `redirectTo: https://iconsip.com/auth/callback`로 호출한다. 현재 요청이 허용된 preview 또는 local origin이면 기존 trusted-origin 규칙으로 해당 callback을 사용한다.
5. Server Action은 Supabase가 반환한 공급자 authorization URL로 리다이렉트한다.
6. 공급자는 Supabase callback으로 authorization code를 보내고 Supabase는 앱 callback으로 PKCE code를 보낸다.
7. 기존 `/auth/callback`은 code exchange 후 `getUser()`로 사용자를 재검증한다.
8. 정지 계정은 `/account-suspended`, 필수 프로필·동의가 없는 사용자는 `/onboarding?next=...`, 온보딩 완료 사용자는 원래 안전한 경로로 이동한다.
9. callback은 사용한 `icons_auth_next` 쿠키를 제거한다.

## 코드 경계

### `app/login/actions.ts`

- `SocialAuthProvider = 'google' | 'apple' | 'kakao'` allow-list를 둔다.
- `signInWithSocialAction(previousState, formData)`를 추가한다.
- 잘못된 공급자, Supabase 미설정, provider disabled, authorization URL 누락을 내부 상세 없이 사용자 오류로 매핑한다.
- 공급자 authorization URL 외의 임의 URL을 생성하거나 입력받지 않는다.

### `lib/auth/recovery.server.ts`

- `AuthNextPurpose`에 `oauth`를 추가한다.
- `oauth`는 signup과 같은 10분 수명을 사용한다.
- 서명·만료·안전 경로 검증은 기존 구현을 재사용한다.

### `app/auth/callback/route.ts`

- `oauth` 목적을 일반 로그인 callback으로 취급한다.
- recovery 분기와 기존 이메일 signup 동작은 바꾸지 않는다.
- provider error query는 기존 `authErrorLoginPath()`의 안전한 오류 문구로 귀결한다.

### `components/screens/Login.tsx`

- 세 버튼을 하나의 Server Action form에 연결한다.
- 버튼의 `name="provider"`와 `value`만 다르게 하고 `next`는 hidden input으로 전달한다.
- 진행 중에는 중복 제출을 막고 공급자 오류는 기존 alert 영역에 표시한다.
- reset mode에서는 기존처럼 소셜 로그인 영역을 렌더링하지 않는다.
- Supabase public 설정이 없으면 세 버튼을 비활성화한다.

## 외부 공급자 구성

### Google

- Grapit project를 사용하지 않고 ICONS 전용 Google Cloud project를 생성한다.
- Google Auth Platform 앱 이름은 `ICONS`로 한다.
- Web OAuth client 이름은 `ICONS Web`으로 한다.
- Authorized JavaScript origins에 `https://iconsip.com`과 `https://www.iconsip.com`을 둔다.
- Authorized redirect URI는 Supabase callback URL 한 개를 등록한다.
- scope는 `openid`, email, profile만 사용하며 Google API offline access는 요청하지 않는다.
- 공개 심사에 필요한 실제 법무 URL이 없으면 거짓 URL을 입력하지 않고 테스트/심사 상태를 명확히 보고한다.

### Kakao

- 새 ICONS 앱을 만든다. 앱 이름은 `ICONS`, 대표 도메인은 `https://iconsip.com`으로 한다.
- 회사명은 Kakao Business에 등록된 실제 사업자 상호·법인·단체명만 사용하고 추정값을 입력하지 않는다.
- Kakao Login을 활성화하고 REST API key의 redirect URI에 Supabase callback URL을 등록한다.
- Client Secret Code를 생성·활성화한 뒤 Supabase Kakao provider에 저장한다.
- `account_email`을 필수 동의·계정 정보 수집으로 활성화하고, Supabase의 email optional 설정은 끈다.

### Apple

- Apple Developer Program 가입은 비용이 발생하므로 별도 사용자 승인 없이 신청·결제하지 않는다.
- Apple Developer 계정에 ICONS용 primary App ID, Services ID, Sign in with Apple key를 만든다.
- Services ID는 ICONS 웹 OAuth client id로 사용하고 domain은 Supabase project domain `sbutbsghcxmxmxgrshwq.supabase.co`, return URL은 Supabase callback URL로 등록한다.
- `.p8` key 원문은 다운로드 직후 안전한 비밀 저장소에 보관하고 저장소·채팅·명령 인자에 노출하지 않는다.
- Team ID, Key ID, Services ID, `.p8`로 생성한 client secret만 Supabase Apple provider에 입력한다.
- Apple web OAuth client secret은 최대 6개월 수명으로 생성하고 만료 전에 교체하는 운영 일정을 문서화한다. 현재 secret은 2027-01-18 만료이며 2027-01-04까지 교체한다.
- Apple OAuth가 이름을 반환하지 않아도 기존 온보딩에서 닉네임을 필수 수집하므로 별도 metadata 의존성을 추가하지 않는다.

## 오류와 보안

- UI에는 공급자 응답 원문, client id, client secret, key id, team id, authorization code, token을 표시하거나 로깅하지 않는다.
- provider 설정 누락·비활성화·callback 불일치는 `현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.`로 제한한다.
- 사용자가 공급자 화면에서 취소하면 `인증을 완료하지 못했습니다. 다시 시도해주세요.`로 안내한다.
- `next`는 query 또는 form 값을 그대로 신뢰하지 않고 기존 same-origin 안전 경로 검증을 통과시킨다.
- 이메일이 같은 별도 identity의 자동 병합이나 manual linking은 이 이슈에서 활성화하지 않는다.

## 테스트와 검증

- RED: 세 버튼이 공급자와 `next`를 제출하고 reset mode에서는 숨겨지는 컴포넌트 테스트를 먼저 추가한다.
- RED: Server Action의 공급자 allow-list, signed OAuth next cookie, callback URL, provider 오류 은닉 테스트를 먼저 추가한다.
- RED: `oauth` cookie 목적의 서명·10분 만료와 callback 온보딩/원래 경로 복귀 테스트를 먼저 추가한다.
- GREEN: 각 실패를 확인한 뒤 최소 구현으로 통과시킨다.
- 전체 `npm test`, `npm run lint`, `npm run build`를 실행한다.
- production 적용 뒤 각 공급자 controlled test account로 신규 사용자 온보딩과 기존 온보딩 사용자 `next` 복귀를 각각 검증한다.
- provider 취소, provider disabled, 잘못된 callback 상황에서 내부 오류가 노출되지 않는지 확인한다.

## 문서 영향

- `README.md`에 공급자별 callback, 콘솔 위치, 비밀값 취급, Apple 6개월 교체 절차를 기록한다.
- `docs/ARCHITECTURE.md`, `docs/PRD.md`, `docs/launch-readiness-plan.md`의 비활성 소셜 로그인 설명을 실제 상태로 갱신한다.
- `CONTEXT.md`와 ADR은 변경하지 않는다.

## 완료 조건

- 세 공급자가 production Supabase에서 Enabled이며 자격 증명 필드가 설정되어 있다. 이 조건은 완료됐다.
- production 로그인 버튼 세 개가 실제 공급자 authorization 화면으로 이동한다.
- 신규·기존·취소·설정 누락 경로가 위 계약대로 동작한다.
- 테스트, lint, build와 production controlled smoke 결과가 기록된다.
- 운영자가 callback URL과 Apple secret 교체 일정을 문서에서 찾을 수 있다.
- GitHub Issue #17과 Project 상태 변경은 사용자가 별도로 요청한 commit·push·PR·merge 범위가 생긴 뒤 수행한다.
- 외부 provider와 이메일 claim 설정은 완료됐다. 코드가 production에 배포되고 신규·기존·취소 경로 controlled smoke가 통과되기 전에는 Issue #17 전체를 완료로 판정하지 않는다.

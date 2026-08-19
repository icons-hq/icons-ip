# 마이페이지 통합 진입점 설계

작성일: 2026-07-16
대상 이슈: [#103](https://github.com/icons-hq/icons-ip/issues/103)

## 목표

로그인 사용자가 주문, 티켓, 카드 컬렉션, 계정 설정으로 이동할 수 있는 단일 보호 허브를 제공한다. 기존 공개 우선 브라우징은 유지하고, 허브 자체만 인증·온보딩 완료 사용자에게 연다.

## 확정한 정보 구조

- 정식 경로는 `/my`다.
- 프로필 요약에는 현재 닉네임과 private `user-uploads` 아바타의 signed URL을 표시한다.
- 아바타가 없거나 signed URL 생성이 실패하면 기존 `profileAvatarInitial()` 첫 글자 규칙을 사용한다.
- 목적지 카드는 실제 구현 상태에 맞춰 모두 활성 링크로 제공한다.
  - 주문 내역 `/orders`
  - 내 티켓 `/tickets`
  - 바인더 `/binder`
  - 카드팩 `/packs`
  - 설정 `/settings`
- 수치, 등급, 알림 같은 아직 조회하지 않는 정보는 만들지 않는다.

## 인증과 내비게이션

- 비로그인 `/my` 요청은 `/login?next=%2Fmy`로 이동한다.
- 로그인했지만 온보딩을 마치지 않은 사용자는 기존 `onboardingPath('/my')` 규칙을 따른다.
- 데스크톱 `AuthButton`의 로그인 상태 `설정` 버튼을 `마이` 링크로 바꾸고 로그아웃은 유지한다.
- 모바일은 비로그인 상태에서 기존 5번째 `장바구니` 탭을 유지한다.
- 모바일은 로그인 상태에서 5번째 탭을 `마이`로 교체한다. 장바구니는 상단 고정 아이콘으로 계속 접근할 수 있다.
- `AuthButton`의 기존 클라이언트 인증 확인을 표시 전용 `AuthPresenceProvider`로 옮겨 `AuthButton`과 `MobNav`가 unknown/signed-in/signed-out 상태 및 한 번의 조회·구독을 공유한다. 초기 확인 중에는 로그인·비로그인 UI를 섣불리 노출하지 않는다. 이 상태는 진입점 표시 전용이며 `/my` 보안 게이트로 신뢰하지 않는다. 루트 Server Layout은 서버 인증 조회를 하지 않아 공개 페이지의 렌더링 경계를 바꾸지 않는다.

## 화면 구조

- `MY ICONS` eyebrow, `마이` 제목, 통합 관리 설명을 가진 헤더
- 원형 아바타와 닉네임을 강조한 프로필 카드
- 2열 데스크톱 / 1열 모바일 목적지 카드 그리드
- 기존 Holographic Midnight 토큰, `.card`, pill, hairline, radial atmosphere를 재사용한다.
- 카드 전체를 `Link`로 만들고 `focus-visible` 윤곽선, 명시적 제목·설명, 장식 아이콘의 `aria-hidden`을 제공한다.

## 오류와 개인정보 경계

- signed URL 생성 실패는 허브 전체 실패로 확장하지 않고 첫 글자 아바타로 축소한다.
- signed URL 생성 규칙은 `lib/profile-avatar.server.ts`에 한 번만 두고 `/settings`와 `/my`가 함께 사용한다.
- 이메일, 사용자 ID, 주문·티켓 수량은 허브에 노출하지 않는다.
- 새 DB 테이블, RPC, migration, service-role 사용은 없다.

## 검증 기준

- 라우트 보호와 온보딩 redirect
- signed 아바타 성공·실패 fallback
- 5개 목적지 링크와 프로필 렌더링
- 데스크톱 로그인/비로그인 분기 및 `설정` 중복 제거
- 모바일 로그인 시 `마이`, 비로그인 시 `장바구니`, active·수량 배지 유지
- 390px 및 데스크톱 브라우저에서 overflow, 키보드 focus, 콘솔 오류 확인
- 전체 test, lint, build

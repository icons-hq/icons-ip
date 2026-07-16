# 어드민 회원 조회·정지 콘솔 설계

## 범위

- staff/admin은 회원을 닉네임·이메일로 검색하고, 목록에서 마스킹 이메일·역할·가입일·정지 상태를 본다.
- 선택한 회원 상세에서만 전체 이메일, 현재 약관·개인정보·마케팅 동의 snapshot, 굿즈 주문·티켓 예매·제출/받은 신고 수와 내부 정지 사유를 본다.
- active staff는 일반 사용자를, active admin은 일반 사용자와 staff를 정지·해제할 수 있다. 본인과 admin 대상은 항상 제외한다.
- #110이 정할 제재 기준·기간·사유 taxonomy·경고 단계·이의신청 정책은 만들지 않는다.

## 신뢰 경계

- `profiles.suspended_at`과 내부 `suspension_reason`을 추가한다. authenticated의 기존 table-level profile SELECT를 안전 컬럼 단위 grant로 바꾸고 RLS는 self-only로 좁혀, staff도 목적별 RPC 없이 다른 회원을 직접 읽지 못하게 한다.
- 회원 조회·상세·정지·해제는 active `is_staff()`를 DB에서 다시 확인하는 `SECURITY DEFINER` RPC로만 제공하고, 신규 함수는 전체 role에서 revoke한 뒤 필요한 role에만 grant한다.
- 받은 신고 수는 신고 생성 시 private subject snapshot에 귀속해 작성자가 원문을 삭제해도 운영 이력을 보존한다. private snapshot은 Data API role에 노출하지 않는다.
- 정지·해제는 actor/target 행을 잠그고, 실제 상태 전이만 PII-free audit을 한 건 남긴다. 같은 상태 replay는 무변경이다.
- suspended profile을 staff/admin으로 새로 승격할 수 없다. `is_staff()`와 앱의 staff 판정은 정지 상태를 포함한다.
- 공개 `public_profiles`에는 정지 상태와 사유를 추가하지 않는다.

## 정지 효과

- 새 포스트 작성·본인 포스트 수정·댓글 작성·굿즈 주문·티켓 예매·카드팩 개봉·게임 플레이를 Server Action과 DB 경계에서 모두 거부한다.
- community 이미지 upload는 포스트 작성 검사보다 먼저 일어나지 않으며, Storage `/community/...` INSERT 정책도 정지 계정을 거부한다. 프로필 avatar branch는 유지한다.
- 공개 읽기, 좋아요, 팔로우, 프로필·마케팅 설정, 작성자 삭제, 신고·사용자 차단, 주문·티켓 취소, 비밀번호 복구, 이미 시작된 결제·환불·webhook 정합화는 유지한다.
- suspended staff는 admin route/action/RPC와 현장 검표를 사용할 수 없다.

## 로그인과 UI

- 이메일 로그인, 기존 session의 `/login`, 정상 signup callback은 onboarding/next보다 먼저 `/account-suspended`로 보낸다. recovery callback과 비밀번호 변경은 계속 허용한다.
- 정지 안내 화면은 내부 사유·기간·정책 위반 유형을 노출하지 않고 generic 안내와 로그아웃만 제공한다.
- 회원 검색은 이메일이 URL·access log에 남지 않도록 POST Server Action으로 수행한다. 상세 PII는 명시적으로 회원 상세를 연 뒤에만 client에 전달한다.
- 정지 form은 trim한 1~200자 내부 사유를 요구하고 제출 전 영향을 확인한다. 변경 control은 44px 이상과 명시적 label/focus를 유지한다.

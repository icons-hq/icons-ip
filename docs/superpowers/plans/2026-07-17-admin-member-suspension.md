# 어드민 회원 조회·정지 콘솔 구현 계획

1. 회원 DTO·검색/상세 loader·action·UI, 로그인 분기와 각 보호 액션, DB ACL·상태 전이·우회 방지 계약을 실패 테스트로 고정한다.
2. `profiles` 정지 필드·안전한 column grant, active staff 판정, PII-safe 회원 조회 RPC와 audited 정지·해제 RPC를 migration으로 추가한다.
3. 포스트/댓글·주문/예매·카드팩·게임 및 community Storage에 정지 guard를 추가하되 취소·신고·삭제·복구·외부 결제 마감은 유지한다.
4. 기존 역할 탭 옆에 staff/admin 공용 회원 섹션을 추가하고, POST 검색·명시적 상세·권한별 정지/해제 control을 연결한다.
5. 로그인 action/page/callback에 onboarding보다 우선하는 generic 정지 안내 route를 연결한다.
6. PRD·Architecture·launch plan을 현재 동작에 맞추고 CI에 역할/정지 SQL smoke를 등록한다.
7. Supabase CLI 2.101.0 fresh reset, 전체 SQL smoke, DB lint, targeted/full test·lint·build와 desktop/mobile 브라우저 QA로 검증한다.

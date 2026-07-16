# 커뮤니티 댓글 모더레이션 구현 계획

1. 공개 preview/count, admin loader·normalizer·action·UI, DB 권한·원자성 계약을 실패 테스트로 고정한다.
2. `comments.status`, visible partial index, 관계자 읽기 RLS와 직접 UPDATE 회수를 migration으로 추가한다.
3. comment 신고 visibility guard, hidden 제외 reaction count, audited staff hide RPC를 빈 `search_path`, 최소 ACL, 일관된 행 잠금 순서로 정의한다.
4. 공개 loader와 카탈로그 집계를 visible-only로 만들고 admin에 개별 댓글 action을 연결한다.
5. PRD·Architecture·launch plan·DESIGN을 현재 동작에 맞춘다.
6. Supabase CLI 2.101.0 fresh reset, 전체 SQL smoke, DB lint, targeted/full test·lint·build로 검증한다.

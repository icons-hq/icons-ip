# 홈 상품형 베스트리뷰 — 선정 BEST 대표 후기 우선

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14. **완료(격리 로컬 DB·실제 Chrome 확인).** 홈에 이미 선정된 상품의 대표 후기만 현재 유효한 BEST 후기로 우선 표시한다. 상품 후보와 정렬, 공개 후기 전체의 평균·개수·최근 작성일은 기존 계약을 유지한다. 운영·Preview 배포는 이 기록의 범위가 아니다.

## 적용한 계약

원본 자동등록 도움말 캡처 (`output/smartstore-reference-20261012/store/review-official-help-17550.txt`)는 평점·도움수·작성시각과 BEST 지정 기준을 설명한다. 이 문서의 구현 범위는 **기존 상품 선정 뒤 대표 후기를 선택하는 단계**다. 원본 상품 순위 전체를 재현했다고 주장하지 않는다. 당시 없던 도움수는 2026-10-15 [후속 구현·검증](home-review-helpful-priority.md)에서 반영했다. 하루 한 번 갱신하는 원본과 달리 현재 요청의 공개·선정 상태를 읽는 계약은 유지한다.

- `private.review_best_selections`의 현재 선정·원문 fingerprint·무효화 상태와 구매·계정·상품/IP 공개 조건을 모두 만족하는 후기 중 평점 내림차순, 작성시각 내림차순, 리뷰 ID 오름차순으로 한 개를 고른다. 1점 후기와 최근 7일 이전 후기도 대표로 선택될 수 있다.
- 유효한 선정 후기가 없으면 기존 공개 후기의 평점·작성시각·ID 순서로 돌아간다. 선정 무효화는 일반 후기의 추가 블라인드 조건이 아니다. 높은 평점의 무효화된 BEST 원문이 일반 후기 기준으로 다시 대표가 될 수 있다.
- 전체 공개 후기의 평균·개수·최근 후기 시각과 자동 상품 순서, 평균 3점·최근 7일 후보·최소 4상품·자동 최대 6상품·수동 최대 20상품은 유지한다. BEST 선정으로 평균이 오르거나 상품의 자동 순위가 승격되지 않는다.
- [PDP 이미지 영역의 선정 BEST](product-detail-review-best-implementation-qa.md)와 같은 선정 원장을 읽지만 PDP 노출 토글·최소 3개·무작위 3개 규칙을 홈에 적용하지 않는다. 선정·조회는 혜택 지급을 만들지 않는다.

## 공개 읽기와 권한

[migration](../../../supabase/migrations/20261020085337_home_review_best_priority.sql)은 기존 `get_home_review_candidates(text[])`의 SECURITY INVOKER·반환 shape·owner·ACL을 유지하고 대표 후기에만 우선순위를 추가한다. 새 `get_home_best_review_candidates(text[])`는 1~200개 공개 상품 ID에 한정된 STABLE SECURITY DEFINER 조회다. 반환 필드는 기존 홈 대표 후기의 ID·본문·평점·공개 닉네임·작성일이며 선정 사유·운영자·회원·주문 ID와 원장 상태는 노출하지 않는다. PUBLIC·anon·authenticated·service_role을 먼저 revoke한 후 anon·authenticated에만 execute를 부여한다.

기존 혼합 소유자 DB에서도 private helper의 owner·ACL을 바꾸지 않도록 구매·계정·fingerprint 읽기 조건을 같은 statement snapshot에 명시했다. 적용 전 source guard와 [회귀](../../../supabase/tests/home_review_best_priority.sql)가 원 helper의 source 지문을 확인하고, 기존 권한 있는 CS 상태 RPC의 실제 결과와 각 조건을 비교한다. 해당 helper 계약을 바꾸면 새 공개 조회와 회귀도 함께 검토해야 한다. 공개 읽기는 계정 advisory lock·감사·선정 변경을 만들지 않으며 실제 읽기 전용 트랜잭션에서 실행된다. 타임존이 달라질 때 기존 JSON ISO offset 표현은 달라질 수 있으나 같은 시각과 데이터를 반환한다.

## 검증과 보존

검증 manifest (`output/home-review-best-priority-qa-20261014/manifest.json`)에 소스·테스트·증거의 SHA-256과 실행 결과를 기록했다. migration SHA-256은 `456677a68fbae7776c8aa5a26264cbee47e51a9b0bcf759dd306ac84c76dc196`이다.

1. canonical 309행 DB와 기존 OWN DB를 각각 새 폐기용 DB에 복제했다. 신규 BEST 회귀, 기존 BEST 회귀, 기존 홈 집계 회귀, capability coverage가 양쪽에서 통과했다. 전체 capability guard는 unconfigured canonical clone에서 통과했다. 복제본과 임시 dump를 제거했다.
2. 승인된 OWN 59622·FRESH 59722·canonical 59922에 같은 migration을 적용했다. 신규 SQL·coverage가 세 DB에서 통과했고 FRESH·canonical의 전체 guard도 통과했다. 각각 ledger는 241→242, 274→275, 309→310이며 기존 행과 새 SQL 전문을 대조했다. 기존 함수 1,087개, 변경 집계 함수의 owner·ACL, 정책 135개, 기존 계약 registry와 운영자 권한 상태를 보존했다. FRESH 59722를 명시한 CLI security advisors도 경고 이상 항목 없이 통과했다.
3. 1,001개 후기·1점/오래된 BEST·동점·해제·원문 변경/복원·환불·취소·결제 근거/금액·계좌이체·완료 반품·숨김·탈퇴 fence·정지·상품/IP 비공개/보관·역할 회수·익명 동등·200개 경계·최소 공개 필드·실제 read-only·보상/감사/잠금 불변을 확인했다. OWN의 기존 회귀 전제 차이는 복제본의 rollback 트랜잭션 안에서만 합성 membership·설정 revision·기존 판매순위 fixture를 격리해 처리했다. 기존 함수 권한이나 원본 데이터를 보정하지 않았다.
4. 실제 Chrome에서 새 합성 상품 4개와 후기 12개만 만들어, 리뷰 상세 UI의 선정·해제 writer를 실행했다. 1점(9월 24일) BEST 선정 시 대표 본문·날짜가 바뀌고 평균 3.67·후기 3개·수동 4상품 순서·자동 6상품 ID가 유지됐다. 해제 후 5점(10월 13일) 일반 대표 후기와 DOM/익명 DB 결과가 baseline과 완전히 같았다. PC 1440px·모바일 390px를 직접 시각검수했고 모바일 document/scroll 너비는 모두 380px였다.
5. 기존 홈 설정은 변경하지 않았다. 새 합성 상품·후기·주문·결제·시도·회원·IP·큐레이션만 제거하고 기존 후기 59개·회원 66개·홈 설정·기존 BEST 선정 원장과 PDP 설정의 지문 보존을 확인했다. 사용한 두 탭을 닫고 임시 viewport를 해제했다.

대표 증거는 PC 선정 반영 (`output/home-review-best-priority-qa-20261014/ui-selected-pc.png`), 390px 선정 반영 (`output/home-review-best-priority-qa-20261014/ui-selected-390.png`), 390px 해제 후 복귀 (`output/home-review-best-priority-qa-20261014/ui-cleared-390.png`), 선정 DB 재조회 (`output/home-review-best-priority-qa-20261014/ui-selected-public-db.json`), 기존 데이터 복원 지문 (`output/home-review-best-priority-qa-20261014/ui-baseline-restored.json`)이다. 콘솔에는 번역 확장프로그램이 추가한 `data-immersive-translate-page-theme`에 따른 hydration 경고 3건이 있어 무경고 통과로 기록하지 않았다.

전체 빈 DB migration 순차 재구축·운영/Preview 배포·원본 스마트스토어 설정 저장은 이 단위에서 실행하지 않았다. 홈 로더·렌더·선정 writer는 바꾸지 않았고 실제 QA 시점의 홈·BEST 관련 6개 파일이 작업 트리와 같은 SHA임을 확인했다. 이후 리뷰 상세에 홈 우선 사용과 별도 PDP 조건을 설명하는 안내 한 문단을 추가하고 대상 ESLint를 확인했다.

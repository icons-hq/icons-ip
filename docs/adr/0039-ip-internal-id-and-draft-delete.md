# IP 내부 ID는 시스템이 발급하고, 미사용 초안만 물리 삭제한다

- Status: accepted (2026-11-12) — 제품 소유자 결정(원장 재작업 질문 묶음 5, 11/11): "IP ID 자동 발급" + "미사용 초안 삭제". main 머지와 운영 배포는 별도 승인.
- 관련: [ADR-0014](./0014-admin-console-redesign.md)(운영 콘솔·IP 게시 상태), [IP 게시 상태 운영 절차](../runbooks/ip-publish-state.md), [ARCHITECTURE §5.2](../ARCHITECTURE.md)

## 맥락

9/7 운영 테스트 원문은 "IP-1 TEST 등록해봤는데, ID 수정 불가 / 삭제 버튼 없음"이었다. 새 IP는 첫 칸에 내부 ID를 사람이 직접 넣어야 했고, 저장 뒤에는 읽기 전용 'IP 코드 · ID'와 별도의 공개 URL 폼이 함께 보여 "ID를 고칠 수 없다"로 읽혔다. 내부 ID는 굿즈·카드·주문·팔로우가 참조하므로 바꿀 수 없다(#473에서 공개 URL을 따로 떼어 냈다). 지우는 수단은 없고 복원 가능한 보관만 있었다 — 문서에도 "물리 삭제를 추가하지 않는다"고 적혀 있었다.

## 결정

1. **새 IP는 이름·공개 URL만 받는다.** 내부 ID는 처음 저장할 때 `admin_create_ip`가 공개 URL로 만들고, 이후 바꾸지 않는다. 다른 IP의 공개 URL·이전 URL·내부 ID와 같은 공개 URL은 등록할 수 없으므로(결정 2), 내부 ID에 `-2`·`-3`이 붙는 것은 공개 URL이 지운 IP의 내부 ID(퇴역 ID, 결정 5)와 같을 때뿐이다. 다음 번호도 기존 ID·공개 URL·이전 URL·퇴역 ID를 피한다. 판매자상품코드 접두가 내부 ID에서 나오므로(`goods_code_prefix`) 순번 대신 사람이 읽는 주소를 근거로 삼는다.
2. **내부 ID와 공개 URL은 한 이름 공간이다.** 링크 정규화가 `/ip/…`를 내부 ID와 공개 URL 양쪽으로 읽으므로, 공개 URL은 다른 IP의 내부 ID와도 겹칠 수 없다(등록·공개 URL 변경 모두).
3. **물리 삭제는 미사용 초안만 한다.** 지금 초안이고, 공개 이력이 없고, IP를 가리키는 모든 FK(앞으로 생길 FK 포함)와 FK 없는 참조(쿠폰 대상 IP·주문 품목 IP 스냅샷·IP 페이지로 가는 홈 전시 링크)가 0건일 때만 legacy admin·`platform.manage`가 지운다. 판정과 삭제는 DB가 식별자 잠금 → 행 잠금 아래 한 transaction에서 하고, 행 스냅샷·이전 URL·판단 근거를 `catalog.ip.deleted`로 감사한다. 화면은 같은 근거를 패널과 확인창에 보여 준다. 쿠폰 저장 RPC는 대상 IP를 잠그지 않고 읽으므로(웨이브 1에서 고친 함수라 재정의하지 않는다), `coupons`의 `coupons_lock_target_ips` 트리거가 이번 쓰기로 추가되는 대상 IP 행을 ID 순서로 FOR KEY SHARE 잠그고 모두 있는지 다시 확인한다. 삭제의 FOR UPDATE와 충돌하므로 쿠폰 저장과 삭제가 어느 순서로 겹쳐도 뒤에 온 쪽이 앞쪽 커밋을 기다린 뒤 거절된다(`coupon_target_ip_unavailable` / `ip_has_references`).
4. **공개 이력은 별도 원장으로 판정한다.** `private.ip_public_history`는 `published_at`이 채워지는 모든 쓰기(RPC·직접 SQL·seed)를 트리거로 남긴다. 게시 상태 seam(#452, 2026-09-09 main) 전에는 저장 즉시 공개됐으므로 그 전에 만든 IP는 공개 이력이 있는 것으로 백필했다. 기준 시각은 seam 뒤 첫 공개·비공개 감사 기록과 2026-09-10 00:00 KST 중 늦은 쪽이다 — 실제 배포보다 이르면 공개됐던 IP를 지울 수 있게 되기 때문이다.

   운영 확인(2026-11-12, 오케스트레이터가 운영 DB를 읽기 전용으로 조회): `select action, count(*) from public.audit_log where action in ('admin.ip.published', 'admin.ip.unpublished') group by action`은 0건이었고, `select target, action, created_at from public.audit_log where action in ('catalog.ip.archived', 'catalog.ip.unarchived')`는 9/1·9/14의 두 IP(`midew0309`·`test`, 둘 다 9/10 이전 생성)뿐이었다. 따라서 운영의 기준 시각은 2026-09-10 00:00 KST로 정해지고, '첫 감사 기록이 늦어 그 사이 초안까지 지울 수 없게 되는' 경우는 운영에 없다. 두 IP는 seam 전에 만들어져 공개 이력이 있는 것으로 기록된다.
5. **지운 내부 ID는 퇴역한다.** `private.retired_ip_ids`에 남겨 다시 발급하지 않는다. 공개 URL은 공개된 적이 없으므로 다시 쓸 수 있고, 공개된 적 없는 초안의 이전 URL 별칭도 함께 지운다(익명 RLS와 공개 해석기 모두 공개 IP만 보므로 공개 경로로 쓰인 적이 없다).
6. **`admin_upsert_ip`의 ID 직접 지정 신규 경로는 호환용으로 남긴다.** 스크립트·SQL 스모크가 쓰는 경로이며 어드민 화면은 쓰지 않는다. 퇴역 ID는 IP 삽입 트리거가 모든 경로에서 막는다(`catalog_id_retired`).

## 검토한 대안

- **앱에서 ID를 만든다.** migration은 없지만 겹침 판정과 삽입 사이에 경합이 생겨 `catalog_id_taken`이 운영자에게 보인다. 기각.
- **순번 ID(`ip-0001`).** 겹침이 없지만 판매자상품코드 접두(`I0`)가 무의미해진다. 기각.
- **별칭이 있으면 삭제를 막는다.** 공개된 적 없는 주소의 오타만 고쳐도 테스트 초안을 지울 수 없게 된다. 기각.
- **지운 ID를 다시 쓴다.** 감사 기록·쿠폰 대상·분석처럼 FK 없이 IP ID를 담은 기록이 새 IP를 가리킨다. 기각.
- **공개 이력을 감사 로그만으로 판정한다.** seam 전에 만든 IP와 직접 SQL 공개를 놓친다. 기각.
- **보관된 초안도 바로 지운다.** 결정의 대상은 '초안'이다. 공개된 적 없는 보관 IP는 복원(항상 초안)한 뒤 지운다.

## 결과

- seam 전에 만든 테스트 IP(9/7의 'IP-1 TEST' 같은)는 공개 이력이 있어 지울 수 없고 보관으로 정리한다.
- 쿠폰 대상 IP는 위 트리거로 삭제와 직렬화된다(`supabase/tests/ip_draft_delete_coupon_concurrency.sh`가 삭제 먼저·쿠폰 먼저·대상 추가 UPDATE 세 순서를 고정한다). IP 페이지로 가는 홈 전시 링크는 삭제 시점에 세기만 하고 잠그지 않는다.
- FK 없는 자유 텍스트 링크(쇼핑 스토리 본문·상세 HTML 등)는 세지 않는다. 공개된 적 없는 IP라 그런 링크는 404였지만, 같은 공개 URL을 다른 IP가 쓰면 새 IP를 가리키게 된다(잔여 위험).
- Storage에 올린 키아트·IP관 배너 파일은 지우지 않는다. 경로는 감사 스냅샷에 남는다.
- 검증: `supabase/tests/ip_draft_delete.sql`·`ip_draft_delete_coupon_concurrency.sh`(catalog 샤드), IP 등록·삭제 화면·액션 Vitest.

---
status: accepted
---

# PR 프리뷰는 전용 Supabase 프로젝트를 본다

Vercel Preview 배포는 프로덕션 Supabase 프로젝트(`sbutbsghcxmxmxgrshwq`)를 가리키고 있었고, `SUPABASE_SERVICE_ROLE_KEY`는 Preview·Production이 같은 항목 하나를 공유했다. 공개 카탈로그는 `resolveCatalogSource`가 `VERCEL_ENV=preview`에서 mock으로 fallback하지만 **어드민 콘솔은 `app/admin/page.tsx`·`app/admin/actions.ts`에서 `previewDefaultSource: 'supabase'`로 강제**한다. 인증·주문·결제·커뮤니티 쓰기도 같다. 즉 아무 PR의 프리뷰 배포가 RLS를 우회할 수 있는 키로 운영 데이터를 읽고 쓸 수 있었다.

동시에 `deploy-vercel-preview`에는 마이그레이션 단계가 없고 `deploy-supabase`는 `main` push 전용이라, 스키마를 바꾸는 PR은 프리뷰에서 **앱은 새 버전, DB는 구 버전**이 됐다([#196](https://github.com/sangwopark19/icons-ip/pull/196)에서 `admin_search_orders`의 신규 컬럼이 없어 어드민 주문 섹션 전체가 fail closed로 터졌다. [#197](https://github.com/sangwopark19/icons-ip/issues/197)).

프리뷰 전용 Supabase 프로젝트를 하나 상시 운영하고, `deploy-supabase-preview` job이 프리뷰 배포 **전에** 마이그레이션을 올린다. production의 `deploy-vercel → needs: deploy-supabase` 순서와 같은 모양이 된다.

## Considered Options

- **PR마다 Supabase 브랜치** — 시간당 $0.01344(열려 있는 동안만)로 짧은 PR이면 더 싸고, PR의 스키마와 정확히 일치한다. 하지만 브랜치마다 API URL·키가 달라져 Vercel의 정적 Preview 환경변수로는 표현할 수 없다. `vercel deploy`에 env를 동적으로 주입하고, 브랜치 생성 완료를 기다리고, PR close 시 삭제하는 workflow를 새로 만들어야 한다. 배선이 늘어난 만큼 조용히 어긋날 자리도 늘어난다. 폐기.
- **스키마 변경 PR은 프리뷰를 건너뛴다** — 비용 0, 변경 최소. "깨진 프리뷰보다 없는 프리뷰가 정직하다"는 맞지만 프리뷰가 운영 DB를 보는 문제가 그대로 남는다. 폐기 — 다만 프리뷰 secret이 없을 때의 **fallback 동작**으로는 채택했다.
- **문서화만 한다** — 위와 같은 이유로 폐기.
- **전용 프로젝트 1개 상시 (채택)** — 월 $10. Preview 환경변수가 정적이라 배선이 단순하고, 운영 DB 노출이 즉시 사라진다.

## Consequences

- **월 $10이 든다.** 되돌릴 수 있는 비용이지만 조직에 프로젝트가 하나 늘고 seed·Auth 설정을 관리해야 한다.
- **프리뷰 DB 하나를 모든 열린 PR이 공유한다** → 마이그레이션이 누적된다(대상 스키마 ⊇ 각 PR의 스키마). #196식 "컬럼 없음" 실패는 사라지고, 남는 위험은 폐기된 PR이 남긴 잔여 객체뿐이다. 프리뷰 DB에는 운영 데이터를 두지 않으므로 언제든 리셋할 수 있다.
- **서로 다른 PR의 프리뷰 job이 같은 프로젝트에 동시에 `db push`할 수 있다.** workflow concurrency group은 ref별이라 PR 사이에는 직렬화되지 않는다. Supabase의 migration 잠금 때문에 한쪽이 실패할 수 있으며, 그 경우 재실행하면 통과한다.
- **매 프리뷰 배포가 `supabase/seed.sql`을 다시 적용한다.** 멱등(`on conflict do update`)이라 리뷰어가 같은 카탈로그 기준선을 보지만, 프리뷰 어드민에서 카탈로그 값을 바꿔둔 채 새 커밋을 올리면 그 값은 되돌아간다.
- **프리뷰 카탈로그는 프로덕션과 같다.** 공개 카탈로그 baseline이 immutable migration으로 관리되기 때문에(홍실 퀘스트도 `20260804061616_add_hong_sil_quest_catalog.sql`) `db push`만으로 프로덕션과 같은 내용이 들어온다 — 첫 적용 실측: ips 6, goods 15, cards 12, events 5, home_curations 5로 프로덕션과 동일. seed는 그 위에 mock IP 값을 다시 덮는 역할만 한다. 콘텐츠 QA도 프리뷰에서 가능하다. 어드민으로 새로 만든 레코드는 migration에 없으므로 프리뷰에 나타나지 않는다.
- **프리뷰가 실제 스테이징이 된다.** Preview 환경변수에 `ICONS_CATALOG_SOURCE=supabase`를 두어 공개 화면도 프리뷰 DB를 읽는다. 스키마 변경이 공개 화면까지 검증된다.
- **프리뷰 secret이 없으면 프리뷰 배포를 건너뛴다.** `deploy-supabase-preview`가 `configured=false`를 내고 `deploy-vercel-preview`가 skip되며, warning과 step summary로 이유를 남긴다. 프리뷰를 공유 링크로 쓰는 작업(프로토타입 배포 등)은 구성 전까지 새 배포를 만들 수 없다.
- **프리뷰 ref가 운영 ref와 같으면 job이 실패한다.** 설정 실수로 프리뷰가 다시 운영 DB를 가리키는 일을 코드로 막는다.
- **Auth allow-list가 두 갈래로 갈린다.** 프리뷰 호스트 callback은 프리뷰 프로젝트에서 관리하고 운영 allow-list에서는 제거한다. `scripts/sync-supabase-auth.mjs`가 두 프로젝트에 각각 적용·검증하며, 폐기된 항목은 명시적 prune으로만 사라진다 — Supabase 설정은 한 번 들어간 값을 스스로 지우지 않는다. 이 정리 과정에서 운영 allow-list의 `icons-ip-*.vercel.app` 패턴이 실제 프리뷰 호스트(`icons-<hash>-<team>.vercel.app`)와 애초에 매칭되지 않았다는 것도 드러났다.
- **되돌리기 비용**: 프로젝트를 지우고 Preview 환경변수를 운영 값으로 되돌리면 원상복구되지만, 그 순간 프리뷰가 다시 운영 데이터에 붙는다 — 그래서 기록한다.

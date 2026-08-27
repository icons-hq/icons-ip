---
status: accepted
---

# PR 프리뷰 DB를 shared main과 isolated branches로 분리한다

Vercel Preview가 production Supabase 프로젝트를 보던 초기 문제를 막기 위해 2026-08-11부터 전용 프로젝트 `icons-ip-preview`를 운영했다. 그러나 모든 PR migration을 이 프로젝트 하나에 누적하는 방식은 다른 종류의 교차 오염을 만들었다. 아직 merge되지 않은 PR이 먼저 올린 migration은 shared preview의 remote history에 남고, 그 migration 파일이 없는 다른 PR의 `supabase db push`를 실패시켰다. PR #321의 migration 7개가 다른 PR preview를 막은 사례가 전환 계기다.

## Decision

- Production 프로젝트 `icons-ip`는 production 배포만 사용한다. Preview workflow는 production ref와 일치하면 즉시 실패하며 production 데이터나 자격 증명을 복제하지 않는다.
- `icons-ip-preview`의 default `main` branch는 repo `main`의 schema, roles, seed, Auth template와 Edge Functions를 유지한다. `push` to `main`에서 production Supabase와 앱 배포가 모두 성공한 뒤 `sync-supabase-preview-main`이 같은 선언 상태를 적용한다. sync mutation 직전 run SHA와 현재 원격 `main`이 정확히 같은지도 확인해 과거 main run 재실행은 fail closed한다.
- `main` 대상 PR의 merge-base 기준 전체 diff에 Supabase 배포 상태를 바꾸는 파일이 없으면 Vercel Preview는 `icons-ip-preview/main`을 읽는다. rename은 원본과 대상 경로를 모두 판정하도록 Git rename detection을 끈다. 이때 PR base SHA의 push/main run에서 production migration과 shared preview sync가 모두 성공했다는 Actions 증거를 먼저 확인한다. PR workflow는 shared main에 migration, seed, Auth 설정을 쓰지 않는다. Preview Auth·배포 계약을 담는 `.github/workflows/pipeline.yml` 변경은 보수적으로 isolated로 분류한다.
- 통합 브랜치처럼 base가 `main`이 아닌 PR은 현재 stage diff가 앱 전용이어도 누적된 선행 migration에 의존할 수 있으므로 항상 isolated를 쓴다. base retarget도 preview를 다시 배포하되 제목·본문 편집은 제외하고 실행 중인 Preview run도 취소하지 않는다. isolated branch는 parent의 현재 schema보다 오래된 PR을 조용히 superset으로 검수하지 않도록 PR head가 현재 repo `main`을 포함할 때만 만든다. branch 생성 직후 최신 `main` ancestry를 한 번 더 확인해 최초 검사와 parent snapshot 사이의 경쟁도 fail closed한다.
- `supabase/migrations/**`, `supabase/functions/**`, `supabase/templates/**`, `supabase/roles.sql`, `supabase/seed.sql`, Auth/Function sync script, preview mode script, Preview 생성·cleanup workflow 중 하나라도 바뀌면 무데이터 Supabase Preview Branch `pr-<number>`를 만든다. Hosted `supabase/config.toml` 전체 push는 production/local 환경 경계가 별도로 필요하므로 이 분류기의 배포 계약에서 제외한다.
- PR Supabase 상태는 review 중 수정·삭제될 수 있으므로 isolated branch는 각 workflow 실행에서 기존 `pr-<number>`를 지운 뒤 현재 PR head로 다시 만든다. 생성 시 production 데이터를 clone하지 않고 migration, custom roles, seed와 repo의 전체 Edge Function 집합을 적용한다. Vercel preview handler가 성공한 뒤 recovery template를 branch에 적용·readback한다. 함수 집합이 비면 안전한 원격 이름만 명시 삭제한 뒤 catalog baseline을 확인한다.
- Vercel CLI는 배포 직전에 선택된 `main` 또는 `pr-<number>`의 URL·publishable key·service role key를 Supabase Management API에서 다시 읽어 build-time과 runtime에 동적으로 주입한다. secret 값은 job output으로 전달하지 않는다.
- PR이 close 또는 merge되면 최종 base branch와 무관하게 별도 cleanup workflow가 해당 non-default `pr-<number>`만 삭제한다. Preview pipeline과 cleanup은 같은 repo-wide per-PR concurrency key를 사용하므로 생성 중 close되거나 `main`에서 다른 base로 retarget되어도 cleanup이 뒤에서 기다린다. app-only로 바뀐 PR에 남은 동일 이름의 branch도 다음 preview 실행에서 삭제한다.
- `.vercelignore`는 로컬 `outputs/` 제작 산출물을 명시적으로 제외한다. Preview workflow는 Vercel dry-run manifest에서 이 경로가 포함되거나 source가 900MB·15,000개에 도달하면 실제 upload 전에 실패한다. Vercel에는 review 중인 repo 파일과 최종 runtime asset만 전송한다.

## Mode selection

| PR 변경 | Supabase target | PR의 remote mutation |
| --- | --- | --- |
| `main` 대상 + 앱·UI·문서·테스트만 | `icons-ip-preview/main` | 없음 |
| `main` 대상 + migration/roles/seed/Auth/template/Edge Function/preview lifecycle 등 | `icons-ip-preview/pr-<number>` | branch 재생성 후 현재 PR schema·roles·seed·함수·template 적용 |
| `main` 외 통합 브랜치 대상 | `icons-ip-preview/pr-<number>` | 누적된 base DB 상태까지 현재 head에서 적용 |
| fork PR | 없음 | secret 경계 때문에 validate만 실행 |

## Considered Options

- **Preview가 production을 본다** — 운영 데이터와 service role key가 PR 코드에 노출되므로 폐기한다.
- **모든 PR이 shared preview에 migration을 누적한다** — 배선은 단순하지만 unmerged migration drift가 다른 PR을 실패시키고, 어느 PR의 schema인지 설명할 수 없어 폐기한다.
- **모든 PR에 branch를 만든다** — 가장 단순한 격리 모델이지만 `main` 대상 앱 전용 변경에도 branch 생성 시간과 compute 비용이 든다. `main` 대상에서는 DB 배포 변경 PR만, `main` 외 통합 브랜치 대상에서는 모든 PR을 격리하는 hybrid를 채택한다.
- **DB 변경 PR은 Preview를 건너뛴다** — drift는 없지만 앱과 새 schema의 통합 검수를 잃으므로 폐기한다.
- **Supabase GitHub integration이 lifecycle을 소유한다** — Vercel Git 자동 배포가 꺼져 있고 GitHub Actions가 현재 배포 진실원이므로, branch lifecycle도 Supabase CLI를 호출하는 workflow가 소유한다.

## Consequences

- 다른 PR의 unmerged migration은 shared main이나 서로의 branch에 들어가지 않는다. PR #321 같은 대형 기능 preview가 열려 있어도 앱 전용 PR과 다른 schema PR의 CI를 막지 않는다.
- main migration 뒤 shared sync가 아직 실행 중이거나 실패하면 app-only PR도 shared Preview를 만들지 않는다. 이 sync job을 처음 도입하는 bootstrap PR만 base workflow에 job 정의가 없음을 확인하고 예외 처리하며, 이후 base SHA에는 성공 증거를 강제한다.
- isolated preview는 branch 생성 대기만큼 느려지고 branch compute 비용이 든다. branch는 PR close 때 삭제하며, `main` 대상의 DB 변경 없는 PR에는 만들지 않지만 통합 브랜치 대상 PR은 누적 schema 정합성을 위해 항상 만든다.
- isolated branch는 무상태 review 환경이다. 새 commit마다 재생성되므로 어드민에서 만든 임시 데이터는 보존되지 않고, 이전 commit의 Vercel URL은 branch 교체·삭제 뒤 DB 기능이 깨질 수 있다.
- shared main도 운영 데이터는 갖지 않는다. catalog baseline은 versioned migration과 멱등 seed로 만들며 production 콘텐츠를 dump/clone하지 않는다.
- Preview Auth에는 custom SMTP를 강제하지 않는다. callback allow-list와 OTP TTL은 shared main에서는 main sync가, isolated branch에서는 branch 생성 workflow가 관리한다. 전역 recovery template의 실제 production 활성화는 계속 production 배포 뒤에만 수행한다.
- GitHub Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PREVIEW_PROJECT_ID`, `SUPABASE_PROJECT_ID`는 PR branch 선택과 production guard에 필요하다. `SUPABASE_PREVIEW_DB_PASSWORD`는 shared main을 repo main으로 동기화할 때만 쓴다.

## Recovery

- isolated branch가 stale하거나 migration history가 의심되면 해당 PR의 preview job을 rerun한다. workflow가 `pr-<number>`를 재생성한다.
- close cleanup이 실패하면 production/default branch가 아닌 정확한 `pr-<number>`인지 확인한 뒤 cleanup workflow를 rerun하거나 Supabase CLI로 그 branch만 삭제한다.
- shared main이 repo main과 다르면 production ref가 아님을 먼저 확인하고, `icons-ip-preview`를 main migration + seed로 reset한 뒤 `sync-supabase-preview-main`을 rerun한다.
- 어떤 복구 절차에서도 production 프로젝트를 reset하거나 Preview target으로 사용하지 않는다.

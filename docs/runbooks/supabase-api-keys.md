# Supabase API 키 전환 — legacy JWT → publishable·secret

Supabase는 legacy `anon`·`service_role` JWT 키를 2026년 말까지 폐기한다([공식 가이드](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)). 이 저장소는 브라우저에 `sb_publishable_…`, 서버에 `sb_secret_…`만 쓴다. 앱 env 이름 `SUPABASE_SERVICE_ROLE_KEY`는 유지한다. secret 키도 Postgres `service_role` 권한으로 해석되기 때문이다.

## 현재 상태 — 2026-10-06 실측

| 대상 | 새 키 | legacy 키 | 실제 사용 |
| --- | --- | --- | --- |
| Production `icons-ip` (`sbutbsghcxmxmxgrshwq`) | `default` publishable·secret 있음 | 활성 | API gateway 로그(09-29·10-02·최근 24h): 서버 요청 전부 `sb_secret_`(supabase-js 2.108.2, Node 24.20.0), 브라우저는 `sb_publishable_`. legacy JWT apikey 0건 |
| Vercel Production env | — | `NEXT_PUBLIC_SUPABASE_ANON_KEY` 잔존 | 라이브 번들의 키 = production `default` publishable. 서버 키 = production `default` secret(로그 접두 일치). anon env는 코드가 읽지 않는다 |
| Preview `icons-ip-preview` (`glwypjldklwpgdtymktm`)·`staging` (`vjloqfsghxuleabehgpo`)·`pr-<n>` | `default` publishable·secret 있음 | 활성 | 이 runbook을 추가한 PR 전까지 CI가 `branches get`의 legacy `service_role` JWT를 preview·staging 배포에 주입했다 |
| Vercel Preview env baseline | — | 값 형식 미확인(sensitive) | 정상 CI 배포는 매번 branch 값으로 덮는다 |
| Edge Functions | 없음 | — | production 원격 목록·repo `supabase/functions` 모두 비어 있다 |
| 사용자 access token | — | — | ES256 비대칭 signing key로 발급 중이다. JWT signing key 전환은 별도 작업이며 이미 끝났다 |

## 새 키가 같은 권한을 내는 근거

- API gateway가 `apikey`의 publishable·secret 키를 확인한 뒤 `anon`·`service_role` role의 짧은 수명 JWT를 만들어 Postgres로 넘긴다([JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)). 그래서 RLS, migration의 `auth.role()='service_role'` 조건, `grant … to service_role`이 그대로 동작한다.
- supabase-js는 같은 키를 `apikey`와 `Authorization: Bearer`에 함께 싣는다. preview에서 실측한 결과는 다음과 같다. Auth admin `GET /auth/v1/admin/users`는 secret 키로 200이다. service_role 전용 RPC `get_bank_transfer_settings`는 secret 키로 200, publishable 키로 401이다.
- secret 키는 브라우저 User-Agent에서 401이다. 이 저장소는 `lib/supabase/service.ts`(`server-only`)와 배포 스크립트에서만 쓴다.
- 공개 Realtime 연결은 24시간 제한이 있다. 문의 실시간 구독은 로그인 세션으로 연결하므로 해당하지 않는다.
- 앱 코드는 키를 디코딩하거나 role claim을 읽지 않는다. 빌드 가드와 배포 스크립트는 형식(`sb_publishable_`·`sb_secret_` 접두)만 본다.

## `supabase branches get`의 함정

CLI는 키 이름으로 필드를 만든다(`SUPABASE_<NAME>_KEY`, publishable `default`만 `SUPABASE_PUBLISHABLE_KEY`). `SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_ANON_KEY`는 legacy JWT다. `SUPABASE_DEFAULT_KEY`는 `sb_secret_xxxxx·····`처럼 **마스킹된** secret이라 그대로 쓸 수 없다. 배포 경로(`pipeline.yml`의 Vercel preview, `scripts/staging-environment.mjs`)는 선택한 branch ref에서 `supabase projects api-keys --reveal --output json`을 호출하고 `type`이 publishable·secret이며 `name == "default"`인 활성 키만 고른다. 형식이 틀리거나 마스킹돼 있으면 배포 전에 실패한다.

## 남은 전환 순서

사람 단계는 운영 설정 변경이다. 에이전트는 운영 env 값을 바꾸지 않고 로그·CI 확인만 한다.

1. **[에이전트] 코드 PR 병합 뒤 CI 확인.** PR preview의 `Load exact Supabase credentials for deployment`와 main push의 `deploy-staging`이 새 키로 성공하는지 본다.
2. **[사람] Vercel Preview baseline 교체.** `SUPABASE_SERVICE_ROLE_KEY`(Preview)와 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(Preview)를 parent preview의 `default` secret·publishable 키로 다시 넣는다. sensitive 값은 되읽을 수 없으므로 확신이 없으면 덮어쓴다. `./scripts/setup-preview-supabase.sh` 2·3단계가 이 작업을 안내하며 legacy 형식을 거부한다.
3. **[사람] 로컬 `.env.local`·외부 도구 점검.** 개발자 PC와 외부 도구(노트, 자동화 서비스 등)에 legacy JWT가 남아 있으면 새 키로 바꾼다. 로컬 스택은 `npm run dev:local`이 `supabase status`의 `PUBLISHABLE_KEY`·`SECRET_KEY`를 주입한다.
4. **[사람] Preview legacy 키 비활성화(canary).** Dashboard → `icons-ip-preview` → Settings → API Keys → Legacy API keys에서 비활성화한다. `staging` branch 프로젝트도 각각 확인한다. 이어서 PR preview 하나와 staging(`https://icons-ip-staging.vercel.app`)에서 로그인·상품 목록·관리자 화면을 확인한다. 새로 생성되는 `pr-<n>` branch에는 legacy 키가 다시 활성일 수 있지만 CI는 쓰지 않는다.
5. **[에이전트] Production legacy 사용 0건 재확인.** 비활성화 직전에 아래 로그 쿼리를 최근 24시간과 며칠 전 구간에서 돌린다. `apikey_kind`가 빈 요청은 public Storage GET·CORS `OPTIONS`·Realtime upgrade뿐이어야 한다.
6. **[사람] Production legacy 키 비활성화.** 같은 Dashboard 경로에서 production을 비활성화한다. 직후 홈·로그인·장바구니→결제 진입·관리자·문의 실시간·결제 웹훅(토스)·이메일 cron을 확인한다.
7. **[사람] Vercel Production `NEXT_PUBLIC_SUPABASE_ANON_KEY` 삭제.** 코드가 더는 읽지 않는 잔존값이다.

**Rollback:** 비활성화는 되돌릴 수 있다. 문제가 생기면 같은 화면에서 legacy 키를 다시 활성화하고 원인을 찾는다. legacy 키를 삭제하지 않는다.

```sql
-- Production logs (Supabase MCP query_logs 또는 Logs Explorer)
select substring(log_attributes['request.sb.apikey.apikey.prefix'], 1, 14) as apikey_kind,
       log_attributes['request.method'] as method,
       arrayStringConcat(arraySlice(splitByChar('/', splitByChar('?', log_attributes['request.path'])[1]), 1, 4), '/') as path,
       count() as n
from logs
where source = 'edge_logs'
group by apikey_kind, method, path
order by n desc
limit 50
```

## 선택 후속

- 구성 요소별 secret 키(예: Vercel 앱과 운영 스크립트)를 따로 만들면 하나가 유출돼도 그 키만 교체할 수 있다. 이때 배포 스크립트의 `name == "default"` 선택도 함께 바꾼다.
- env 이름을 `SUPABASE_SECRET_KEY`로 바꾸는 작업은 폐기 대응에 필요하지 않다. 바꾸려면 Vercel Production·Preview 값과 코드의 이중 읽기 기간을 따로 계획한다.

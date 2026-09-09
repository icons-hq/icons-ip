# 운영 콘솔 스테이징

관련: #416 · #434 · ADR-0006 · ADR-0014. 운영 연습 데이터는 production에서 복제하지 않는다.

## 현재 배포·인수 상태 — 2026-09-09

고정 연습 환경은 [운영 콘솔 스테이징](https://icons-ip-staging.vercel.app/admin)이다. 운영자 5명의 로그인·역할을 확인했으며, 상품·주문·문의 연습에 사용할 수 있다. 사용자가 공개 정책 변경·main 병합·production 배포를 승인했고, 최신 main `abed200da1c5e2c7033d1166fea42db8b5cf5984`의 [Actions 34309609698](https://github.com/icons-hq/icons-ip/actions/runs/34309609698)는 validate·production DB·앱·shared Preview 동기화·staging 배포 모두 성공했다.

| 환경/검증 | 확인 결과 |
| --- | --- |
| 고정 URL | `https://icons-ip-staging.vercel.app` |
| 첫 성공 배포 | main `abed200da1c5e2c7033d1166fea42db8b5cf5984` / run `34309609698` / 2026-09-09 |
| 실제 Vercel 배포 | `https://icons-1irsokmag-sangwopark19icons-1055s-projects.vercel.app`, READY. 독립 Vercel API의 commit SHA와 고정 alias 연결 확인 |
| 분리된 DB | `vjloqfsghxuleabehgpo`, branch `staging`, ID `3dcb76aa-3b78-495e-bf2c-7c3ba7530ec6` |
| branch 경계 | parent `glwypjldklwpgdtymktm`, persistent=true / with_data=false / is_default=false |
| DB 계약 | migration 152개·SQL 2,986문·함수 409개 정의/ACL·테이블 14개·컬럼 5개가 격리 cold 기준과 일치 |
| 시드 초기 검증 | 지정 IP 1개·상품/기본 옵션 20개씩·주문/품목/배송 건/연결 120개씩·문의/메시지 10개씩. 예약 prefix 추가행과 잘못된 연결 0 |
| 공개 앱 연결 | HTML과 실제 로드된 JS 12개 HTTP200, Supabase ref는 staging 하나만 존재. lazy route chunk 전체 검사는 아님 |
| 로그인·권한 | admin 1명·staff 4명 로그인/서버 역할 확인. staff4의 admin 전용 설정 RPC는 403/42501로 거절되고 설정 hash 불변 |
| 실시간 연결 | admin/staff 구독·DB handshake 확인 후 채널/검증 세션 정리. 실제 데이터 이벤트 전달 시험은 아님 |
| 관리자 경로·시각 검수 | 39개 경로 HTTP200·JS 오류0·가로넘침0. 개요·상품·문의·출고지·발송 콘솔 5화면 시각 검수 통과. 모든 업무 수행의 증거는 아님 |
| 다음 main 자동 갱신·보존 | 아직 미실행. 이 런북을 반영하는 정상 docs PR 병합 전후에 같은 branch·계정·연습값을 비교한다 |
| 실제 운영팀 S1~S5 | 미실행. [운영팀 기록표](admin-ops-rehearsal.md#운영팀-실행-기록표)에 실제 수행 결과를 남긴다 |

Supabase branch 제어 상태에는 `MIGRATIONS_FAILED`가 남아 있지만 프로젝트 상태는 `ACTIVE_HEALTHY`다. 이 표시는 위 성공한 명시적 migration·함수/권한·시드 readback과 구분해 기록하며, 상태 문자열만으로 branch를 재생성하지 않는다. 시드 건수는 2026-09-09 13:24 KST의 첫 검증값이다. 이후 승인된 연습으로 추가·수정되는 행을 초기 시드 오류로 취급하지 않는다.

Production은 `https://iconsip.com` / ref `sbutbsghcxmxmxgrshwq`다. PR #452의 첫 production 배포와 공개 정책·FAQ 게시 후, 최신 `abed200`에서도 post-a2 기준 22테이블 projection 불변과 FAQ 4건 전체 필드 일치를 확인했다. 이는 과거 업그레이드 전 22개 중 19개만 정확히 비교됐던 한계나 shared 환경 사고의 사전 snapshot 부재를 소급 해소한 증거가 아니다.

첫 main run `34307232378`은 production 배포 성공 후 staging seed의 세션 표식 오류로 중단됐다. PR #456의 같은 트랜잭션 `SET LOCAL` 보정을 거쳐 위 첫 staging 배포가 성공했다. 이전 실패·격리 rollback 시험은 이력으로 보존한다.

증거 원본은 checkout 밖 `/tmp/icons-admin-redesign-evidence/release-approved-20260909/`에 있다. 배포 결속은 `staging/deployment-readback.json`, DB는 `staging/run-20260909T042433561967Z/database-readback.json`, 계정은 `staging-operators/login-readback.json`, 앱/실시간 연결은 `staging/runtime-readback/`, 경로 읽기·시각 검수는 `staging/browser/browser-coverage.json`·`vision-review.json`을 따른다. 운영 인계 시 원본과 SHA를 내부 보관소로 옮기고 비밀값·고객 필드를 문서나 이슈에 복사하지 않는다.

## Hosted 운영자 계정

| 로그인 아이디 | 역할 | Hosted 사용자 ID |
| --- | --- | --- |
| `ops-admin@staging.icons.test` | admin | `bfe21587-19ba-4efc-9210-9f8dd33e4fbb` |
| `ops-staff1@staging.icons.test` | staff | `297c7452-4299-4c8c-aec6-789017c404ab` |
| `ops-staff2@staging.icons.test` | staff | `b1b5cb72-4f9e-4ef7-b769-ca5e39f037e6` |
| `ops-staff3@staging.icons.test` | staff | `84dd94fd-7311-4b28-8ee4-aa0d7edb18cf` |
| `ops-staff4@staging.icons.test` | staff | `cd47b78f-e4fd-4798-84a3-38766bd1b4e4` |

5명 모두 비밀번호 로그인·서버 역할·온보딩을 확인했다. `.test` 주소는 로그인 식별자이며 실제 메일함은 아니다. 비밀번호와 접근 안내는 소유자만 읽는 별도 보관소에 준비했다. 소유자가 담당자에게 안전하게 전달하고 개인별 인수 여부를 기록한다. 이 문서·GitHub·녹화에는 비밀번호를 넣지 않는다. 아래 로컬 계정 이력과 hosted ID를 혼용하지 않는다.

## 과거 검증 기록 — 2026-09-08

아래 표는 당시 조회·로컬 검증 기록이다. 현재 배포 상태는 위 표를 따른다.

| 환경 | 대상 | 실측 상태 |
| --- | --- | --- |
| Production | `icons-ip` / `sbutbsghcxmxmxgrshwq` | 프로젝트 목록만 조회. 이 작업의 mutation 없음 |
| Shared Preview | `icons-ip-preview/main` / `glwypjldklwpgdtymktm` | branch 목록에서 default 확인. 이 작업의 mutation 없음 |
| Hosted staging | `icons-ip-preview/staging` | 아직 생성·배포하지 않음. 고정 URL과 hosted 로그인 검증 대기 |
| 로컬 운영 연습 | 앱 `http://127.0.0.1:3300`, API `http://127.0.0.1:55421`, DB `55432` | 아래 계정 5개 생성, 비밀번호 로그인 및 역할 조회 5/5 통과 |
| 마이그레이션 검증 | 별도 빈 DB `127.0.0.1:55433` | 전체 migration부터 적용. staging seed 120 주문·10 문의·20 굿즈 및 재실행 보존 검증 통과 |

로컬 API·DB는 이번 작업 전용 프로세스다. 컴퓨터 재시작 뒤 고정 스테이징처럼 사용할 수는 없다. hosted URL을 검증하기 전에는 #416의 접속·자동 배포 게이트를 완료로 표시하지 않는다.

## 로컬 운영 연습 계정 이력 — 2026-09-08

사용자가 실제 업무 메일 제공 대신 계정 생성을 위임했다. `.test` 주소는 Auth 로그인 식별자이며 실제 메일함은 생성하지 않는다. 메일 인증은 생성 시 완료 처리하고 비밀번호로 로그인한다. 메일 수신·비밀번호 재설정 메일 리허설은 실제 업무 주소 전환 후 별도로 검증한다.

| 로그인 아이디 | 초기 역할 | 로컬 사용자 ID |
| --- | --- | --- |
| `ops-admin@staging.icons.test` | admin | `66bd5c5e-6a0b-498b-9e1b-60c4a247e28d` |
| `ops-staff1@staging.icons.test` | staff | `b814ac8b-556d-4211-88c2-2e45e105e184` |
| `ops-staff2@staging.icons.test` | staff | `202d168b-d0eb-48d9-8a26-d05e75c7155b` |
| `ops-staff3@staging.icons.test` | staff | `602e06bb-8c9c-4cde-b989-f7c41680fca4` |
| `ops-staff4@staging.icons.test` | staff | `73905731-919c-442b-ac47-b047b9acce67` |

당시 로컬 초기 비밀번호는 소유자만 읽는 `0600` 파일 `/tmp/icons-admin-redesign-evidence/local-qa-accounts.json`에 있다. Git·이슈·로그에 비밀번호를 기록하지 않는다. `/tmp`는 임시 보관소이므로 소유자가 비밀번호 관리자에 보관한다. hosted 생성 시 같은 로그인 아이디를 사용하되 비밀번호와 사용자 ID는 환경마다 새로 생성한다.

## 최초 생성·배포 절차

1. 이번 공개 정책 변경·main/production 배포는 사용자 승인을 받아 진행했다. 후속 작업도 기존 승인 범위와 대상 환경에 결속한다. `main` merge는 production 경로도 시작하므로 별도 Preview 배포와 혼동하지 않는다.
2. GitHub의 기존 `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PREVIEW_PROJECT_ID`, `SUPABASE_PROJECT_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`를 사용한다. Toss 키는 Vercel `icons-ip` 프로젝트의 기존 Preview `NEXT_PUBLIC_TOSS_CLIENT_KEY`·`TOSS_SECRET_KEY`를 그대로 상속한다. 별도 `STAGING_TOSS_*` GitHub secret을 만들거나 키를 다운로드하지 않는다. 두 키 이름은 배포 인자의 `--build-env`·`--env`에서도 덮어쓰지 않는다.
3. 고정 alias 기본값은 `icons-ip-staging.vercel.app`이다. 선점돼 있으면 GitHub variable `STAGING_ALIAS`에 `icons-ip-staging-ops.vercel.app` 같은 미사용 대안을 지정한다. production alias를 받지 않는다.
4. `deploy-staging`은 성공한 `sync-supabase-preview-main` 뒤 실행된다. 실행 SHA가 현재 main인지 확인하고, 존재하지 않을 때만 `--persistent` 무데이터 `staging` branch를 만든다. 기존 staging은 삭제·reset하지 않는다.
5. 앱 배포 전에 해당 branch에 migration·roles, 누락된 demo fixture, repo Edge Functions, Auth URL을 적용한다. 일반 `supabase/seed.sql`을 매번 재적용하지 않는다. demo 시드는 `supabase/seeds/admin-ops-staging.sql`만 사용한다. 시드 허용 표식은 접속 시작 옵션 `PGOPTIONS`에 의존하지 않고, `psql --single-transaction -c "SET LOCAL app.staging_seed_enabled = 'admin-ops-v1'" -f -`로 시드 파일과 같은 트랜잭션 안에서 설정한다. `ON_ERROR_STOP=1`로 표식 설정이나 시드가 실패하면 해당 트랜잭션 전체를 rollback하며, 시드 파일의 격리 세션 guard는 유지한다.
6. Vercel Preview의 build/runtime에 동일한 staging ref를 주입한다. `vercel deploy --archive=tgz`의 원격 `prebuild`가 상속된 **test 모드 주문서형 키 페어의 형식**과 닫힌 결제 gate·비어 있는 canary를 검사한다. 고정 서버 빌드 표식 `ICONS_STAGING_BUILD=admin-ops-v1`과 세 환경 ref는 `--build-env`에만 넣고, Preview 대상·허용된 staging `SITE_URL`·분리된 Supabase ref를 함께 검증한다. 표식·검증용 ref는 runtime 변수나 `NEXT_PUBLIC_*`로 전달하지 않는다. 원격 빌드 성공 후에만 고정 alias를 연결한다. Auth redirect 두 경로는 alias의 `/auth/callback`, `/auth/recovery/callback`이다. 앱 배포 후 recovery template를 활성화한다.

2026-09-08 읽기 점검에서 기존 Preview Toss 변수 두 항목은 branch 제한 없이 `sensitive`로 존재했고, 읽기 API와 공식 `vercel pull --environment=preview`는 키 값을 반환하지 않았다. 이후 첫 staging 원격 빌드가 상속된 test 모드·키 페어 형식과 닫힌 결제 gate 검사를 통과했다. 키 원문을 내려받거나 문서에 기록하지 않았다. Vercel [Secret 값은 저장 후 읽을 수 없으며](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [Preview 배포의 빌드와 함수에는 해당 환경 값이 적용된다](https://vercel.com/docs/environment-variables). 로컬 `pull`의 빈 값으로 기존 키가 없다고 판정하거나 Secret을 읽기 가능한 타입으로 바꾸지 않는다.

원격 검사 실패는 키 값 없이 원인만 Vercel 빌드 로그에 남기고 alias 갱신을 막는다. 해당 로그에서 키 누락·live 모드·형식 오류가 확인될 때만 소유자가 원본 보관처의 테스트 키를 확인하고 명시적 승인 범위에서 기존 Preview 설정을 수정한다. 일반 Preview 빌드는 기존처럼 구 키를 허용하며, 이 staging 검사가 신규 결제 gate를 열지는 않는다. 상속은 키 복제 절차를 없애지만 실제 PG 호출이나 같은 상점 소속 증명까지 대신하지 않는다.

Supabase 공식 [Branching 문서](https://supabase.com/docs/guides/deployment/branching)의 persistent branch와 무데이터 생성 계약을 사용한다. 이 workflow는 Supabase GitHub integration의 자동 seed나 hosted `config.toml` 전체 push에 의존하지 않는다.

## Hosted 운영자 계정 생성·재실행

위 5계정은 생성 완료했다. 최초 생성 또는 중간 실패 복구에는 로컬의 인증된 Supabase CLI로 다음 스크립트를 사용한다. 이 스크립트는 branch를 생성하지 않으며, healthy·persistent·non-default·무데이터인 preview 자식 `staging`만 받는다.

```sh
SUPABASE_PREVIEW_PROJECT_ID=glwypjldklwpgdtymktm \
SUPABASE_PRODUCTION_PROJECT_ID=sbutbsghcxmxmxgrshwq \
STAGING_ACCOUNTS_FILE=/absolute/private/location/icons-staging-passwords.json \
node scripts/staging-accounts.mjs
```

비밀번호 파일은 checkout 밖 절대 경로로 지정한다. 새 파일을 `0600`으로 먼저 저장하므로 중간 실패 시 같은 파일로 다시 실행할 수 있다. 기존 계정은 생성 표식이 있어야 하며, 최초 설정 완료 뒤 재실행은 비밀번호·역할·프로필을 초기화하지 않는다. 생성 표식이 없는 동일 이메일은 권한을 부여하지 않고 중단한다. 운영자가 변경한 역할 복구나 비밀번호 분실은 별도의 명시적 계정 관리 작업이다.

생성 결과의 사용자 ID·로그인·서버 역할은 위 hosted 표에 기록했다. 실제 운영자에게 계정을 전달한 뒤 `/admin` 접근과 담당 업무 수행을 확인한다. 계정의 정상 로그인 증거를 운영팀 리허설 완료로 대신하지 않는다.

## 데이터·결제 경계

- 고정 demo ID의 주문 120건·문의 10건·자리표시 굿즈 20종을 insert-only로 채운다. 재실행은 기존 이름·재고·주문 상태·문의 답변을 덮어쓰지 않는다. 옵션 도입 후 신규 굿즈의 기본 옵션은 DB trigger로 생성된다.
- demo 고객은 비밀번호가 없는 합성 계정이다. 주소·연락처는 배송 금지 표식의 가상 값이다. 운영 데이터 dump, storage 객체, provider 결제 이력을 복제하지 않는다.
- 토스 test 키만 사용하며 현재 Preview 신규 굿즈·티켓 결제 gate는 계속 닫혀 있다. 코페이 키·canary도 비우고 gate를 닫는다. 시드 주문은 PG 결제 증거가 아니며 실제 결제 취소 검증에 사용하지 않는다.
- 앱 메일 provider 키는 비운다. 인앱 알림·내부 운영 흐름과 실제 메일 전달 성공을 구분한다.
- 출고지시 내보내기에 포함되는 모든 demo 행은 실제 창고로 전달하지 않는다. 실제 물류 양식 검증은 #429/#177의 제공 양식에 결속한다.

## 다음 main 보존 검증과 복구

첫 환경 배포는 통과했지만 #416의 다음 main 자동 갱신·연습 데이터 보존은 아직 미실행이다. 현재 문서 정합 변경을 정상 docs PR로 병합해 다음 배포를 검증한다.

1. 의도한 연습용 상품·주문·문의 변경과 S4 준비를 마친 뒤 before snapshot을 남긴다. ref/branch ID·계정 5개·정확 대상 ID·업무 값 hash·현재 앱 SHA와 배포 URL을 고정하고 해당 범위의 쓰기를 잠시 멈춘다.
2. docs PR을 병합한 새 main run에서 동일 persistent branch를 재사용하고 새 앱이 배포되는지 확인한다. 이전 run을 재실행하거나 의미 없는 빈 commit으로 대체하지 않는다.
3. after snapshot에서 새 main SHA/run/배포 URL, 동일 branch/계정, 선택한 업무 값·원장 hash를 대조한다. 비밀번호 사용 가능 여부는 기존 보관소로 다시 로그인해 확인한다. 차이가 있으면 원인을 조사하고 자동 보존 PASS로 기록하지 않는다.
4. 결과는 #416에 남긴다. 이 docs PR 병합 전에 미래 보존 결과를 PASS로 쓰지 않으며, 문서 기록 자체를 이유로 검증용 배포를 무한히 반복하지 않는다. 실제 운영팀 S1~S5는 #434에서 별도로 기록한다.

앱 build/deploy 또는 URL 검증 실패는 alias 변경 전에 멈춘다. migration·시드가 앞서 적용됐을 수 있으므로 DB 전체가 rollback됐다고 가정하지 않는다. alias 연결 뒤 recovery template 활성화가 실패하면 새 alias가 이미 연결됐을 수 있어 실제 단계·상태를 읽고 복구한다. branch를 reset하거나 다시 만들지 말고 실패한 migration·시드·Auth·Functions·Vercel 단계의 원인을 먼저 수정한다. 오래된 main run 재실행은 거절되므로 현재 main의 run을 사용한다.

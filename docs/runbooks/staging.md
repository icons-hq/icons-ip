# 운영 콘솔 스테이징

관련: #416 · #434 · ADR-0006 · ADR-0014. 운영 연습 데이터는 production에서 복제하지 않는다.

## 현재 검증 상태 — 2026-09-08

| 환경 | 대상 | 실측 상태 |
| --- | --- | --- |
| Production | `icons-ip` / `sbutbsghcxmxmxgrshwq` | 프로젝트 목록만 조회. 이 작업의 mutation 없음 |
| Shared Preview | `icons-ip-preview/main` / `glwypjldklwpgdtymktm` | branch 목록에서 default 확인. 이 작업의 mutation 없음 |
| Hosted staging | `icons-ip-preview/staging` | 아직 생성·배포하지 않음. 고정 URL과 hosted 로그인 검증 대기 |
| 로컬 운영 연습 | 앱 `http://127.0.0.1:3300`, API `http://127.0.0.1:55421`, DB `55432` | 아래 계정 5개 생성, 비밀번호 로그인 및 역할 조회 5/5 통과 |
| 마이그레이션 검증 | 별도 빈 DB `127.0.0.1:55433` | 전체 migration부터 적용. staging seed 120 주문·10 문의·20 굿즈 및 재실행 보존 검증 통과 |

로컬 API·DB는 이번 작업 전용 프로세스다. 컴퓨터 재시작 뒤 고정 스테이징처럼 사용할 수는 없다. hosted URL을 검증하기 전에는 #416의 접속·자동 배포 게이트를 완료로 표시하지 않는다.

## 생성한 운영 연습 계정

사용자가 실제 업무 메일 제공 대신 계정 생성을 위임했다. `.test` 주소는 Auth 로그인 식별자이며 실제 메일함은 생성하지 않는다. 메일 인증은 생성 시 완료 처리하고 비밀번호로 로그인한다. 메일 수신·비밀번호 재설정 메일 리허설은 실제 업무 주소 전환 후 별도로 검증한다.

| 로그인 아이디 | 초기 역할 | 로컬 사용자 ID |
| --- | --- | --- |
| `ops-admin@staging.icons.test` | admin | `66bd5c5e-6a0b-498b-9e1b-60c4a247e28d` |
| `ops-staff1@staging.icons.test` | staff | `b814ac8b-556d-4211-88c2-2e45e105e184` |
| `ops-staff2@staging.icons.test` | staff | `202d168b-d0eb-48d9-8a26-d05e75c7155b` |
| `ops-staff3@staging.icons.test` | staff | `602e06bb-8c9c-4cde-b989-f7c41680fca4` |
| `ops-staff4@staging.icons.test` | staff | `73905731-919c-442b-ac47-b047b9acce67` |

현재 로컬 초기 비밀번호는 소유자만 읽는 `0600` 파일 `/tmp/icons-admin-redesign-evidence/local-qa-accounts.json`에 있다. Git·이슈·로그에 비밀번호를 기록하지 않는다. `/tmp`는 임시 보관소이므로 소유자가 비밀번호 관리자에 보관한다. hosted 생성 시 같은 로그인 아이디를 사용하되 비밀번호와 사용자 ID는 환경마다 새로 생성한다.

## 최초 hosted 준비

1. 구현·검증 후 main merge 및 스테이징 배포 승인 범위를 확인한다. `main` merge는 production 경로도 시작하므로 별도 Preview 배포와 혼동하지 않는다.
2. GitHub의 기존 `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PREVIEW_PROJECT_ID`, `SUPABASE_PROJECT_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`를 사용한다. Toss 키는 Vercel `icons-ip` 프로젝트의 기존 Preview `NEXT_PUBLIC_TOSS_CLIENT_KEY`·`TOSS_SECRET_KEY`를 그대로 상속한다. 별도 `STAGING_TOSS_*` GitHub secret을 만들거나 키를 다운로드하지 않는다. 두 키 이름은 배포 인자의 `--build-env`·`--env`에서도 덮어쓰지 않는다.
3. 고정 alias 기본값은 `icons-ip-staging.vercel.app`이다. 선점돼 있으면 GitHub variable `STAGING_ALIAS`에 `icons-ip-staging-ops.vercel.app` 같은 미사용 대안을 지정한다. production alias를 받지 않는다.
4. `deploy-staging`은 성공한 `sync-supabase-preview-main` 뒤 실행된다. 실행 SHA가 현재 main인지 확인하고, 존재하지 않을 때만 `--persistent` 무데이터 `staging` branch를 만든다. 기존 staging은 삭제·reset하지 않는다.
5. 앱 배포 전에 해당 branch에 migration·roles, 누락된 demo fixture, repo Edge Functions, Auth URL을 적용한다. 일반 `supabase/seed.sql`을 매번 재적용하지 않는다. demo 시드는 `supabase/seeds/admin-ops-staging.sql`만 사용한다. 시드 허용 표식은 접속 시작 옵션 `PGOPTIONS`에 의존하지 않고, `psql --single-transaction -c "SET LOCAL app.staging_seed_enabled = 'admin-ops-v1'" -f -`로 시드 파일과 같은 트랜잭션 안에서 설정한다. `ON_ERROR_STOP=1`로 표식 설정이나 시드가 실패하면 해당 트랜잭션 전체를 rollback하며, 시드 파일의 격리 세션 guard는 유지한다.
6. Vercel Preview의 build/runtime에 동일한 staging ref를 주입한다. `vercel deploy --archive=tgz`의 원격 `prebuild`가 상속된 **test 모드 주문서형 키 페어의 형식**과 닫힌 결제 gate·비어 있는 canary를 검사한다. 고정 서버 빌드 표식 `ICONS_STAGING_BUILD=admin-ops-v1`과 세 환경 ref는 `--build-env`에만 넣고, Preview 대상·허용된 staging `SITE_URL`·분리된 Supabase ref를 함께 검증한다. 표식·검증용 ref는 runtime 변수나 `NEXT_PUBLIC_*`로 전달하지 않는다. 원격 빌드 성공 후에만 고정 alias를 연결한다. Auth redirect 두 경로는 alias의 `/auth/callback`, `/auth/recovery/callback`이다. 앱 배포 후 recovery template를 활성화한다.

2026-09-08 읽기 점검에서 기존 Preview Toss 변수 두 항목은 branch 제한 없이 `sensitive`로 존재했다. 읽기 API와 공식 `vercel pull --environment=preview`는 키 값을 반환하지 않았으므로, 실제 test 모드·페어 형식 검증은 첫 원격 빌드까지 미확인이다. Vercel [Secret 값은 저장 후 읽을 수 없으며](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [Preview 배포의 빌드와 함수에는 해당 환경 값이 적용된다](https://vercel.com/docs/environment-variables). 로컬 `pull`의 빈 값으로 기존 키가 없다고 판정하거나 Secret을 읽기 가능한 타입으로 바꾸지 않는다.

원격 검사 실패는 키 값 없이 원인만 Vercel 빌드 로그에 남기고 alias 갱신을 막는다. 해당 로그에서 키 누락·live 모드·형식 오류가 확인될 때만 소유자가 원본 보관처의 테스트 키를 확인하고 명시적 승인 범위에서 기존 Preview 설정을 수정한다. 일반 Preview 빌드는 기존처럼 구 키를 허용하며, 이 staging 검사가 신규 결제 gate를 열지는 않는다. 상속은 키 복제 절차를 없애지만 실제 PG 호출이나 같은 상점 소속 증명까지 대신하지 않는다.

Supabase 공식 [Branching 문서](https://supabase.com/docs/guides/deployment/branching)의 persistent branch와 무데이터 생성 계약을 사용한다. 이 workflow는 Supabase GitHub integration의 자동 seed나 hosted `config.toml` 전체 push에 의존하지 않는다.

## Hosted 운영자 계정 생성

고정 URL 배포 뒤 로컬의 인증된 Supabase CLI로 다음 스크립트를 **한 번** 실행한다. 이 스크립트는 branch를 생성하지 않으며, healthy·persistent·non-default·무데이터인 preview 자식 `staging`만 받는다.

```sh
SUPABASE_PREVIEW_PROJECT_ID=glwypjldklwpgdtymktm \
SUPABASE_PRODUCTION_PROJECT_ID=sbutbsghcxmxmxgrshwq \
STAGING_ACCOUNTS_FILE=/absolute/private/location/icons-staging-passwords.json \
node scripts/staging-accounts.mjs
```

비밀번호 파일은 checkout 밖 절대 경로로 지정한다. 새 파일을 `0600`으로 먼저 저장하므로 중간 실패 시 같은 파일로 다시 실행할 수 있다. 기존 계정은 생성 표식이 있어야 하며, 최초 설정 완료 뒤 재실행은 비밀번호·역할·프로필을 초기화하지 않는다. 생성 표식이 없는 동일 이메일은 권한을 부여하지 않고 중단한다. 운영자가 변경한 역할 복구나 비밀번호 분실은 별도의 명시적 계정 관리 작업이다.

완료 출력의 hosted 사용자 ID를 이 문서의 별도 hosted 열로 기록한다. admin 1명·staff 4명 각각 로그인 후 `/admin` 접근과 금지된 admin 전용 작업을 검증한다. 초기 비밀번호는 소유자가 각 담당자에게 직접 전달한다.

## 데이터·결제 경계

- 고정 demo ID의 주문 120건·문의 10건·자리표시 굿즈 20종을 insert-only로 채운다. 재실행은 기존 이름·재고·주문 상태·문의 답변을 덮어쓰지 않는다. 옵션 도입 후 신규 굿즈의 기본 옵션은 DB trigger로 생성된다.
- demo 고객은 비밀번호가 없는 합성 계정이다. 주소·연락처는 배송 금지 표식의 가상 값이다. 운영 데이터 dump, storage 객체, provider 결제 이력을 복제하지 않는다.
- 토스 test 키만 사용하며 현재 Preview 신규 굿즈·티켓 결제 gate는 계속 닫혀 있다. 코페이 키·canary도 비우고 gate를 닫는다. 시드 주문은 PG 결제 증거가 아니며 실제 결제 취소 검증에 사용하지 않는다.
- 앱 메일 provider 키는 비운다. 인앱 알림·내부 운영 흐름과 실제 메일 전달 성공을 구분한다.
- 출고지시 내보내기에 포함되는 모든 demo 행은 실제 창고로 전달하지 않는다. 실제 물류 양식 검증은 #429/#177의 제공 양식에 결속한다.

## 완료·복구 기록

hosted 완료 시 배포 SHA, Actions run URL, 고정 alias, staging project ref, migration readback, emitted JS의 Supabase ref, 계정별 로그인 결과를 기록한다. 다음 main merge 후 기존 문의·주문 수정값이 보존되고 새 앱이 반영되는지 확인해야 자동 갱신 게이트를 통과한다.

| 게이트 | 현재 결과 |
| --- | --- |
| staging 격리·자격 증명·test 키 검증 | 로컬 단위 검증 통과; 상속된 실제 키는 첫 원격 빌드 검사 대기 |
| 합성 시드와 재실행 데이터 보존 | 로컬 SQL 통과 |
| 계정 5명 로그인·역할 조회 | 로컬 5/5 통과; hosted 대기 |
| 고정 URL·실제 emitted ref 확인 | 배포 대기 |
| main merge 뒤 자동 갱신·연습 데이터 보존 | 배포 대기 |
| 실제 운영팀 S1~S5 측정 | #434 리허설 대기 |

배포 실패 시 기존 alias와 rehearsal 데이터는 유지한다. branch를 reset하거나 다시 만들지 말고 실패한 migration·Auth·Functions·Vercel 단계의 원인을 먼저 수정한다. 오래된 main run 재실행은 거절되므로 현재 main의 run을 사용한다.

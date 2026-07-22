# 홈 큐레이션 관리 설계

작성일: 2026-07-21
대상 이슈: [#114](https://github.com/sangwopark19/icons-ip/issues/114)

## 목표

staff/admin이 홈 히어로, 특집 IP, 공지 배너를 하나의 운영 원장에서 생성·수정하고 노출 기간과 순서를 관리한다. 공개 홈은 현재 활성 큐레이션을 소비하며, Supabase가 설정되지 않은 mock 모드만 기존 `ips.featured` 기반 구성을 유지한다.

## 선택한 모듈 경계

세 가지 구성을 비교했다.

1. 히어로·특집·공지마다 별도 table을 둔다.
2. `ips.featured`를 유지하고 배너 table만 추가한다.
3. 공통 노출 계약을 가진 `home_curations` table 하나를 둔다.

세 유형은 제목·이미지·링크·노출 창·순서가 같고, 차이는 렌더링 방식과 특집 IP의 대상 참조뿐이다. 중복 스키마와 두 진실원을 만들지 않는 3번을 채택한다.

## 데이터 계약

`public.home_curations`는 다음 필드를 가진다.

- `id uuid`
- `kind`: `hero | featured_ip | announcement`
- `ip_id`: `featured_ip`에서만 필수이며 다른 유형에서는 비어 있어야 한다.
- `title`: trim 후 1–120자
- `image_path`: hero에서는 필수, 특집 IP와 공지에서는 선택
- `link_path`: 1–2048자의 안전한 내부 경로
- `display_order`: 0 이상의 정수, 중복 허용
- `active_from`, `active_to`: `[active_from, active_to)` 반개구간
- `enabled`: 즉시 노출 중단과 재개를 위한 운영 토글
- `created_at`, `updated_at`

내부 경로는 `/`로 시작하되 `//`, 역슬래시, control 문자를 허용하지 않는다. 이미지가 있으면 `public-media/catalog/curation/<uuid>.(jpg|png|webp)`만 허용한다. DB에는 `timestamptz`로 저장하고 KST 변환은 관리자 입력·표시 경계에서만 수행한다.

유형별로 `display_order, active_from, id` 오름차순으로 결정한다. 활성 hero와 announcement가 여러 개여도 DB에서 금지하지 않으며 홈은 각각 첫 행을 사용한다. `featured_ip` 행은 같은 정렬 순서대로 IP 선택기를 구성한다.

## 공개 읽기와 관리자 쓰기

- anon/authenticated 공개 정책은 `enabled`, 현재 노출 창, 연결 IP의 미보관 상태를 모두 만족하는 행만 읽게 한다.
- staff 정책은 예약·종료·비활성 행을 포함한 전체 목록을 읽게 한다.
- staff로 공개 홈을 방문해도 draft가 노출되지 않도록 홈 loader가 활성 조건을 다시 명시한다.
- table 직접 쓰기는 허용하지 않는다.

`admin_upsert_home_curation` 한 RPC가 생성·수정·활성 토글을 처리한다.

- `SECURITY DEFINER SET search_path = ''`와 완전 수식 객체명을 사용한다.
- `auth.uid()`와 `is_staff()`를 다시 확인한다.
- operation UUID advisory lock과 대상 행 lock을 사용한다.
- 같은 actor가 같은 operation과 정규화 요청을 재시도하면 기존 결과를 반환하고, 다른 actor나 payload 재사용은 충돌로 실패한다.
- `audit_log`에 operation, 요청, before, after를 한 transaction으로 기록한다.
- `public`, `anon`, `authenticated`, `service_role`의 기본 함수 실행 권한을 모두 회수하고 `authenticated`에만 실행을 부여한다.

연결된 활성·예약 특집 큐레이션이 있으면 IP 보관을 거절한다. 종료되었거나 비활성인 큐레이션은 보관을 막지 않는다. 반대로 보관된 IP를 새 특집 큐레이션에 연결할 수 없다. 큐레이션 upsert는 연결 대상 IP 행을 `FOR UPDATE`로 먼저 잠근 뒤 보관 상태를 검사한다. IP 보관도 같은 IP 행 update lock을 획득하므로 concurrent create/update와 archive가 직렬화된다.

## 아트워크 계약

#112의 private staging → 서버 검증·재인코딩 → public promote → verified claim attach 흐름을 `curation` kind로 확장한다.

- hero는 저장 전에 검증된 이미지를 요구한다.
- 특집 IP는 이미지가 없으면 해당 IP 키아트를 사용한다.
- 공지는 이미지 없이 텍스트 배너로 저장할 수 있다.
- 같은 행의 변경 없는 경로는 재업로드 없이 유지할 수 있지만, 이미지 교체와 다른 행의 경로 재사용은 새 verified claim을 요구한다.

## `ips.featured` 승계

- migration은 현재 `featured = true AND archived_at IS NULL`인 IP를 결정적 순서의 `featured_ip` 큐레이션으로 backfill한다.
- seed는 local reset 이후에도 같은 큐레이션을 갖도록 deterministic 행을 추가한다.
- 기존 컬럼과 RPC 인자는 Supabase-first 배포 호환을 위해 당장 삭제하지 않는다.
- 관리자 IP 폼에서는 featured checkbox를 제거하되 기존 값을 숨은 입력으로 보존한다.
- Supabase 홈은 큐레이션 배열이 비었을 때 첫 다섯 IP를 사용하며, legacy `ips.featured`로 되돌아가지 않는다. mock 모드만 기존 featured fallback을 유지한다.

## 홈 소비 계약

`HomeSnapshot`은 카탈로그와 함께 다음 큐레이션 snapshot을 제공한다.

- 첫 활성 hero 또는 `null`
- 첫 활성 announcement 또는 `null`
- 정렬된 featured IP ID 목록
- 데이터 source가 mock인지 Supabase인지 구분하는 값

공개 loader는 카탈로그·큐레이션을 가능한 범위에서 병렬로 읽고 Storage path를 공개 URL로 변환한다. 안전하지 않은 링크나 잘못된 행은 fail-closed로 제외한다.

- hero가 있으면 배경과 제목, `link_path`를 쓰는 고정 primary CTA `자세히 보기 →`로 교체한다. 접근성 이름은 hero 제목을 포함하고, 기존 secondary CTA `둘러보기`는 유지한다.
- hero가 없으면 현재 선택 IP 기반 hero를 유지한다.
- 첫 announcement를 hero 인접 영역의 compact link banner로 표시한다.
- 특집 IP 선택기와 post preview는 큐레이션 순서를 따르며 최대 다섯 IP만 사용한다.

## 관리자 interface

`/admin?section=curations`에 독립 섹션을 둔다.

- 목록과 새 등록/선택 편집을 같은 화면에 둔다.
- 유형, 특집 IP, 제목, 내부 링크, 순서, 시작·종료(KST), 활성 상태, 아트워크를 편집한다.
- 드래그 정렬 대신 숫자 순서를 사용한다.
- 상태는 `노출 예정`, `노출 중`, `종료`, `비활성`을 텍스트로 표시한다.
- 공지 배너 저장은 알림 fan-out을 일으키지 않는다. 인앱 공지가 필요하면 navigation-only CTA가 기존 `공지 발송` 섹션으로 전환하며 notification action은 호출하지 않는다.
- 모바일 1열, 44px action target, focus-visible, 색 외 상태 표현을 유지한다.

## 제외 범위

- 외부 URL
- 다국어·개인화·A/B 테스트
- drag-and-drop 정렬
- 공지 배너 저장과 인앱 알림 자동 발송
- `ips.featured` 컬럼과 기존 RPC signature 삭제
- hero/announcement 동시 노출 개수의 DB 제한

## 검증 기준

- SQL smoke: check·RLS·ACL, public 활성 경계, staff gate, 멱등·충돌·감사, IP 보관 경합, backfill, artwork claim attach
- Vitest: form 정규화·KST 변환·안전한 링크, loader/action gate, admin 배선·폼, 홈 hero/공지/특집 순서와 mock fallback
- 통합: 전체 test, lint, build, local Supabase reset·SQL smoke·lint
- 브라우저: staff desktop/390px 생성·수정·비활성, 공개 홈 렌더와 console/overflow/accessibility 확인
- 출시: PR CI, squash merge, 정확한 main production pipeline, transaction rollback canary와 route 확인, Issue/Project 동기화

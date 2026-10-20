# 스마트스토어형 어드민 통합 배포

이 문서는 스마트스토어형 어드민 통합 변경의 배포 절차와 완료 기준이다. 준비된 코드, 로컬 검증, PR 병합, 운영 DB 적용, 앱 배포, shared Preview 동기화, 실제 업무 인수는 각각 다른 완료 조건이다. 실행 상태와 결과는 해당 릴리스 PR의 배포 결과 기록과 같은 커밋 SHA의 GitHub Actions 실행 URL에 남긴다. 이 런북의 존재나 과거 검증만으로 배포 성공을 판단하지 않는다.

## 배포 기준과 변경 묶음

| 구분 | 기준 |
| --- | --- |
| 기존 운영 기준 | `origin/main`의 `081a3791c9a8499dc3fafd3e96955d931429951e`, 운영 migration 202개 |
| 누적 기능 | 미공유 DRAFT 222개와 상품·전시·판매·CS·매니저 권한·고객/마케팅·거래 계약의 앱 변경 |
| 배포용 SQL | 기존 운영 202개를 보존하고, DRAFT의 순서를 유지해 운영 기준 뒤로 재번호화한 222개 및 별도 호환 보정 |
| 경로·해시 근거 | [원본 DRAFT → 배포본 매핑](../../supabase/manifests/admin-rollout-migration-map.json) |
| 배포 경로 | [GitHub Actions pipeline](../../.github/workflows/pipeline.yml)의 `deploy-supabase` → `deploy-vercel` → `sync-supabase-preview-main` |

매핑의 `productionBaseline`·`productionMigrationCount`, 각 DRAFT의 `sourceFile`·`sourceSha256`·`preparedSha256`·`releaseFile`·`releaseSha256`를 릴리스 커밋에 결속한다. 기존 운영 202개는 해당 baseline의 파일과 바이트가 같아야 한다. 미공유 DRAFT만 경로를 정리하며, 이미 적용된 운영 version을 바꾸거나 이력만 적용된 것으로 표시하지 않는다. 후속 호환 SQL은 별도 파일과 검증 근거를 남긴다. 최종 migration 수는 **202 + 매핑된 222 + 실제 호환 보정 수**로 대조한다.

이전 415개 로컬 체인의 검증은 이번 운영 기준 202개와 합친 최종 체인 검증을 대신하지 않는다. 원본 작업 디렉터리의 파일이나 기존 개발 DB를 정리·초기화하지 않고 릴리스 작업트리와 폐기 가능한 검증 DB에서 통합한다.

## 유지해야 하는 운영 계약

- **즉시 취소:** 승인된 토스 취소는 기존 서버 오케스트레이터가 즉시 전액 취소를 요청하고 fresh 조회로 확정한다. 발주확인 전 고객 자동 승인, 승인 경합 후 후속 처리, 운영자 승인·전액 취소, 만료된 결제 준비 건의 무결제 종결을 유지한다. 늦은 승인·불명확 결과·동일 멱등키 재확인은 [클레임 런북](order-claim-intake.md)의 경계를 따른다.
- **반품·교환:** 새 판매자 대리 접수와 배송 중 접수는 요청·근거를 남기는 경로다. 전체 회수·창고 보관 확인 전에는 환급·재출고하지 않는다. 접수만으로 실제 도착·입고·환급 사실을 만들거나 부분 환불로 바꾸지 않는다.
- **주문 생성 권한:** `place_order(jsonb,uuid,order_payment_method)` 본문은 브라우저 롤에 열리지 않는다. 앱의 인증·결제수단 검사를 거친 기존 서버 전용 경로를 유지한다.
- **출고와 회신:** 기본은 스마트스토어 74열이다. 명시적으로 선택하는 김포·서원 원형 양식과 출고지별 ZIP을 함께 유지한다. 서원의 품목 행·원형 서식·확정된 추가 전달 열·후보 대조·중복/모호한 회신 거부, 합포장 무결성은 [출고 런북](warehouse-export.md)을 따른다.
- **권한과 보존:** 매니저 capability·RLS·RPC·Storage 경계와 감사·멱등 계약을 함께 배포한다. 문의 첨부 원문, 고객 연락처·계좌, 결제 원문을 배포 로그나 공개 검증 자료에 복사하지 않는다.

운영 상점의 실결제·실환불, 실제 WMS 반입·송장 발행·출고, 고객 이메일 발송, 정책 시행·개별 통지는 배포 검증과 구분한다. 합성 PG·격리 SQL·파일 재열기를 해당 업무의 실운영 성공으로 기록하지 않는다.

## 배포 전 검증

1. 릴리스의 merge base와 최종 SHA, 기존 운영 202개 파일의 불변성, 매핑 222개 경로·해시·유일 version을 확인한다. 최신 main의 결제·취소·서원 회신 수정이 누적 변경에 덮이지 않았는지 확인한다.
2. 선택한 `package.json`과 `package-lock.json`으로 `npm ci`를 수행한다. 암호화 XLSX의 `officecrypto-tool`, 상품 동영상 검사의 `mp4box`와 관련 런타임·형식 fixture가 포함되어야 한다. 이번 기능과 별개인 버전 변경은 같은 검증을 통과한 최종 lockfile에만 반영한다.
3. `npm run lint`, `npm run typecheck`, `npm test`, 환경을 갖춘 빌드와 필수 CI를 확인한다. 조회·저장·권한·응답 유실·파일 재시도 등 실제로 수행한 UI 흐름만 기록한다.
4. 빈 격리 DB의 최종 순차 적용과 기존 운영 schema를 기준으로 한 업그레이드 검증을 구분한다. Preview에는 운영 사용자 데이터·자격 증명을 복사하지 않는다. 기존 주문·결제·배송·미종결 요청·legacy 운영자 호환은 합성 fixture로 검증한다.
5. 권한 coverage·guard·매니저 lifecycle, 주문 생성 ACL, `staff_order_cancellation.sql`, `order_cancellation_system_reconcile.sql`, `order_claim_expired_prepared_cancellation.sql`, 결제/취소 경합, 출고·서원/74열 회신·합포장, 문의 상담/첨부의 최종 SQL 회귀를 확인한다. 실제 테스트 명령과 대상 DB의 식별 근거는 CI/검증 결과에 남긴다.
6. 원본·배포본 SQL 및 호환 보정 후의 함수 정의·owner·ACL·operator registry를 대조한다. 정의가 바뀌었는데 과거 registry 지문만 맞추거나 검사를 생략해 통과시키지 않는다.

## 기존 운영자 유지와 최초 설정

권한 core migration은 적용 시점의 `profiles.role IN ('staff','admin')` 명단을 `private.operator_legacy_cohort`에 고정한다. 최초에는 `private.operator_access_state.configured = false`이며 해당 명단의 호환 권한을 유지한다. 이후 raw `staff/admin`을 추가하는 것만으로 호환 권한이 생기지 않는다. 정지·탈퇴·현재 기본 자격과 명시적으로 지정된 매니저 역할은 계속 검사한다.

배포 전에는 운영자 명단과 기존 접근 범위의 비교 근거를 비공개로 보존한다. 배포 후에는 cohort·설정 상태와 기존 운영자의 실제 로그인 접근을 재조회한다. 이미 설정된 환경의 membership·revision·통합 매니저를 초기화하지 않으며, 장애 대응을 이유로 cohort를 다시 수집하거나 raw 역할을 늘려 우회하지 않는다.

최초 역할 설정은 [매니저 권한 런북](operator-access.md)에 따라 기존 운영자 전원을 검토하고 통합 매니저를 명시적으로 선택한 뒤 수행한다. 배포 과정에서 임의로 대표를 정하거나 전원에게 같은 역할을 부여하지 않는다. 한 번 확정된 요청의 응답이 불명확하면 같은 operation 결과를 먼저 조회한다. 첫 설정 전 호환 상태와 역할 전환 완료를 같은 상태로 보고하지 않는다.

## 운영 적용 순서

1. **DB:** 승인된 최종 main SHA의 `deploy-supabase`를 실행한다. 연결 대상이 운영 프로젝트인지 확인하고, 기존 202개와 pending 목록·매핑·호환 보정을 대조한 뒤 workflow의 적용 경로를 따른다. 적용 실패 시 앱 배포를 진행하지 않는다.
2. **앱:** 같은 SHA의 `deploy-vercel`이 DB 성공을 전제로 실행되었는지 확인한다. Vercel 배포 URL·production alias·커밋과 필수 환경 설정을 대조한다. migration이 있는 릴리스에 config-only 재배포의 DB 생략 경로를 사용하지 않는다.
3. **shared Preview:** 두 운영 job이 모두 성공한 같은 최신 main에 대해서만 `sync-supabase-preview-main`을 실행한다. 전용 Preview 프로젝트에 schema·roles·허용된 seed를 맞추며 운영 데이터는 옮기지 않는다. 운영 앱 성공만으로 이 단계를 성공 처리하지 않는다.
4. **환경별 재조회:** 운영과 shared Preview를 각각 확인한다. 매니저 설정, 기존 업무 접근, 공개 카탈로그, 고객 데이터 격리, 주문·취소·배송 읽기, 문의/첨부 접근 및 앱/DB 버전 일치를 기록한다.

새 코드·cron 설정을 포함했다고 새 청구·선물/정기배송 판매·통계 수집·민감 원문 처리 등의 runtime 스위치를 모두 켜지 않는다. 각 런북의 설정과 실제 준비 상태를 확인하고 기존 운영값을 보존한다. 키·공급자 설정은 값 자체를 로그에 남기지 않고 설정 여부와 환경 구분으로 검증한다.

## 배포 후 SQL readback

아래는 쓰기·fixture 생성 없이 확인하는 예다. 연결 대상과 권한을 먼저 확인하고 결과는 필요한 집계·불리언만 보존한다. 최종 함수·registry 검증은 배포 전 회귀와 같은 계약을 읽기 전용으로 대조한다.

```sql
begin read only;

select count(*) as migration_count, max(version) as latest_version
from supabase_migrations.schema_migrations;

select configured, revision
from private.operator_access_state
where id;

select legacy_role, count(*) as cohort_count
from private.operator_legacy_cohort
group by legacy_role
order by legacy_role;

select manager_role, count(*) as member_count
from private.operator_memberships
group by manager_role
order by manager_role;

select role_name,
       has_function_privilege(
         role_name,
         'public.place_order(jsonb,uuid,public.order_payment_method)',
         'execute'
       ) as direct_body_execute
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);

select p.proname, p.provolatile,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_current_operator_access',
    'admin_smartstore_shipment_export',
    'admin_import_item_tracking_batch'
  )
order by p.proname;

select id, public
from storage.buckets
where id = 'inquiry-files-private';

commit;
```

기존 202개 version과 최종 배포 목록은 건수뿐 아니라 개별 version으로 대조한다. 위 주문 생성 본문은 세 롤 모두 직접 실행이 거절되어야 한다. 품목 출고 exporter는 잠금 가능한 `VOLATILE` 정의여야 하며 문의 첨부 bucket은 비공개여야 한다. cohort 집계가 같다는 사실만으로 권한이 같다고 판단하지 않고 기존 운영자의 `admin_current_operator_access()`와 실제 허용/거부 경로도 확인한다.

## HTTP·화면 readback

- production alias의 공개 홈·상품 목록·상세가 정상 렌더링되는지 확인한다. 새 노출/전시 설정의 실패를 빈 데이터나 정상 수치로 바꾸지 않는다.
- 익명 `/admin` 진입은 로그인 또는 권한 거부로 끝나야 한다. 기존 운영자는 허용된 어드민 홈·상품·판매·CS 진입을 확인하고, 제한 계정은 메뉴 숨김과 직접 URL/API 거부를 함께 확인한다.
- 일반 고객의 문의·주문·파일은 본인 범위로 제한되고, 다른 고객·비인가 운영자의 접근은 거절되어야 한다. private 첨부가 공개 Storage URL로 노출되지 않는지 확인한다.
- 배포 직후 검증은 기존 데이터의 필요한 읽기와 권한 확인을 중심으로 한다. 파일 다운로드가 운영 감사·출고지시 전달 상태를 바꾸는 동작인지 확인하고, 실제 출고 주문에 대한 시험 다운로드·송장 업로드를 읽기 검사로 취급하지 않는다.
- 결제·취소·배송의 읽기 상태와 실제 PG/WMS 결과를 구분한다. 실제 거래나 외부 발송을 수행하지 않았다면 릴리스의 배포 결과 기록에 미실행으로 남긴다.

## 실패 시 처리와 결과 기록

DB 적용 후 앱 배포가 실패하면 기존 앱과 새 DB의 호환을 먼저 확인하고 같은 검증된 SHA의 앱 배포를 복구한다. 이미 적용한 SQL을 삭제하거나 migration 이력만 되돌리지 않는다. DB 보정이 필요하면 원인을 확인한 새 forward migration으로 처리한다. shared Preview만 실패했다면 운영 성공과 Preview 실패를 따로 기록하고 최신 main 검사를 통과한 동일 경로로 복구한다.

| 확인 항목 | 완료 기준 | 릴리스 결과 기록에 남길 근거 |
| --- | --- | --- |
| 운영 기준 202개 | 기존 version·원문 불변성 확인 | 기준 SHA·version 목록·원문 해시 비교 |
| 최종 통합 CI·DB 회귀 | 최종 릴리스 SHA의 필수 검사 통과 | PR URL·같은 SHA의 Actions 실행 URL·검증 대상 및 결과 |
| 운영 DB 적용 | 최종 목록 적용과 읽기 재조회 일치 | 적용 SHA·Actions 실행 URL·version 대조·SQL readback |
| 운영 앱 배포 | 같은 SHA의 production alias와 앱 응답 확인 | Vercel deployment·alias·HTTP/화면 결과 |
| shared Preview 동기화 | 같은 최신 main의 전용 Preview DB·앱 일치 | Actions 실행 URL·main SHA·DB/앱 확인 |
| 기존 운영자 접근 | cohort·설정 상태와 기존 허용/거부 경계 확인 | 비공개 권한 비교 근거·화면 재조회 |
| 최초 매니저 설정 | 별도 운영자 검토와 명시적 통합 매니저 지정 후 확정 | 실행 여부·설정 revision·같은 operation 결과 재조회 |
| 실제 PG 결제·환불 | 별도 실제 거래·공급자 확정 확인 | 실제 수행 여부·공급자 근거; 수행하지 않으면 미실행 |
| 실제 WMS·송장 발행·출고 인수 | 실제 창고 업무의 인수 확인 | 실제 수행 여부·창고 담당자 인수 근거; 수행하지 않으면 미실행 |

실행자는 릴리스 PR의 배포 결과 기록에 배포한 커밋 SHA, 해당 SHA의 Actions 실행 URL, 각 단계의 성공·실패·미실행과 읽기 재조회 근거를 함께 남긴다. 배포 결과를 기록하기 위해 이 절차 문서만 수정해 DB 배포를 다시 실행하지 않는다. 최초 매니저 설정이나 실거래 인수를 수행하지 않았다면 배포 성공과 별도로 그 상태를 명시한다. 로컬 QA 파일이나 한 배포 job의 성공으로 나머지 단계를 채우지 않는다.

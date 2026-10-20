# A/S·사이즈 안내의 상품 엑셀 v7 계약과 검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 상품 엑셀에 기존 A/S 안내와 사이즈 안내표의 왕복 편집을 연결했다. 상품별 안내 내용·현재 버전을 내려받고, 미리보기 후 같은 상품 저장 거래에서 적용한다. 운영·Preview 배포는 실행하지 않았다.

## 범위와 원본 근거

[빈 상품 양식 조사](blank-product-workbook-comparison.md)의 신형 `일괄등록!BD2:BG5`는 A/S 템플릿·전화번호·안내·판매자 특이사항, `CL2:CO5`는 상품군·사이즈명·상세 치수·착용 모델을 담는다. 이번 구현은 ICONS의 기존 `phone`, `guide`, `sellerSpecialNotes`와 `enabled`, `chart`에 한정한다. 상품군 사전·착용 모델·AI 추출·원본 템플릿 코드 연결은 추가하지 않았다. 원본 샘플 값을 앱 기본값이나 회귀 데이터로 복제하지 않는다.

A/S 안내는 법정 고시의 A/S 책임자·연락처와 별도다. 사이즈표는 고시의 크기, 주문 선택 옵션, 옵션 가격·재고와 별도다. 재사용 템플릿을 바꾸거나 새 템플릿을 만들지 않으며, 파일에 담긴 상품별 현재 값을 편집한다. 기존 사이즈 도메인은 [안내표·템플릿 계약](goods-size-chart-proposal.md)을 따른다.

## 파일 계약

새 다운로드의 버전은 v7이다. 상품의 기존 85열과 KC·직접입력형 옵션 시트를 유지하고 `AS 안내`, `사이즈 안내` 시트를 추가한다. 각 시트 A1은 파일 버전, 4행은 제목, 5행부터 데이터다. 기존 v3~v6 파일은 기존 해석을 유지하며, 새 안내 시트는 v7에서만 편집할 수 있다. 구형 파일에 새 시트를 붙이면 최신 양식 재다운로드를 안내한다.

| 항목 | AS 안내 | 사이즈 안내 |
| --- | --- | --- |
| 열 | 상품코드, 변경 방식, A/S 전화번호, A/S 안내, 판매자 특이사항, 안내 버전 | 상품코드, 변경 방식, 표시, 단위, 표 안내, 표 버전, 측정 항목, 사이즈 1~10, 치수 1~10 |
| 행 | 상품당 1행, 파일당 최대 500행 | 측정 항목마다 1행, 상품당 최대 10행·파일당 최대 5,000행 |
| 편집 | `편집`: 전화번호·안내 필수, 특이사항 선택 | `편집`: 같은 상품의 표시·단위·안내·버전·사이즈 이름을 모든 행에 동일하게 반복 |
| 명시적 중지·해제 | `전체 해제`: 전화번호·안내·특이사항을 모두 공란으로 입력 | `표시 중지`: 상품코드·변경 방식·표 버전만 한 행에 입력. 저장된 표는 그대로 유지 |
| 버전 | 현재 안내 버전. 새 상품은 0 | 현재 표 버전. 새 상품은 0 |
| 생략 | 시트 또는 해당 상품 행이 없으면 기존 안내 보존 | 시트 또는 해당 상품 행이 없으면 기존 표·표시 상태 보존 |

상품 시트의 명시적 상품코드로 연결한다. 코드가 비어 자동 발급되는 새 상품은 먼저 초안을 저장하고 다시 내려받는다. 상품 시트에 없는 코드, 중복 A/S 행, 같은 표의 상충하는 공통 값은 거부한다. 원본 상품 행과 안내 행은 실패 파일을 만들 때도 함께 보존한다.

A/S 전화번호는 20자, 안내·특이사항은 각각 1,300자다. 사이즈명은 1~10자·최대 10개, 측정 항목명은 1~20자·최대 10개, 표 안내는 500자다. 단위는 `cm` 또는 `mm`, 치수는 0.1~99,999의 소수 한 자리까지 허용한다. 같은 축의 이름 중복, 중간에 빈 사이즈 열, 이름 없는 열의 치수, 빠진 치수는 거부한다. 전화번호와 코드는 텍스트 셀로 다루며 수식은 기존 안전 셀 파서에서 차단한다.

내보낼 때 내용이 없는 초기 버전 0은 안내 행을 만들지 않는다. 이미 해제한 A/S의 양수 버전은 `전체 해제` 행으로 내보낸다. 표시가 꺼져 있어도 저장된 사이즈표의 내용·순서는 내보내며, 표가 비어 있고 버전만 있는 경우에는 `표시 중지` 제어 행을 사용한다. `표시 중지`와 빈 표 전송을 구분해 기존 표를 실수로 삭제하지 않는다.

[편집 계획·내보내기](../../../lib/admin/goods-guidance-workbook.ts), [시트 읽기·서식](../../../lib/admin/goods-guidance-workbook-file.ts), [상품별 계획 연결](../../../lib/admin/goods-workbook.ts).

## 조회와 저장 경계

`public.admin_goods_import_records`의 기존 `catalog.read` 진입 가드, 코드·ID 합계 500개 제한, 원가 노출 조건은 유지한다. 응답의 `afterSales`, `sizeChart`는 현재 `catalog.manage`가 있을 때만 각 공개 관리자 getter를 통해 읽고, 없으면 JSON null이다. 현재 역할표에는 `catalog.read`만 있고 `catalog.manage`가 없는 역할은 없다. 실제 logistics는 기존 조회 자체가 거부된다. 향후 읽기 전용 역할에도 비공개 안내가 확장되지 않도록 조건을 별도로 유지한다.

검증을 마친 저장 계획에는 바뀐 종류만 다음 구조로 담는다.

```text
guidance.afterSales = { expectedRevision, values: { phone, guide, sellerSpecialNotes } }
guidance.sizeChart  = { expectedRevision, values: { enabled, chart } }
```

기존 상품의 기본 시트가 현재 내보내기와 같고 KC·직접입력형 옵션도 그대로인 경우에는 `kind=update`, `guidanceOnly=true`, `target={previous_id, code}`만 저장한다. 비교는 줄바꿈 표현 CRLF/CR을 LF로 맞추는 데 한정한다. 이 경로는 기본 상품을 다시 저장하지 않아 기존 공개 상태·옵션·재고·기본값을 보존한다. DB에서도 기존 상품 행 잠금과 fingerprint, 정확한 target 키·코드, 준비된 이미지가 없는지 확인한다. 새 상품은 이 경로를 사용할 수 없다.

실제 상품별 savepoint는 `private.admin_commit_goods_import_group_before_category`에 있다. 기존 category 잠금 래퍼와 actor·batch·index·fingerprint 경계는 유지하고, 기본 상품 저장 또는 안내 전용 분기 직후 봉인된 `private.apply_goods_import_guidance`를 호출한다. helper는 현재 상품 관리 권한과 저장된 batch/actor/index/guidance를 확인하고, 기존 A/S·사이즈 writer의 revision 비교·감사 기록을 재사용한다. operation UUID는 batch·actor·index·안내 종류에서 고정적으로 유도하며 파일이 제공한 UUID는 받지 않는다.

안내 한 종류라도 실패하면 해당 상품의 기본정보·옵션·재고·KC·반품/교환 정책·앞서 저장한 다른 안내·감사 영수증까지 같은 savepoint에서 롤백한다. 바깥 배치에는 그 상품의 실패 결과만 기록한다. 다른 상품의 성공과 기존 동일 batch/index 재시도 결과는 유지한다. 충돌한 실패 파일의 버전을 자동 갱신하지 않으며 최신 파일로 다시 검증해야 한다.

## 혼합 함수 소유자 경계의 보정

최초 안내 연결 뒤 OWN에서 기존 A/S private document 함수의 소유자가 `supabase_admin`이고, import reader의 소유자는 일반 `postgres`여서 직접 호출이 거부되는 차이를 확인했다. 59922의 해당 private 함수 소유자는 `postgres`여서 먼저 수행한 canonical clone에서는 드러나지 않았다. 두 서버의 역할 속성은 같았으며, 차이는 기존 함수 owner/ACL이었다.

이미 적용된 [안내 연결 migration](../../../supabase/migrations/20261020085334_goods_import_guidance.sql)은 보존했다. [후속 reader 보정](../../../supabase/migrations/20261020085335_goods_import_guidance_reader_boundary.sql)은 정확한 두 호출만 기존 공개 관리자 getter로 바꾼다. 두 getter는 같은 `catalog.manage` 검사 뒤 같은 문서를 반환하는 STABLE SECURITY DEFINER 함수다. 기존 private 함수의 소유자나 봉인된 ACL, public reader의 소유자·ACL을 바꾸거나 새로운 grant를 추가하지 않았다.

보정은 실제 OWN을 같은 서버 안에서 복제해 먼저 검증했다. `postgres`가 nonsuperuser이고 A/S private document의 직접 EXECUTE 권한이 없는 상태를 그대로 유지한 채, 현재 관리자 조회·저장과 합성 읽기 전용 null 분기·권한 철회·동시성 회귀가 통과했다. 이후 OWN에는 보정만, FRESH/59922에는 안내 연결과 보정을 같은 transaction에서 순서대로 적용했다.

## DB 검증 결과

[SQL 회귀](../../../supabase/tests/goods_import_guidance.sql)는 합성 데이터와 임시 권한 분기를 transaction 안에서 검사한 뒤 전부 롤백한다. 기존 import 회귀, 새로운 안내 회귀, coverage와 적용 가능한 전체 guard를 확인했다.

| 검증 | 확인한 결과 |
| --- | --- |
| 현재 편집 한도를 넘는 기존 값 | 현재 TS의 일반 설명 입력 한도는 2,000자이고 DB는 기존 plain 설명을 허용한다. 2,100자 plain 설명을 가진 상품에 안내만 저장해 기본 상품·옵션·재고·KC·timestamp 전체 JSON이 그대로임을 확인했다. 저장 제약을 위반하는 51개 검색어는 이 근거에 사용하지 않았다. |
| 일반 저장·신규 상품·ID 변경 | 기본 상품과 두 안내의 원자적 저장, 초기 revision 0, ID 변경에 따른 자식 FK 이동과 연속 revision 증가를 확인했다. |
| 생략·중지·해제 | 생략한 안내 문서·revision exact 보존, A/S의 명시적 전체 해제, 표시 중지 후 사이즈표 보존, 기존 표의 빈 배열 삭제 거부를 확인했다. |
| 충돌과 재시도 | 부모 fingerprint 및 각 안내 revision 충돌, 후속 size 충돌 시 앞선 A/S와 상품 전체 변경 롤백, 실패 결과의 반복 재시도 보존을 확인했다. |
| 권한·입력 | primary/deputy 허용, raw staff·일반 고객·auth subject 없음·anon·service role 거부, 권한 회수 후 재시도, private helper 봉인, 500건 제한, 불법 target·이미지·client operation ID 거부를 확인했다. |
| 읽기 전용 분기 | 실제 logistics의 전체 조회 거부를 확인했다. 별도 rollback transaction에서만 read-only capability를 합성해 기본 응답 유지·신규 두 문서 null·원가 비노출을 검사하고 함수 정의를 정확히 복원했다. |
| 정의 보존 | 변경한 함수는 정확한 앵커 역변환으로 이전 정의 전체가 복원됐다. 각 환경의 owner/ACL과 정책 135개, 이전 ledger 원문을 보존했다. |

최종 로컬 적용 요약 (`output/goods-import-guidance-qa-20261014/final-named-summary.json`)의 OWN ledger는 239→240(기존 안내 연결 후 reader 보정만), FRESH는 271→273, canonical 59922는 306→308이다. 최종 함수 수는 각 1,087개다. OWN의 configured 상태·기존 owner·UI 검증용 상품은 그대로 두었다. 신규 SQL·coverage는 세 환경에서 통과했고 전체 guard는 FRESH/59922에서 직접 통과했다. configured OWN에서는 전체 guard를 위해 실제 역할 설정을 바꾸지 않았다.

이 수치는 승인된 증분 적용 증거다. 별도 시간대 집계 migration은 포함하지 않았으며 저장소의 모든 파일을 순서대로 적용한 새 전체 체인 검증을 대신하지 않는다. 관련 증거는 혼합 owner clone (`output/goods-import-guidance-qa-20261014/reader-boundary-clone/result.json`), OWN (`output/goods-import-guidance-qa-20261014/own-reader-result.json`), FRESH (`output/goods-import-guidance-qa-20261014/fresh-reader-result.json`), 59922 (`output/goods-import-guidance-qa-20261014/chain59922-reader-result.json`)에 있다.

## 재실행 가능한 동시성 회귀와 CI

[동시성 테스트](../../../supabase/tests/goods_import_guidance_concurrency.py)는 Python 표준 라이브러리와 Docker CLI를 사용한다. `psql`, `pg_dump`, `pg_restore`, `createdb`, `dropdb`는 선택한 로컬 Supabase DB 컨테이너에서 실행하므로 호스트 PostgreSQL 설치나 Python 패키지는 필요하지 않다. 컨테이너 이름과 Supabase project label을 검사하고 스스로 만든 고유 복제 DB에서만 쓴다. 종료 시 clone과 임시 dump를 제거하며 원본 DB에 migration·reset·역할 변경을 실행하지 않는다.

```bash
python3 supabase/tests/goods_import_guidance_concurrency.py \
  --container supabase_db_icons-ip-smartstore-fresh-20261012 \
  --output-dir output/goods-import-guidance-qa-20261014/reusable-concurrency-harness
```

두 실제 세션을 겹쳐 다음 세 가지를 확인한다. 먼저 writer가 잠금을 가진 상태에서 두 번째 요청이 기다렸는지 확인한 뒤 최종 데이터·감사 수를 비교한다.

1. 동시에 바뀐 size revision으로 import가 실패하고, 그 import가 앞서 저장한 A/S는 롤백된다.
2. 같은 batch/index를 동시에 실행해도 같은 성공 결과를 반환하며 revision·감사를 중복 생성하지 않는다.
3. 정상 `admin_save_good`가 부모 행을 변경하면 미리 본 fingerprint를 가진 import가 실패한다.

재사용 harness의 실제 실행은 세 경우 모두 통과했고 약 2.4초의 잠금 대기를 기록했다. 결과와 cleanup (`output/goods-import-guidance-qa-20261014/reusable-concurrency-harness/result.json`).

[CI](../../../.github/workflows/pipeline.yml)는 로컬 전체 migration 적용 뒤, legacy 권한 fixture를 설치하기 전에 신규 SQL과 이 harness를 실행한다. SQL 연결 사용자는 fixture 준비를 위한 `supabase_admin`이며 권한 검사는 테스트 내부의 실제 `SET ROLE authenticated/anon/service_role`로 수행한다. smoke 도구 설치에 `python3`를 명시했다. 이 단계는 로컬 검증 경로이며 운영·Preview 배포를 실행한 증거는 아니다.


## 실제 Chrome·엑셀 왕복 검증

2026-10-14 격리된 OWN 환경의 합성 상품 3개로 실제 다운로드, 파일 선택, 미리보기, 적용, 실패 파일 다운로드, 최신 파일 재편집을 수행했다. 원본·편집·실패·재조회 파일 7개와 코드 19파일의 SHA-256을 UI 검증 manifest (`output/goods-import-guidance-qa-20261014/ui-manifest.json`)에 기록했다. 양식은 ArtifactTool로 열어 각 안내 시트를 렌더링하고, 편집한 업로드 파일 3개는 같은 도구의 XML namespace·관계 경로를 ExcelJS가 읽는 패키지 형식으로만 정규화했다. 각 파일의 변경 내역을 별도 JSON으로 남겼으며 실제 입력 값은 정규화에서 바꾸지 않았다.

| 실제 조작 | DB·파일 재조회 결과 |
| --- | --- |
| 기존 설명 2,100자인 상품의 안내만 수정 | A/S와 표 revision이 1→2로 바뀌고, 기본 상품·옵션·재고·KC·timestamp는 이전 JSON과 정확히 같았다. 첫 치수 `10→11.5`와 안내의 줄바꿈을 확인했다. |
| 두 번째 상품의 기본정보·A/S·표를 함께 미리 본 뒤 다른 writer로 표 변경 | 외부 변경의 표 revision 2와 값 `19.5`를 보존했다. 반입은 실패하며 기본정보·A/S 등 해당 상품 전체가 적용 직전과 같았다. 첫 상품의 성공과 세 번째 상품의 무변경은 유지됐다. |
| 실패 항목 다운로드 | 실패한 상품 하나와 A/S 1행·사이즈 2행만 포함했다. 입력했던 두 안내 revision 1을 그대로 보존해 충돌 버전을 자동 갱신하지 않았다. 파일 대조 (`output/goods-import-guidance-qa-20261014/ui-failure-file-check.json`). |
| 최신 양식을 다시 내려받아 실패 상품 재편집 | 기본 상품명과 A/S revision 2, 표 revision 3·치수 `23.5`가 함께 저장됐다. 다른 두 상품은 전체 JSON이 그대로였다. |
| 첫 상품의 A/S 전체 해제·사이즈 표시 중지 | A/S의 세 값이 모두 공란, 표 enabled가 false로 바뀌고 각각 revision 3이 됐다. 표의 단위·안내·사이즈·모든 치수는 정확히 보존됐다. |
| 안내 행을 생략한 상품 | 세 차례 전체 적용을 거쳐 기본정보·옵션·KC·두 안내 문서가 모두 그대로였다. |

위 비교는 각 단계의 SQL readback 전체 JSON으로 다시 계산했다. 12개 불변 조건 (`output/goods-import-guidance-qa-20261014/ui-db-comparison.json`)이 모두 통과했다.

390px 화면에서 결과 표의 셀이 지나치게 좁아지는 문제를 발견해 최소 폭 620px와 열 폭을 지정하고, 표 영역을 키보드로 가로 스크롤할 수 있게 했다. 최종 문서 폭은 380px, 표 영역은 274px이며 초점을 둔 상태에서 오른쪽 끝 346px까지 이동해 결과 문장을 확인했다. 최종 화면 (`output/goods-import-guidance-qa-20261014/ui-08-mobile-final-results.png`), 실측 (`output/goods-import-guidance-qa-20261014/ui-mobile-readback.json`). 수정 전 05·06, 중간 스크롤 상태 07은 최종 시각 근거에서 제외했다.

핵심 6파일 105테스트, 가이드·리허설 3파일 26테스트와 숫자 전화번호/모바일 회귀 2파일 36테스트가 통과했다. 마지막 표 폭 변경 뒤 관련 화면 2파일 15테스트와 변경한 TS/TSX 12파일 lint를 통과했다. 이 숫자는 일부 같은 테스트를 포함하며 합산한 고유 테스트 수가 아니다. 이전 전체 typecheck 뒤 추가 UI 변경이 있어 전체 작업 트리의 최종 통합 검증은 별도 기록을 따른다.

검수 종료 후 생성한 상품 3개·IP 1개·배치 3개·Storage 파일 3개와 자식 안내를 정확한 ID로 정리하고 잔여 0을 확인했다. 감사 이력은 보존했다. 정리 결과 (`output/goods-import-guidance-qa-20261014/ui-cleanup-result.json`). 이 검수에서 기존 사용자나 관리자 설정은 변경하지 않았다.

네이티브 Excel 열기와 실제 모바일 기기는 미검증이다. Chrome 콘솔의 hydration 차이는 `html`에 확장이 주입한 `data-immersive-translate-page-theme` 속성이었고 실제 파일·저장 흐름 오류는 없었다. 원본 스마트스토어 파일의 반입/등록 결과나 착용 모델 사전까지 검증한 것으로 보지 않는다.

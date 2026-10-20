# 마케팅 링크 구현·로컬 검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13. [원본 조사](marketing-story-parity.md)의 4종 링크와 생성 위치를 기준으로, 고정 링크 원장·권한·공개 이동을 구현했다. 실제 원본 네이버의 링크를 만들거나 운영 환경을 변경하지 않았다.

## 구현 계약

- `/admin/marketing/links`는 홈·상품·쇼핑스토리·카테고리 4탭, 이름/번호/링크 검색, 이동 가능 여부, 페이지 단위 조회와 복사를 제공한다. 클릭·전환·매출 지표는 만들지 않는다.
- 홈은 원장과 홈 전시 편집기에서, 상품과 스토리는 목록에서 최대 100개를 선택하고, 카테고리는 상세 영역에서 발급한다. 같은 대상은 같은 주소를 반환한다. 링크만 수정·삭제하는 기능은 없다.
- 통합 조회는 `marketing.manage`, 홈·스토리 발급은 `store.manage`, 상품·카테고리 발급은 `catalog.manage`다. UI·서버 액션·DB RPC가 같은 경계를 따른다. 원본의 하위 역할 발급 권한은 확인되지 않았으므로 이 권한 분리는 ICONS 계약이다.
- 원장은 private 테이블이며 모든 클라이언트와 service role의 직접 읽기·쓰기를 봉인한다. 발급은 현재 권한과 계정 잠금, 대상 행 잠금, 대상별 고유 제약, operation UUID와 감사 기록으로 확정한다. 결과가 불명확하면 UI가 같은 operation UUID와 선택 목록으로 다시 확인한다.
- `/m/[token]`은 매 요청 현재 공개 상태를 확인한 뒤 고정된 내부 경로로만 307 이동한다. 모든 결과에 `no-store`와 `noindex`를 넣는다. 상품·상위 IP의 공개/보관/판매 제한, 스토리 삭제·전시기간, 카테고리 전체 활성화·조상 보관을 확인한다. 품절은 공개 브라우징을 유지한다.
- 비공개 원본도 미리 링크를 받을 수 있지만 현재 이동 불가로 표시한다. 공개 상태가 복구되면 같은 주소를 사용한다. 최초 공개 전 상품 주소 ID 변경은 FK cascade로 따라가며, 이미 공개한 상품 ID를 잠그는 기존 규칙은 유지한다. 실제 삭제로 FK가 사라진 링크는 같은 ID의 새 자료에 재연결되지 않는다.
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`만 단일 값·200자 이내·제어문자 없음 조건으로 전달한다. 중복 키, `nt`, 임의 목적지와 기타 매개변수는 버린다. 방문·결제 귀속, 개인정보 수집·보존은 별도 계약이다.
- 홈 전시 편집기 등 원본 표면에서는 링크 발급 뒤 화면을 새로고침하지 않는다. 미저장 구성의 제목·ID·operation UUID를 보존한다. 자동 복사가 불가능한 경우에도 전체 주소 입력란을 선택해 복사할 수 있다.

## 검증

| 범위 | 결과 |
| --- | --- |
| 단위·영향 | 라우팅·파서·권한 액션·기존 상품/카테고리 화면·CSS 경계 6파일 23테스트 통과. 전체 TypeScript와 변경 ESLint 통과. |
| SQL | `marketing_links.sql` 통과. 4종 ACL, 하위 매니저 발급/통합 조회 분리, 중복/누락 배치 원자성, 멱등 재시도·충돌, 공개/보관/기간/상위 분류, 초안 ID 변경, 실제 삭제 후 ID 재사용 차단을 rollback fixture로 확인. 실제 KC 검토 helper를 사용했다. |
| 동시성 | 전용 DB 복제본에서 같은 대상, 같은 operation, operation 충돌, 발급과 초안 ID 변경, 권한 회수와 발급의 5경합 통과. 두 번째 트랜잭션의 실제 Lock 대기와 최종 4링크·중복 없는 감사·미권한 발급 0건을 확인하고 복제본을 삭제했다. |
| 실제 브라우저 | 홈 발급/동일 주소 재요청, 상품 2개 일괄 발급, 비활성 카테고리 표시, 스토리 목록 선택 발급, 원장 검색과 재조회, 상품·스토리 공개 상세 도착, UTM 이외 매개변수 제거 확인. |
| 입력 보존 | 홈 구성에 입력한 미저장 제목과 hidden ID·operation UUID가 홈 링크 발급 후 모두 같음을 직접 재조회했다. 구성 저장은 하지 않았다. |
| 모바일 | 탭 실측 width 390px, client/scroll 380px, 본문 324px, 사이드바 56px에서 가로 넘침 없이 원장 검색·카드·주소·복사 버튼을 확인. 검증 후 임시 화면 설정을 복원했다. |
| HTTP | 실제 서버에 쿠키 없는 5요청으로 홈/상품/스토리 307, 비활성 카테고리/없는 토큰 404, 고정 Location, UTM 필터, no-store/noindex를 확인. |

증거는 `output/smartstore-reference-20261012/verification-marketing-links/`의 SQL/동시성 로그, `browser-readback.json`, `database-readback.json`, `http-public-routing.json`, 화면 manifest에 있다. 캡처 14개의 SHA-256을 확인했으며 성공 증거는 manifest의 `accepted: true`인 9개다. 06–09는 viewport API가 적용되지 않거나 전환 중인 중간 화면이어서 모바일 성공 근거에서 제외했다. 최종 모바일 증거는 10·11이다.

현재 Chrome은 비활성 카테고리 링크 한 건에서 `ERR_BLOCKED_BY_CLIENT`를 표시했다. 해당 캡처13은 앱 404 화면의 검증으로 간주하지 않았다. 서버의 404·응답 본문·캐시 헤더는 별도 HTTP 검사로 확인했다. 브라우저 보안 설정이나 확장은 변경하지 않았다.

## 실행 방법

`supabase/tests/helpers/goods_kc_fixture.sql`과 `supabase/tests/marketing_links.sql`을 같은 psql 연결에 순서대로 넣는다. 동시성 검증은 아래 명령처럼 명시한 격리 로컬/CI 컨테이너만 사용한다.

```sh
SUPABASE_DB_CONTAINER=supabase_db_icons-ip-smartstore-20261012 \
MARKETING_LINKS_TEST_SCOPE=isolated-local \
bash supabase/tests/marketing_links_concurrency.sh
```

새 migration은 `20261020085230_marketing_links.sql`이며 쇼핑스토리 테이블 이후에 적용한다. 여기 기록한 결과는 격리 로컬 검증이며 운영 배포 완료를 뜻하지 않는다.

# 공용 사진 보관함 대조·검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13 원본 읽기와 소유 격리 QA 기준이다. 이 단위는 상품 이미지의 공용 보관·재사용을 다루며 사진 편집기·연관상품 편성 전체의 완료를 뜻하지 않는다.

## 원본에서 확인한 상태

- 사진 보관함 (`output/smartstore-reference-20261012/catalog-cs/153-photo-library-empty.png`): 스토어 멤버 공용, 이미지 3개월 보관, 한 번에 10개·최대 20MB 안내. 0장 상태에서 편집은 비활성이며 원본 업로드·삭제·편집을 실행하지 않았다.
- 상품 폼에서 연 SmartEditor의 자르기·필터·보정·액자·서명·텍스트·스티커·모자이크·클립 상태는 별도 원본 조사 (`output/smartstore-reference-20261012/product-photo-tools.json`)에 있다. 보관함 0장이라는 제한을 사진 편집기 자료 전체가 없다는 뜻으로 해석하지 않는다. 보관함에서 해당 편집기로 연결되는지는 미확인이다.
- 원본의 3개월 만료와 20MB 제한은 네이버 운영 정책이다. ICONS에는 이를 복제하지 않고 기존 검증 파이프라인의 JPEG/PNG/WebP·5MiB·8192px·40MP·단일 프레임 조건을 유지한다.

## ICONS 계약

- `/admin/catalog/photos`에서 이름 검색·20개 페이지·활성/보관 조회·최대 10장 순차 업로드·이름 수정·보관·복구를 제공한다. 상품 폼의 대표/추가 이미지에서 선택하고 여러 상품에 재사용한다.
- `goods_photo_library`는 active staff/admin만 읽으며 쓰기는 인증된 RPC만 허용한다. 신규 등록은 **현재 실행자 소유의 미만료 verified good claim**만 원자적으로 `attached`로 소비한다. 외부 URL, 미검증 경로, 다른 실행자의 등록 전 업로드, curation 등의 다른 kind는 공용으로 전환하지 않는다.
- 상품 trigger의 기존 동일상품 이동·복사·신규 claim 검증을 유지하며 활성 공용 자산만 추가 예외로 허용한다. 자산 행에 `FOR SHARE`를 잡아 상품 저장과 보관이 경합하면 한쪽이 완료된 상태를 다시 검사한다.
- 이름·보관 상태 변경은 기대 revision을 대조하고 매 저장을 감사한다. 충돌은 SQLSTATE `PT409`다. 등록 재시도는 같은 실행자·ID·경로·이름·최초 revision일 때만 원래 결과를 반환한다.
- 상품 대표/추가/상세/HTML, 큐레이션, 스토어 설정의 경로 참조를 표시·검사하고, 참조가 있으면 보관을 거절한다. 보관해도 Storage 객체와 attached claim을 유지한다. **자동 만료·영구 파일 삭제·기존 카탈로그 이미지의 일괄 편입은 없다.** 큐레이션/로고 편집기에 공용 good 이미지 사용 권한을 새로 부여하지 않는다.

## 검증

- [SQL](../../../supabase/tests/admin_goods_photo_library.sql): 스태프 간 재사용, 등록 전 타인 claim 거부, 2상품의 3슬롯 참조 중복 제거, 참조 중 보관 거부, 이름/보관/복구 revision·감사, 경로 불변, 고객 RLS, 함수 ACL, public 객체 GC 제외를 확인했다.
- [실제 경합](../../../supabase/tests/goods_photo_library_concurrency.sh): 상품 연결을 먼저 잠그면 보관 요청이 기다린 뒤 `goods_photo_in_use`, 보관을 먼저 잠그면 새 연결이 기다린 뒤 `unverified_artwork`가 된다. 단순 sleep 순서 추정 없이 `pg_blocking_pids`로 경합을 확인했으며 전용 fixture는 정리했다.
- 실제 Chrome 업로드 → 이름 v2 저장 → 보관 v3 → 복구 v4 → 동일 사진으로 합성 상품 A/B를 각각 서버 저장 → 연결 2건·사용처 링크·보관 비활성 → 다른 탭 이름 v5 저장 → 오래된 v4 저장 거부·입력 보존을 검수했다. DB에서도 경로 1개, 상품 참조 2개, Storage public 객체 1개를 읽었다.
- 390px 사진 목록·직접입력 고객/어드민 주문 상세의 가로폭은 모두 390px이다. QA 증거 (`/tmp/icons-admin-catalog-followup-20261013/manifest.json`)에 캡처별 의미를 기록했다.
- 관련 단위 5파일 30테스트·ESLint·typecheck, SQL·2세션 경합 검증을 통과했다. 전체 빌드·운영 적용·배포는 이 단위에서 실행하지 않았다.

## 충돌 상태 코드 실측

처음 적용한 사진 writer는 낙관적 revision 충돌을 PostgreSQL `40001`로 냈다. 실제 UI 요청이 약 60초 뒤 일반 실패로 끝나 별도 후속 migration에서 `PT409`로 바꿨다. 데이터에 접근하지 않는 임시 RPC를 소유 격리 API에 원시 HTTP로 비교한 결과 `PT409`는 HTTP 409/42ms, `40001`은 HTTP 504/60,005ms였다. 이는 Next.js/HMR·SDK 재시도를 거치지 않은 재현이다. 정확한 PostgREST 내부 재시도 기전까지 확인한 것은 아니다. 임시 RPC는 `finally`로 삭제하고 부재를 재조회했다.

교정 후 동일 UI 충돌은 Next 서버 액션 HTTP 200(구조화 오류) 헤더 수신 211.6ms, 클릭부터 오류 표시까지 349ms였으며 최신 데이터와 오래된 입력을 각각 보존했다. 이미 적용한 [원본 migration](../../../supabase/migrations/20261020085153_admin_goods_photo_library.sql)은 보존하고 [후속 migration](../../../supabase/migrations/20261020085155_admin_goods_photo_conflict_status.sql)으로 HTTP 계약만 교정했다.

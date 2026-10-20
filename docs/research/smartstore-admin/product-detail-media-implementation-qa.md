# 상품 동영상·숏클립 구현·검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-13 격리된 로컬 Supabase와 실제 Next 화면에서 MP4 업로드, 검증, 저장, 우선순위, 재생, 실패 대체, 충돌과 복원을 확인했다. 운영 배포나 네이버 설정 적용은 하지 않았다. 원본과 별도로 정한 파일 제한은 [대조 문서](product-detail-media-parity.md)에 명시했다.

## 저장·권한·정리

`/admin/catalog/goods/media?goodId=…`는 상품의 동영상·숏클립 슬롯을 편집한다. 상품 수정 화면의 `catalog.manage` 링크로 진입한다. `/admin/display/detail/media`는 `store.manage` 권한으로 이미지/동영상/숏클립 우선순위와 별도 숏클립 표시를 설정한다. 상품별 구성과 스토어 설정은 각각 revision, operation UUID, CAS, 감사 영수증을 갖는다. 확인할 수 없는 저장 응답은 입력과 요청을 고정하고 동일 요청으로 확인한다.

`20261020085301_goods_video_media.sql`을 OWN/FRESH에 적용했다. 각 migration 이력의 SQL은 정확히 한 항목이며 파일 SHA-256 `3a8de4df7f8a2e2762707aeaa17a5a09094509507d55c04e7167e26a04fa136d`와 일치했다. 이력 재조회 (`output/smartstore-reference-20261012/verification-goods-media/migration-ledger-readback.json`)를 남겼다.

- `private.goods_media_assets`는 소유자·고유 경로·원본 크기와 `pending → processing → verified → attached/retired → cleanup → cleaned` 상태를 보관한다. 신규 연결은 본인의 유효한 검증 완료 자산만 허용하며, 기존 연결은 다른 권한 있는 관리자가 유지·제목 수정할 수 있다.
- 브라우저 쓰기는 현재 `catalog.manage` 권한이 있는 본인의 pending 경로에 새 객체를 한 번 만드는 것만 허용한다. 덮어쓰기는 허용하지 않는다. 서버는 실제 Storage MIME·크기, 구조 검사와 정규화 결과, 공개 Storage 객체 존재를 확인한 뒤에만 verified로 확정한다.
- 검증 시작은 processing lease를 현재시각부터 15분으로 갱신한다. 검증 응답 유실은 공개 객체를 보존하고 동일 claim 재조회로 복구한다. 확정된 권한 거절 `42501`과 확정 false는 재정리를 요청한다. 전송/불명확 오류는 삭제 근거로 쓰지 않는다.
- 해제된 영상과 상품 삭제 cascade로 분리된 영상은 **분리된 시각부터 7일**간 retired 상태로 보관한다. GC는 먼저 행을 예약하여 재연결을 막고 Storage 삭제가 성공한 뒤 완료를 기록한다. 현재 연결된 자산은 공개 바이트 정리에서 제외한다.
- lease 만료 후 늦게 끝난 업로드가 이미 cleaned된 경로에 객체를 다시 만들 수 있다. GC는 **cleaned 행의 고유 경로에 실제 Storage 객체가 다시 존재하는 경우**도 재예약한다. 소유자 프로필 삭제나 취소 RPC 실패가 있어도 이 객체가 영구 고아로 남지 않는다.
- `/api/cron/goods-media`는 정확한 `CRON_SECRET` bearer를 검사하고 한 번에 최대 20개를 정리한다. 일부 삭제·완료 기록이 실패하면 503을 반환하며 재시도 대상으로 남긴다. 설정된 스케줄은 매일 03:27 UTC다. 로컬에서는 실제 Storage API와 service RPC로 삭제·완료를 확인했으며 운영 cron 실행을 검증한 것은 아니다.

공개 getter는 공개·미보관·판매 제한 없는 굿즈와 공개 IP만 반환한다. Storage의 검증 완료 영상 URL 자체는 공개 자산 URL이며 비공개 콘텐츠의 접근 제어 수단이 아니다. 공개 승격 후 아직 상품에 저장하지 않은 파일은 만료 정리 대상이다. 미디어 원장·바인딩·설정의 직접 접근을 봉인하고 공개 RPC별 권한 및 내부 본문 해시를 등록했다.

## 파일 검사와 재생

검사기는 전체 50MB, 박스 5,000개·깊이 10단계, 트랙 최대 2개·트랙별 샘플 15,000개로 파서 입력을 제한한다. 컨테이너 크기·표 개수·로컬 참조, 허용 코덱, 샘플의 실제 `mdat` 범위와 중복, AVC NAL 길이, 타임라인·크기를 확인한다. 컨테이너 제목·작성시각 등 제거 가능한 메타데이터를 원래 byte extent 안에서 제거하여 샘플 오프셋을 보존한다. 최종 파일 SHA를 저장한다.

공개 플레이어는 native controls와 `playsInline`을 사용한다. 자동 재생하지 않으며 비활성 갤러리 슬라이드는 정지한다. 최초 로드와 재생 중 지연에는 12초 한도를 두고 오류·시간 초과 때 대표 이미지로 전환한다. 숏클립 별도 영역도 동일 플레이어를 사용한다.

## 검증

관련 11파일 **86테스트**, 전체 TypeScript, 관련 ESLint와 diff 검사를 통과했다. 파서는 실제 합성 H.264/AAC 파일과 잘린 컨테이너·과대한 샘플 표·외부 참조·지원 외 코덱·깨진 NAL·1분 초과를 검사한다. 서버/액션 테스트는 실제 크기 대조, 검증되지 않은 바이트의 승격 금지, 응답 유실 후 보존·복구, 늦은 업로드와 재정리 순서, `42501`/unknown 분리, 정확한 저장 영수증을 검증한다.

OWN/FRESH 기능 SQL은 `safeupdate`를 켜고 직접 ACL, 본인/타인 claim, 두 슬롯·실물 객체·CAS·멱등 감사·공개/IP 게이트·상품코드 cascade·현재 권한, lease 갱신·ownerless 늦은 객체·삭제시점 유예를 통과했다. 두 DB의 권한 coverage는 RPC 362개·RLS 90개·내부 helper 500개로 통과했다.

복제 DB 경합은 REST 방식 읽기 전용 트랜잭션, 같은 상품 CAS, 같은 operation 재시도, payload 충돌, 취소 후 연결 거절, 연결 후 취소 보호, GC 예약 후 연결 거절, 권한 회수 후 저장 거절, 최종 원장 재조회를 통과했다. 실제 잠금 대기를 관찰했고 revision 4·감사 4개·연결 자산 1개를 확인했다. 10,000개 cleaned claim과 늦게 생긴 객체 1개에서 GC 예약은 로컬 2.769ms였으며 측정 데이터는 롤백했다.

```sh
cat supabase/tests/helpers/goods_kc_fixture.sql supabase/tests/goods_media.sql | docker exec -i supabase_db_<격리DB> psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1
SUPABASE_DB_CONTAINER=supabase_db_<격리DB> GOODS_MEDIA_TEST_SCOPE=isolated-local bash supabase/tests/goods_media_concurrency.sh
```

## 실제 화면과 복원

화면 증거 (`output/smartstore-reference-20261012/verification-goods-media/manifest.json`)에 데스크톱·390px·저장·오류·복원을 기록하고 PNG 해시를 확인했다. 로딩/불완전 캡처는 제외했다.

- 합성 2초 MP4를 실제 UI에서 동영상·숏클립 슬롯으로 각각 전송하고 제목을 저장했다. 실제 업로드 재조회 (`output/smartstore-reference-20261012/verification-goods-media/actual-upload-readback.json`)는 attached 자산 2개, staging 객체 0개, 공개 객체 2개와 revision 1을 확인한다.
- 이미지 → 동영상 → 숏클립 우선순위가 공개 상세에 반영됐다. 실제 Chrome 디코더에서 영상이 2초까지 재생되고 오류가 없었다. 다른 이미지로 이동하자 0.31초 지점에서 정지했다. 별도 숏클립 영역도 실제 재생했다.
- 390px 공개/관리자 문서의 client/scroll 폭은 모두 380px로 가로 넘침이 없었다. 임시 viewport와 영상 URL 차단 설정은 검증 후 해제했다. 영상 URL 실패 시 대표 이미지와 안내가 나타났다.
- 두 관리자 탭에서 stale revision 저장을 거절하면서 `충돌 보존 동영상` 입력을 유지했다. MP4 확장자만 가진 잘못된 바이트는 실제 Storage 전송 후 서버가 거절했고 기존 연결은 유지됐다.
- 두 연결을 해제하고 이미지 우선·별도 숏클립 OFF로 복원했다. 최종 DB 재조회 (`output/smartstore-reference-20261012/verification-goods-media/final-database-readback.json`)는 상품/설정 revision 3/3, 감사 3/3, 정리 영수증 3개와 두 전용 버킷 객체 **0개**를 확인한다. QA 자산 원장 3개는 cleaned 상태로 추적 근거를 남겼다. 기존 상품·재고·이미지는 수정하지 않았다.
- 최종 공개 재조회 (`output/smartstore-reference-20261012/verification-goods-media/final-browser-readback.json`)는 영상·별도 숏클립 0개, 이미지 갤러리와 활성 구매 버튼 유지 상태다. 해당 QA 구간의 콘솔 오류는 확장이 추가한 `data-immersive-translate-page-theme` hydration 경고뿐이었다.

선정 베스트리뷰와 동일 제품군의 다른 구성은 이 단위의 완료 범위에 포함하지 않는다.

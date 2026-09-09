# 지우학 온라인 팝업 프레젠테이션

`/ip/aouad`는 Netflix 관계자에게 ICONS의 온라인 팝업 경험을 보여주는 전용 시연이다. 기존 `/ip` 카탈로그와 나란히 연결하며 실제 주문·결제·재고·리워드·현장 예약·외부 게시를 만들지 않는다. 원본과 에셋 이력은 [모듈 README](../../components/online-popup/aouad/README.md)를 따른다.

## 접근과 회수

- 기본값은 `AOUAD_POPUP_ENABLED=true`, `AOUAD_POPUP_PUBLIC=false`다. 정지되지 않은 staff/admin만 `/ip`의 카드를 보고 `/ip/aouad`에 들어간다. 비로그인·일반 회원의 직접 진입은 `notFound()`로 차단한다. Next.js의 스트리밍 응답은 HTTP 200일 수 있으므로 검증할 때 상태 코드만 보지 않고 not-found 화면·시연 본문 부재·noindex를 함께 확인한다.
- 서버 권한은 `lib/aouad-popup.server.ts`의 `getCurrentAdminAuthState()` 검사다. 디렉토리의 `is_staff` readback은 노출용이며 서버 검사를 대신하지 않는다.
- 공개 전환은 `lib/aouad-popup.ts`의 `AOUAD_POPUP_PUBLIC`을, 전체 회수는 `AOUAD_POPUP_ENABLED`를 변경한 뒤 같은 검증·배포 경로로 반영한다. 비공개 기본값을 환경 변수로 우회하지 않는다.
- 페이지는 `force-dynamic`이고 `noindex, nofollow`다. 전용 화면의 ICONS 복귀 링크로 `/ip`에 돌아온다.
- 이미지·영상·오디오·게임 JSON 229개는 `private/ip-popups/aouad/`에 둔다. 같은 URL의 `/ip-popups/aouad/[...asset]` Route Handler가 GET·HEAD마다 같은 권한과 회수 스위치를 확인하며, 거부는 HTTP 404와 빈 본문이다. 모든 응답은 `private, no-store, max-age=0`이며 영상은 스트리밍과 단일 byte Range를 지원한다. 에셋을 `public`으로 복사하면 권한을 우회하므로 금지한다. 새 파일은 `asset-index.json`의 크기·SHA와 생성 이미지 manifest를 함께 갱신한다.

## 로컬 시연

```bash
ICONS_AOUAD_LOCAL_PREVIEW=1 npm run dev -- --hostname 127.0.0.1 --port 4312
```

`http://127.0.0.1:4312/ip/aouad`에서 직접 확인한다. 우회는 `NODE_ENV=development`와 위 변수를 모두 요구한다. production build·Vercel Preview·production에는 같은 변수가 남아도 적용되지 않는다. 실제 staff 권한 확인은 이 우회 없이 검증한다.

상단 `프레젠테이션` 버튼은 시연 범위를 안내한다. HUD의 초기화 버튼은 현재 브라우저의 시연 진행을 새로 시작하는 용도이며 운영 계정·주문 데이터를 삭제하지 않는다. 저장소 차단·손상 시에는 현재 세션의 메모리 상태로 계속 동작한다.

## 이미지와 검수

내장 ImageGen으로 생성한 디자인 시안 23종을 무크롭 WebP quality 90으로 패키징했다. 원본 PNG는 repo 밖에 보존하며 manifest의 원본/최종 SHA-256으로 동일성을 확인한다. 기존 upstream `provenance.json`은 변경 전 입력 기록이다.

| 범위 | 최종 크기 | 크기 합계 | 기록 |
|---|---|---:|---|
| 일반 굿즈 9종 | 1440×1080 6종 · 1200×1200 3종 | 2,237,660 bytes | `generated-asset-manifest.json` |
| 소형 경품 14종 | 1200×1200 | 2,498,016 bytes | `generated-box-asset-manifest.json` |

2026-09-09 최종 23종의 원본·최종 직접 시각 검수 통과 및 46개 SHA-256 일치를 확인했다. 이 이미지는 제작된 실물의 촬영본이 아니라 디자인 시안이며 상품화·실거래의 완료 근거가 아니다.

## 검증 기록 — 2026-09-09

- `npm run lint`: 통과, 오류 0개. 이 모듈은 경고 0개이며 기존 `hong-sil-downloader.mjs`의 경고 1개는 변경 범위 밖이다.
- `npm run typecheck`: Next route type 생성과 테스트 TypeScript 검사 통과.
- `npm run build`: production build 통과. `/ip/aouad`가 요청별 서버 렌더링 경로(`ƒ`)로 출력됐다. 로컬 실행이므로 Vercel의 Preview/production 환경 변수 검증은 배포 workflow에서 별도로 수행한다.
- 로컬 production build에 `ICONS_AOUAD_LOCAL_PREVIEW=1`을 남긴 상태에서도 비로그인 시연 본문과 `/ip` 진입 카드가 노출되지 않았다. 응답은 스트리밍 HTTP 200·noindex·private no-store였다. 새 이미지 23종은 실제 HTTP bytes의 SHA-256이 manifest와 모두 일치했다.
- 호스트·권한·HUD·미디어·게임·시연 상태·커머스 집중 테스트: 21파일 208개 통과.
- 브라우저: 첫 방문 이름/사진 선택 → 학생증 → 허브, 급식실 완료 결과 복원·재도전 제한, 방송실 시작 전 입력 차단·학생증 모달 중 일시정지·복귀·결과 제한을 확인했다. 도서관은 실제 입력으로 탈출(60.8초·무피격·책갈피 4/5·비밀 서고)을 확인했고, 결과 뒤 키보드 재시작 우회도 수정 후 재완주·새로고침으로 차단을 검증했다. 네 뽑기 방식의 확인·개봉·결과·복귀·회차 전환 취소·잔여 수량을 확인했다.
- 상품 상세 37개를 모바일에서 열어 이미지·명칭·옵션을 확인했고 14개 허브 장면을 데스크톱/모바일로 검수했다. 서로 다른 사이즈의 장바구니 합계, 주문 체험, 커뮤니티 작성, 현장 예약과 변경을 확인했다.
- 래플 1회·사전예약의 선택 SKU/옵션·선착순 2개 주문(24,000원·잔여86→84·누적138,000→162,000원)을 확인했다. 허브/상세/HUD가 같은 재고를 읽고 카운트다운과 기록은 새로고침에도 유지된다.
- 새 이미지 23종의 검수는 각 manifest의 `passed`와 최종 SHA에 결속한다. 브라우저의 최종 배치 검수와 서버 배포 상태는 이미지 검수와 별개다.

### PR #458 리뷰 수정 검증

- 전체 저장소 481개 테스트 파일의 4,889개 테스트 통과(기존 3개 skip·1개 파일 skip). 최종 권한·사진·뽑기 집중 검증, lint·typecheck·production build도 통과했다.
- 에셋 경로 권한·HEAD·Range·경로 탈출·symlink·229개 SHA와 생성 이미지 manifest를 확인했다. 최종 Node 함수의 Next 출력 추적에는 에셋 229개가 모두 포함되고, 고유 파일 332개·107,419,885 bytes이며 무관한 저장소 에셋은 포함되지 않았다. 실제 Vercel 함수 크기는 Preview 배포 산출물에서 확인한다.
- 사진 파일 선택 → 학생증 240×180 반영 → 새로고침 복원을 확인했다. 진열은 데스크톱 1440×900·모바일 390×844에서 확인했고, 첫 표지의 이미지 요청은 2개였다. 지연 마운트 뒤에도 모바일 14개 장면이 직접 URL로 정상 진입한다.
- 네 뽑기 방식의 정확한 상품·보관함 복원, G1 세 칸 동시 개봉, G2 10회 뒤 한도와 잔여 70의 새로고침·회차 전환 복원, 배송 신청 1건의 주문 내역 반영을 실제 UI로 확인했다. G3에서는 확인 직후 결과 연출 중 학교 맵으로 나간 다음 새로고침한 보관함에 새 결과가 유지됐다.
- 일일 한도는 시연 카운트다운과 무관한 실제 KST 자정 기준으로 회차별 10회다. 자정에도 열린 칸은 복원되지 않는다. 시연 상태 초기화만 네 판을 새로 만든다. 이 기록은 실제 결제·경품 배정·배송의 운영 원장이 아니다.

## 배포와 실제 도메인 확인

Vercel Git 자동 배포는 비활성화되어 있다. 일반 PR의 `validate`·Supabase Preview·Vercel Preview 성공 및 현재 head의 리뷰 결과를 확인한 뒤 승인 범위에서 merge한다. `main` Actions의 production DB·Vercel·shared Preview·staging 결과까지 확인한다. 이 작업은 DB migration을 추가하지 않는다.

배포 후에는 실제 `https://iconsip.com`에서 다음을 확인한다.

1. 비로그인·일반 회원은 시연 카드가 없고 `/ip/aouad`는 차단된다. staff/admin은 `/ip`에서 시연에 진입한다.
   에셋 직접 URL의 GET·HEAD·Range도 비로그인·일반 회원은 404여야 한다. staff의 실제 이미지·Phaser 에셋·오디오·영상 재생 및 seek를 확인한다.
2. 데스크톱·모바일의 첫 방문, 모든 장/존 이동, 상품 옵션·장바구니·주문 체험, 학생증·퀘스트, 세 게임, 네 뽑기 방식, 현장 예약 체험, 뒤로가기·새로고침·초기화를 확인한다.
3. 화면의 시연 표기, 네이티브 대화상자 초점·Escape, 숨긴 패널의 키보드 제외, 오류 없는 네트워크/콘솔을 확인한다. 시연 행동으로 실제 거래 API가 호출되지 않아야 한다.
4. 배포 SHA와 canonical alias를 확인하고 새 이미지 23종의 실제 HTTP bytes를 manifest의 최종 SHA와 대조한다. 실제 Preview/production 실행 결과는 연결된 PR의 배포 체크와 완료 기록으로 남긴다.

이 문서의 수치는 로컬 검증 기록이다. [PR #458](https://github.com/icons-hq/icons-ip/pull/458)의 최신 head 체크와 merge 이후 main Actions, 작업 완료 기록에서 실제 배포·read-back 결과를 확인한다.

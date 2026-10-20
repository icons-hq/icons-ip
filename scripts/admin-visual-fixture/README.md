# Admin visual fixture

이 fixture는 저장소의 실제 `GoodsListScreen`,
`ConsoleFilterPanel`, `GoodsOptionEditor`, `GoodEditor`, `AdminShell`을 Vite loopback 화면에 올려
브라우저에서 좁은 필드·GET 상태·옵션 조합·사이드바 접기를 확인하기 위한
component interaction harness다.

```sh
node scripts/admin-visual-fixture.mjs
```

기본 포트는 `http://127.0.0.1:4319/`이며 `?view=goods`, `?view=filter-date`,
`?view=options`, `?view=editor`, `?view=shell`을 선택한다. 저장 action은 연결하지 않고, synthetic
한국어·ERP 데이터만 사용한다. `/api`와 `/auth`는 fixture 서버에서 503으로 차단되고,
클라이언트 fetch도 외부 origin/API를 거부한다.

어드민 글꼴은 앱과 같은 `admin-font.css` 및 로컬 Pretendard 1.3.9를 사용한다.
fixture는 저장소 `public/` 전체를 공개하지 않고 `/fonts/admin/PretendardVariable.woff2`와
`/admin/seller-icons/{sales,claims,goods,reviews}.svg` 네 아이콘 및
상품문의 합성 행에 쓰는 기존 `/generated/goods/g13.webp`의 정확한 경로에만
GET·HEAD를 제공한다. 기존 글로벌 CDN import는 fixture에서 제거하므로
캡처 전에 `document.fonts.load('400 14px "ICONS Admin Pretendard"')`가 완료됐는지 확인한다.
원본 URL·버전·SHA-256은 `docs/licenses/pretendard-source.json`, 원본 라이선스는
`docs/licenses/pretendard.txt`에 보존한다.

화면 비교 캡처는 `http://127.0.0.1:4319/?view=overview&capture=1`처럼
`capture=1`을 지정한다. fixture 이동 toolbar와 `editor`의 합성 저장 제어만
`hidden` wrapper로 숨기며 마운트 상태·실제 앱 컴포넌트·동작은 유지한다.
파라미터를 빼면 제어가 다시 나타난다. 기존 `clean=1`은 이동 toolbar를 숨긴다.
`next/link` adapter는 `prefetch`, `scroll` 등 Next 전용 props를 DOM에서 제외한다.
`view=editor`는 navigation adapter에서 실제 상품 경로와 `create=1`로 해석한다.
명시된 `create`·`goodId`는 보존하며 브라우저 주소 자체는 변경하지 않는다.

`?view=orders&capture=1`은 실제 `OrderItemsScreen`에 합성 상품주문 6개를,
`?view=claims&capture=1`은 실제 `ClaimQueueScreen`에 합성 반품 요청 4개를 표시한다.
상태·검색어·페이지는 합성 행을 대상으로만 작동한다. 날짜 등 나머지 조건은 조판 검수용이며,
발주확인·엑셀·환불·수거 등 서버 작업의 성공을 재현하지 않는다.

서버 액션은 명시적 fixture adapter로 대체하며, Supabase 설정·클라이언트 import는
미설정·연결 거부 adapter를 사용한다. 새 화면 의존성을 추가한 뒤에는 서버를 실행한
상태에서 다음 명령으로 실제 Vite import 그래프에 서버 모듈이 섞이지 않는지 확인한다.

```sh
node scripts/admin-visual-fixture/import-boundary-qa.mjs
```

`cs-qna`는 상품 이미지와 행 안 답변 펼침, `cs-inquiries`는 문의 선택 후 목록 아래 좌우 응대 영역도 렌더한다. 답변·메모·고객 조회는 기존 fixture 경계로 차단하며 실제 저장 성공을 재현하지 않는다.

이 검사는 화면 코드를 실행하지 않고 변환된 모듈의 named export 연결과
`/api`·`/auth` 차단 응답을 확인한다. `overview`는 합성 문의·리뷰 데이터도 표시한다.

`editor`는 실제 굿즈 편집에서 가격·옵션·미리보기, 고시 복사, 실패 입력 보존,
새로고침 후 복구와 성공 후 복구 기록 삭제를 검증한다. 저장 결과 선택은 합성 action만
실행하고, 장바구니·서버 쓰기는 실패로 차단한다. 업로드 adapter는 합성 검증 완료 경로를
반환해 실제 업로드 위젯의 hidden input·복구 연결을 검증하며 Storage에는 접근하지 않는다.
상품속성 조회는 fixture에 정의된 합성 카테고리의 빈 정의·빈 저장값만 반환해
편집기의 준비 완료와 합성 저장 성공/실패를 검수할 수 있다. 실제 카테고리 조회·저장은 연결하지 않는다.

이 화면은 route/auth/DB/production 배포의 완성 검증이 아니다. 직접 컴포넌트 렌더링을
통한 시각·상호작용 검수이며, 실제 staff 인증과 서버 권한은 staging의 `/admin/**`에서
별도로 확인해야 한다. CSS는 `app/globals.css` 뒤에 app/layout의 관리자 CSS 순서
(`wc-foundation`, `wc-admin-surfaces`, `wc-admin`, specialized admin CSS)를 적용한다.

`main.tsx`의 account/action/navigation shim은 fixture 경계용이며 제품 코드가 아니다.
`next-image.tsx`는 썸네일 조판만 재현한다. Next 이미지 최적화와 실제 경로 응답은 연결된 앱에서 검증한다.

interaction QA와 PNG·JSON은 저장소 밖으로 남긴다.
기본 출력은 매 실행 새 전용 임시 디렉터리다. 지정한 경로는 저장소 밖의 private
디렉터리(0700)여야 하며, 저장소 내부로 연결되는 심볼릭 링크도 거절한다.

```sh
ADMIN_VISUAL_FIXTURE_OUTPUT=/private/qa/admin-fixture node scripts/admin-visual-fixture/qa.mjs
```

외부 DOM 캡처의 선택 컴포넌트만 재생하려면 `ADMIN_QA_SNAPSHOTS_DIR`에
`capture-manifest.json`과 그 하위의 HTML 및 `assets/`를 두고 서버를 시작한다.

```sh
ADMIN_QA_SNAPSHOTS_DIR=/private/qa/captured node scripts/admin-visual-fixture.mjs
```

`/admin/visual-replay/<route-id>?width=390`은 캡처 HTML의
`.wc-admin-kit__field > select.admin-field-control`, 상태 filter의
`select[id$="-status"]`, 검색 유형 select만 실제 `AdminSelect`로 mount한다.
`captured-components` 표시는 선택 컴포넌트와 local CSS·font·image만 검수한 결과이며,
전체 Next route·Auth·권한·DB·저장 action 검증이 아니다. 캡처의 script는 제거하고
`/api`·`/auth`와 POST를 허용하지 않는다.

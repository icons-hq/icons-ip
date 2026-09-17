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

`editor`는 실제 굿즈 편집에서 가격·옵션·미리보기, 고시 복사, 실패 입력 보존,
새로고침 후 복구와 성공 후 복구 기록 삭제를 검증한다. 저장 결과 선택은 합성 action만
실행하고, 장바구니·서버 쓰기는 실패로 차단한다. 업로드 adapter는 합성 검증 완료 경로를
반환해 실제 업로드 위젯의 hidden input·복구 연결을 검증하며 Storage에는 접근하지 않는다.

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

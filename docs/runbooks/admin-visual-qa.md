# 어드민 시각 QA 반복 실행

`scripts/admin-visual-qa.mjs`는 실제 Chromium 렌더링에서 페이지 식별, 폼 폭, 버튼·선택 문구 잘림, 컨트롤 겹침, 가로 넘침을 측정하고 PNG·JSON·Markdown 증거를 남긴다. 판정은 기하학 검사 결과이며, 화면 이미지의 디자인 검토나 ADR-0014의 운영팀 S1~S5 인수를 대신하지 않는다.

## 실행 환경

- 저장소의 Node 런타임과 설치된 `playwright-core`를 사용한다. 패키지나 브라우저를 자동 설치하지 않는다.
- 기존 Chrome/Chromium이 필요하다. 자동 탐색이 안 되면 `ADMIN_QA_BROWSER_EXECUTABLE`에 실행 파일 절대 경로를 지정한다.
- 브라우저 프로필을 복제하거나 기존 Chrome에 접속하지 않는다. 매 실행 전용 headless 브라우저를 만들고 `finally`에서 닫는다.
- 산출물은 저장소 밖 디렉터리만 허용한다. 기본은 운영체제 임시 디렉터리이며 새 디렉터리는 `0700`, 파일은 `0600`으로 저장한다. 이미 있는 출력 디렉터리가 private하지 않으면 다른 전용 경로를 요구하며 그 경로의 권한을 임의로 바꾸지 않는다.

브라우저 도구 가용성은 현재 작업에서 따로 확인한다. 이 저장소 CLI는 사용자 요청으로 만든 반복 검사용 Playwright 경로이며, 브라우저 앱에서 수행한 live 검수를 대체했다고 보고하지 않는다.

## 실제 서버 읽기 검사

이미 실행 중인 로컬 앱과 이미 발급된 권한 있는 세션으로 실행한다.

```sh
ADMIN_QA_STORAGE_STATE=/private/qa/admin-storage-state.json \
node scripts/admin-visual-qa.mjs \
  --origin http://127.0.0.1:3000 \
  --output /private/qa/admin-live
```

기본 origin은 `http://127.0.0.1:3000`이다. 임의 URL 경로, 사용자정보, query를 origin에 넣을 수 없다. 원격 서버 읽기는 `--allow-remote-read-only`를 명시해야 한다. storageState는 제공된 파일만 읽으며 로그인, 계정 생성, 역할 변경, Auth 우회, DB bootstrap을 수행하지 않는다. 미인증으로 로그인·404가 렌더되면 실패한다.

폼 전송과 클릭을 하지 않는다. 브라우저의 `GET`, `HEAD`, `OPTIONS` 이외 HTTP 요청과 WebSocket을 차단하고 service worker도 사용하지 않는다. 세션 갱신이나 읽기 RPC가 POST를 요구해 차단되면 `read-only-request-blocked`로 실패한다. 검사 편의를 위해 이 경계를 해제하거나 DB를 변경하지 않는다. 앱 서버가 GET 처리 중 수행하는 자체 동작까지 이 브라우저 가드가 격리하는 것은 아니다.

## 실제 DOM 캡처 재생

사용자가 이미 열어 둔 권한 있는 화면을 읽어 얻은 DOM과 해당 화면의 CSS·폰트·이미지를 외부 디렉터리에 보관한다. 캡처 생성은 별도 읽기 작업이다. 예를 들어 다음 manifest와 HTML을 준비한다.

```json
{
  "capturedAt": "2026-09-14T00:00:00.000Z",
  "routes": [
    {
      "id": "goods-create",
      "path": "/admin/catalog/goods?create=1",
      "heading": "상품 등록",
      "htmlFile": "goods-create.html"
    }
  ]
}
```

```sh
node scripts/admin-visual-qa.mjs \
  --snapshot-manifest /private/qa/captured/capture-manifest.json \
  --output /private/qa/replay
```

runner가 임의 포트의 `127.0.0.1` 정적 서버를 열고 종료한다. 별도 origin과 storageState를 함께 전달할 수 없다. manifest와 같은 디렉터리 하위의 HTML 및 CSS·폰트·이미지만 제공한다. `/assets/example.woff2`처럼 root 절대 경로를 쓰며 HTML 파일은 `/__snapshot/<id>`에서 열린다. `htmlFile`은 manifest 디렉터리 밖으로 나갈 수 없다. JSON·JavaScript·기타 파일은 정적 asset으로 제공하지 않는다.

재생에서는 페이지 JavaScript, 외부 네트워크, form-action, frame, connect를 막는다. CSP는 `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`, `img-src 'self' data:`, `script-src 'none'`이다. 따라서 HTML에 React script가 남아 있어도 실행하지 않는다. 캡처를 만들 때 불필요한 script·외부 리소스 링크를 제거하고 필요한 로컬 자산을 명시해두면 CSP 오류가 검수 결과를 가리는 일을 줄일 수 있다.

`ResponsiveContainer` 차트처럼 JavaScript가 viewport별 SVG 크기를 계산하는 화면은 각 폭에서 실제로 캡처해야 한다. 해당 route에 `"htmlFilesByWidth": { "390": "overview-390.html", "320": "overview-320.html" }`을 추가하면 정확한 폭의 파일을 우선 사용하고 나머지는 `htmlFile`로 돌아간다. 보고서는 각 파일의 `viewportWidth`와 해시를 남긴다. 모바일에서 고정된 데스크톱 SVG를 재생한 결과를 실제 앱의 반응형 결함으로 단정하지 않는다.

CSS 변경 검증에서는 캡처의 옛 admin 규칙을 제거하고, 현재 저장소에서 `app/layout.tsx`가 로드하는 CSS 순서대로 넣는다. 옛 CSS 위에 현재 파일을 추가하기만 하면 삭제된 규칙이 살아남아 실제 결과와 달라질 수 있다. 재생 보고서는 **`captured-layout`**으로 고정하며 HTML·실제 제공된 CSS/폰트/이미지의 SHA-256과 PNG 해시를 기록한다. 이는 현재 코드의 hydration·서버 로딩·Auth·권한·클릭·저장·모달 상태 검증이 아니다.

## 경로·상태·뷰포트 manifest

실제 `AdminSelect`만 부분 mount하는 로컬 fixture는 외부 `--manifest`에 `"evidenceMode":"captured-components"`를 명시한다. 각 route는 실제 재생 `path`와 캡처 원본 `sourcePath`, `readySelector`(예: `body[data-admin-select-replay-ready]`)를 가진다. `"viewportQuery":"width"`를 지정하면 각 viewport 폭을 URL query로 전달하며 준비 표시가 보인 뒤 측정한다. 이 모드는 loopback origin만 허용하고 storageState와 외부 요청을 차단한다. 보고서에는 sourcePath와 실제 URL을 나란히 기록하며 coverage도 캡처한 원본 template에만 해당한다. 캡처 DOM·현재 CSS·해당 실제 React 컴포넌트의 결과이며 전체 Next.js 라우트·Auth·서버 기능의 검증이 아니다. 기존 정적 snapshot 모드의 JavaScript 차단은 유지한다.

기본 목록은 `scripts/admin-visual-qa-manifest.mjs`이며 1440×1000, 1280×900, 1024×900, 768×1024, 390×844, 320×740을 검사한다. 기본 목록에는 주요 정적 어드민 화면과 IP·상품 등록 query가 있다. 레코드 상세는 실제 존재하는 ID가 필요하므로 임의 레코드를 만들지 않는다.

추가 상세·편집 상태는 `--manifest /private/qa/routes.json`의 `routes`에 명시한다. 각 항목은 고유 `id`, 정확한 `path`와 query, 실제 `h1` 또는 `h2`의 정확한 `heading`이 필요하다. `heading` 배열은 여러 정상 제목을 허용할 때만 쓴다. 필요하면 `rootSelector`, `headingSelector`, `minContentCharacters`를 항목에 지정한다. 제목 식별을 일반 본문 문자열로 완화하지 않는다.

등록·선택된 편집·확장된 상세처럼 서로 다른 상태는 별도 id로 기록한다. 스냅샷 재생은 캡처 당시 상태만 검사하므로 닫힌 dialog, 숨은 탭, 빈 목록 뒤의 행 배치가 자동 검증되는 것은 아니다. 단순 GET URL로 열리지 않는 상태는 캡처 manifest 또는 별도 실제 React 상호작용 검사로 보완한다.

좁은 수정 루프는 다음처럼 선택한다.

```sh
node scripts/admin-visual-qa.mjs \
  --snapshot-manifest /private/qa/captured/capture-manifest.json \
  --routes goods-create,ips-create \
  --widths 1280,390 \
  --allow-partial-coverage \
  --output /private/qa/selected
```

선택에서 빠진 manifest 상태, 표준 viewport 폭, `app/admin/**/page.tsx`에서 발견된 미검수 경로 template을 보고서에 모두 남긴다. 로그인·오류·리소스 실패·차단 요청만 얻은 화면은 경로를 방문했어도 검수 coverage로 세지 않는다. 전체 상세 route를 검사했더라도 모든 레코드 값과 숨은 상태를 확인했다는 뜻은 아니다.

## 판정과 증거

| 검사 | 판단 방식 |
| --- | --- |
| 페이지 식별 | 정확한 URL과 query, `.wc-admin`, 예상 heading, 의미 있는 본문을 요구한다. 로그인 URL 또는 가시 password 필드와 로그인 제목·버튼·form action의 조합, 빈 화면·일반 오류 heading·프레임워크 overlay는 실패한다. 검표 payload를 가리는 password 필드 자체를 로그인으로 간주하지 않는다. |
| 입력칸 폭 | 현재 폰트로 일반 텍스트 6개 한글, 숫자 5자리, 날짜 10자리 등 컨트롤 종류별 최소 가시 영역을 측정한다. 긴 input 값의 정상 내부 스크롤을 버튼 잘림으로 오인하지 않는다. |
| 입력칸 높이 | DESIGN.md의 40px 입력 최소 높이를 확인한다. checkbox·radio·color 등의 다른 제어는 제외한다. |
| 글자 잘림 | native select는 현재 선택 문구+indicator 영역, 버튼은 실제 텍스트 Range와 컨트롤 경계를 비교한다. |
| 검색 힌트 | 빈 text/search 입력의 검색 placeholder가 잘리면 기록한다. 24자 이하 짧은 힌트는 error, 더 긴 안내문은 warning이다. |
| 넘침·가림 | 문서 `scrollWidth/clientWidth`, 컨트롤의 페이지 이탈, `overflow:hidden/clip` 조상에 의한 수평 가림을 각각 기록한다. |
| 겹침 | 본문 안의 서로 다른 조작 컨트롤 경계를 비교한다. 자손 관계는 제외하고 overflow 조상들의 실제 가시 영역으로 경계를 잘라 비교한다. 스크롤 밖의 행이 아래 폼과 겹친 것으로 오인되지 않는다. |
| 라벨 파편화 | 좁은 칸에서 짧은 라벨이 여러 줄의 세로 열로 쪼개지는 현상을 기록한다. |
| 의도된 스크롤 | `overflow-x:auto/scroll`의 실제 내부 초과 폭과 표 포함 여부를 별도 기록한다. 표 자체의 가로 스크롤은 문서 overflow 오류가 아니다. |
| 런타임 | console error/pageerror, HTTP 4xx/5xx, 요청 차단을 실패로 기록한다. warning은 근거 JSON에 남겨 검토한다. |

모든 측정은 selector, rect, 실제·필요 폭 같은 수치를 가진다. 픽셀 2 이내 오차는 브라우저 소수점 반올림으로 허용한다. 이 기준은 휴리스틱이므로 발견 사항은 실제 PNG와 함께 판단한다. 의미가 없는 전역 예외나 무조건적인 좁은 화면 skip으로 실패를 감추지 않는다.

닫힌 `<details>`는 직접 `<summary>` 안의 요소만 가시 대상으로 삼는다. `.wc-pdp.is-embedded` 안의 스토어프론트 미리보기 입력은 어드민 입력 최소폭·높이 계약 대상이 아니므로 그 두 검사만 제외하며, 페이지 넘침·부모 가림은 계속 측정한다.

native select의 선택 문구가 잘려도 `aria-describedby`로 연결된 바로 아래 32px 이내의 힌트가 선택값 전체와 정확히 일치하고, 실제 텍스트가 잘리거나 가려지지 않으면 `select-full-value-readable` info와 `fullValueHints` 근거로 기록한다. 최소 입력폭·높이 검사는 그대로 유지한다. 숨겨진 힌트, 다른 설명, 먼 위치의 문구, `title`만 제공한 경우는 이 예외에 해당하지 않는다.

출력은 `report.json`, `report.md`, `<id>-<width>x<height>.json/png`다. JSON에는 입력값·storageState를 넣지 않는다. 화면 캡처와 라벨에는 실제 운영 데이터가 보일 수 있으므로 이 증거는 외부 전용 디렉터리에 유지한다.

| 결과 | 종료 코드 | 의미 |
| --- | --- | --- |
| `pass` | 0 | 요청 상태·표준 폭·소스 경로 template이 모두 검사되고 자동 검사가 통과했다. 별도 이미지 검토와 기능 검증은 여전히 필요하다. |
| `scoped-pass` | 0 | 명시적으로 부분 검수를 허용했고 선택 범위의 자동 검사가 통과했다. 전체 어드민 합격이 아니다. |
| `incomplete` | 2 | 자동 검사 실패는 없지만 경로·상태·viewport가 빠졌다. |
| `fail` / 실행 오류 | 1 | geometry·식별·runtime 검사 실패 또는 검사 실행 오류가 있다. |

## 검사기 자체 검증

```sh
node scripts/admin-visual-qa-self-test.mjs
npx eslint scripts/admin-visual-qa*.mjs
```

자체 검증은 독립 HTML을 실제 Chromium에 렌더링한다. 정상 한국어 폼과 표 가로 스크롤, 긴 input 값은 통과하고, 좁은 필드·선택 문구 잘림·버튼 잘림·문서 넘침·부모 가림·컨트롤 충돌·로그인·빈 셸·틀린 제목·오류 UI를 탐지해야 한다. 원격 origin 및 잘못된 manifest 거절, snapshot POST/경로 탈출 거절, 로컬 CSS 제공, script 미실행, 해시/증거 생성, 부분 coverage의 exit 2까지 검증한다. 이 테스트는 실제 어드민 자체의 합격 근거가 아니다.

측정 함수를 기존 읽기 전용 브라우저 도구에 사용하려면 `scripts/admin-visual-qa-measure.mjs`의 closure-free `measureAdminLayout(options)`를 evaluator에 전달한다. 반환값은 `identity`, `document`, `counts`, `controls`, `intentionalScrollers`, `findings`이며 클릭·폼·DOM 변경은 수행하지 않는다.

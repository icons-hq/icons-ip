# 상품 사진 로고·이미지 서명 구현 QA

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14. 사용자가 고른 정지 이미지 한 장을 사진 안에서 합성하는 도구를 구현했다. [승인 계약](product-photo-logo-proposal.md), [기존 테두리·도형·자동 명암 QA](product-photo-presentation-implementation-qa.md)를 함께 따른다. **관련312개 단위 테스트·타입·정적 검증과 실제 Chrome PC/390px·저장/재열기·4MP/1MP 합성 검증을 마쳤다.** 실제 범위와 부분투명 RGB 양자화 한계는 아래에 구분한다.

## 동작과 경계

- 로컬 PNG·JPEG·WebP 한 장을 허용한다.5MiB·100만 픽셀·각 변2048px 한도, 실제 헤더/MIME, 애니메이션·다중 프레임·컨테이너 경계, EXIF 표시 치수를 검증한다. 로고 자체의 외부 전송·Storage claim·object URL은 없다.
- 세션이 bitmap을 소유하고 UI는 descriptor와 recipe만 가진다. 같은 파일명/바이트의 재선택도 새 asset ID를 발급하며 SHA-256은 파일 바이트에 결속한다.
- 기존 로고를 유지한 채 단일 후보를 디코드한다. 성공한 최신 요청만 기존 렌더가 끝난 뒤 원자적으로 교체한다. 실패는 기존 bitmap·배치를 유지한다. 중복 요청은 거절하고 제거·재설정·취소는 허용한다.
- 정상 상태의 source≤4MP + logo≤1MP에 교체 중 후보≤1MP를 추가한다. 앱 소유 bitmap 최대6MP이며 브라우저 전체 메모리 상한을 의미하지 않는다. 기존 Blob 재디코드 복원이나 최신 대기 요청 큐는 없다.
- 사진 안으로 맞춘 비율 잠금 너비, x/y, 정수 불투명도0~100, 네 모서리/가운데 배치, 드래그·방향키1px/Shift10px를 제공한다. 처음에는 최대 너비25%·오른쪽 아래·짧은 변2% 여백으로 시작한다. 교체는 기존 배치를 유지하고 새 비율에 맞춰 제한한다.
- 사진 보정·모자이크 뒤 로고를 source-over 합성하고 일반 텍스트를 그 위에 추가한다. 회전·반전·자르기·테두리·도형은 전체 결과에 적용한다. Preview 축소는 마지막이다.
- 로고가 투명한 곳은 밑의 사진이 보인다. 사진이 투명한 곳을 로고가 덮으면 alpha가 증가할 수 있다. 출력 MIME은 원본/마스크 계약을 유지하며 JPEG 위 로고만으로 PNG를 강제하지 않는다. 불투명도0만 변경한 완료는 새 파일을 만들지 않는다.
- 교체 중 마지막 완성 미리보기를 유지하고 파일·로고 배치·완료를 막는다. 로고 오류는 렌더 오류와 분리한다. 파일 선택창 취소는 기존 로고를 유지하며 input 값을 비워 동일 파일 재선택을 허용한다.

## 소스와 단위 검증

런타임 변경은 `photo-editor-logo.ts`, `photo-editor.ts`, `photo-editor-session.ts`, `GoodsPhotoLogo.tsx`, `GoodsPhotoEditor.tsx`, `admin-photo-editor.css`의6파일이다. 원본 사진·상품 저장·업로드 호출의 기존 경계는 유지한다.

- 관련13개 테스트 파일312개 PASS. 기존 사진 소스·보정·모자이크·텍스트·도형·취소 회귀를 포함한다.
- 로고 테스트는 실제 PNG/JPEG/WebP 헤더·EXIF·SHA, 빈/모순 MIME,1MP/2048px/5MiB 한도, 동일 이름 ID, 비율·프리셋·1px·opacity0, 렌더 순서, 실패 보존, 단일 후보, 렌더 큐 뒤 교체/해제, clear/dispose/source/request 취소 뒤 늦은 후보 폐기를 포함한다.
- UI 테스트는 중복 선택·로드 중 완료 차단, 새 ID/기존 배치 보존, 제거·재설정·취소, 로고 오류 분리, 원본 비교, 회전 후 이동, input 값 해제와 파일 선택창 취소, 키보드·로딩 중 배치 차단을 포함한다.
- 변경 TS/TSX9파일 ESLint PASS, 사진 범위 TypeScript PASS. 전체 build는 이 단계에서 반복하지 않았다. 실제 브라우저 검증 뒤 통합 검증 담당자가 별도로 판단한다.

검증 명령·소스 SHA·원본 텍스트 사본은 implementation-verification.json (`output/product-photo-logo-qa-20261014/implementation-verification.json`)에 기록한다. 사본은 `.txt`로 저장하여 프로젝트 TypeScript 입력에 섞이지 않는다.

## 실제 브라우저 QA

fixture manifest (`output/product-photo-logo-qa-20261014/fixtures-manifest.json`)는 사용자 자산이 아닌 결정론적 기술 검증 이미지다. `fixtures/a/logo.png`와 `fixtures/b/logo.png`는 같은 파일명·같은1000×1000px이며 색상만 다르고, alpha0 테두리·alpha128 띠를 포함한다. EXIF6 JPEG, 정지 WebP, MIME 모순,1MP/2048px/5MiB 초과, APNG 표식, 손상 파일도 준비했다.

검수 계획은 아래와 같으며, 이번에 실제로 확인한 범위는 다음 절에 기록한다.

1. 첫 선택·같은 이름 교체·실패 시 이전 로고 보존·파일 선택 취소·원본 비교·재설정,390px에서의 조작과 키보드/드래그.
2. PNG source-over를 독립 계산한 불투명 내부 픽셀과 alpha, 부분투명 픽셀의 브라우저 양자화 범위, 회전·반전·자르기·도형 clipping, preview/final 비교. 보간·AA 경계의 검증 범위를 분리한다.
3. 4MP+1MP의 처리 시간·관찰한 프레임 간격, 교체 중 활성 bitmap1개+후보1개, 완료/제거/취소 이후 자원 해제와 늦은 결과 배제. 네이티브 디코드 종료 전에는 메모리를 강제 반환할 수 없는 한계를 표시한다.
4. 편집 적용과 상품 저장을 구분한 DB/readback, 저장·재열기, 기존 공유 원본 파일·행의 보존, QA fixture의 정리.

운영 DB·배포 작업은 이 구현에 포함되지 않는다. 아래 실제 결과는 소유한 로컬 QA 환경의 합성 자료에 한정한다.


## 실제 결과와 증거

ui-manifest.json (`output/product-photo-logo-qa-20261014/ui-manifest.json`)은 실행한 런타임6파일의 SHA와 구현 freeze의 일치를 확인하고,16개 PNG 입력·출력과5개 화면 캡처를 각각 실제 인코딩/치수/SHA에 결속한다. 캡처는 모두 JPEG이며 PC1517×947px, 모바일390×844px다. 두 검토자가 해당 파일을 직접 보았다. PC01/05는 스크롤된 도구 영역이므로 일부만 보이는 preview를 전체 preview 검사로 표시하지 않았고, 전체 PNG 출력도 별도로 직접 확인했다.

- 실제 파일 입력으로 같은 이름의1MP 투명 PNG A→B 교체,5개 위치 프리셋, 좌표·너비·불투명도와 키보드 이동,90도 회전·좌우 반전·300×240 자르기를 확인했다. EXIF6 JPEG는400×600 descriptor로 열렸으며 정지 WebP도 사용했다. 두 형식의 RGB/배치 전부를 독립 oracle로 검증한 것은 아니다.
- 손상·1MP 초과·2048px 초과·APNG 표식·MIME 모순·5MiB 초과6개 파일을 거절한 뒤에도 기존 A 미리보기640,000채널이 완전 일치하며 PNG 파일 바이트도 같다. 실패 메시지는 invalid-files.json (`output/product-photo-logo-qa-20261014/invalid-files.json`), 위치 프리셋은 presets.json (`output/product-photo-logo-qa-20261014/presets.json`)에 보존했다.
- 독립 픽셀 oracle (`output/product-photo-logo-qa-20261014/independent-pixel-oracle.json`)은 앱 함수·Canvas 없이 원본 PNG를 디코드해 source-over와 밝기+51, transpose/crop를 계산했다.400px A/B와 최종300×240 결과는 로고 축소 보간 경계4,924픽셀씩을 제외한 부분에서 alpha 불일치0, 로고 혼합 RGB 차이 최대1, 비로고 영역 RGB 완전 일치였다. 제외 범위는 예상 이미지를 렌더링하지 않고 원본 로고의 주변 샘플이 색/alpha 경계를 지나는지로 정했다.
- 4MP 사진+1MP 로고(위치250,300·너비1000·불투명도100%)와 사진 밝기20을 합성했다. **전체4,000,000픽셀 alpha가 정확**하고 불투명 로고579,600픽셀은 원본 로고와 RGBA 완전 일치해 사진 밝기 보정이 로고에 적용되지 않았다. 비로고 불투명3,135,800픽셀은 밝기+51과 완전 일치, 부분 로고126,000픽셀 RGB 최대1, 부분 원본118,600픽셀 최대2, 완전 투명40,000픽셀 RGBA0이 확인됐다. 부분투명 RGB는 네이티브 premultiply/unpremultiply 허용 오차2 안이며 완전 동일하다고 표현하지 않는다.
- 300×240 최종 preview↔Storage 저장본↔저장 후 재열기에서 각288,000채널 불일치0이다. PNG 압축 바이트는 다를 수 있다.4MP 결과의1280px preview↔업로드 결과 재열기에서6,553,600채널 불일치0이고 파일 바이트도 같다.
- 4MP 결과를 새 원본으로 연 뒤 후보 B를 읽는 중8배 CPU 지연과 DOM observer로 실제 로고 제거 버튼을 눌렀다. replace-cancel.json (`output/product-photo-logo-qa-20261014/replace-cancel.json`)의 `loadingSeen/removeClicked`가 true이며 늦은 후보는 재등장하지 않았다. 제거 후 preview는 재열기 원본과6,553,600채널/파일 바이트가 동일하고 취소 후 readback (`output/product-photo-logo-qa-20261014/after-confirmed-cancel.json`)은 직전4MP readback 전체와 같다.
- 적용 후 상품 저장 전에는 두 상품의 전체 행과 공유 보관함 행이 그대로였다. 실제 저장은 대상 상품의 `image_path/updated_at`만 변경했다. 공유 상품·보관함 원본 행과 파일 SHA `30cbe5cb3ac1b21d03a65d536f89cb61427d3d4b55ef1e34ee5e354dee9da63c`는 보존됐다.4MP 결과는 업로드/재열기까지만 확인하고 상품에는 저장하지 않았다.
- 정리 결과 (`output/product-photo-logo-qa-20261014/cleanup-result.json`)에서 합성 상품2개·IP1개와 신규claim/Storage 객체3개를 제거했고 잔여0이다. 원본 보관함 전체 행·바이트를 다시 대조했으며 폼 초안, CPU/viewport override와 QA 브라우저 탭을 정리했다.

처리 시간·지속 프레임률·브라우저 전체 메모리는 이번 단계에서 계측하지 않았다. source4MP+active1MP+candidate1MP의 소유권 상한과 단일 후보·해제 횟수는 단위 테스트 근거다. Safari·저메모리 기기·실제 decoder 실패·계정 교체·로고와 텍스트/모자이크/도형의 동시 조합·폰트 실패를 이번 실제 QA에서 다시 모두 실행하지 않았으며 기존 세션 회귀와 이번 호출 순서 검증을 유지한다.

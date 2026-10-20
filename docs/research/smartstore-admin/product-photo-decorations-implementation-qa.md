# 상품 사진 장식 구현 QA

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-15. 자체 기하 장식 13종의 소스 구현·집중 검증과 **실제 PC/390px 조작, native 4MP 합성 1건의 정상 저장·재열기·최종 출력 시각 검수**를 완료했다. 결과는 `PASS_WITH_EXPLICIT_BROWSER_LIMITS`다. 13종 각각의 native 저장이나 모든 실패 분기를 실행한 결과는 아니다.

승인된 최소 계약 (`output/product-photo-decorations-design-20261015/contract.md`)을 바탕으로, 원본 액자 (`output/smartstore-reference-20261012/product-photo-tool-photoFrame.jpg`)·텍스트/말풍선 (`output/smartstore-reference-20261012/product-photo-tool-text.jpg`)·서명 (`output/smartstore-reference-20261012/product-photo-tool-signature.jpg`)·스티커 (`output/smartstore-reference-20261012/product-photo-tool-sticker.jpg`)의 도구 구분과 선택 구조를 참고했다. 디자인은 저장소에서 작성한 숫자 기하이며 원본 이미지·자산·서체를 복제하지 않았다. 원본과 같은 스타일 수·픽셀·알고리즘을 제공한다는 뜻은 아니다.

## 구현 계약

| 도구 | 자체 스타일 | 상태·한도 |
| --- | --- | --- |
| 액자·도형 | 이중선 액자, 점선 액자 | 기존 단색 테두리와 한 종류를 선택. 기존 두께·색을 공유하며 스타일 선택만으로 두께를 변경하지 않는다. 두께 0이면 꺼지고 3px 미만 이중선은 한 줄로 표시한다. |
| 말풍선 | 둥근 말풍선, 타원 말풍선 | 기존 텍스트 레이어 스타일. 80자·3줄, 실제 글꼴 측정에서 내부 영역에 맞지 않으면 미리보기·완료를 막고 수정 방법을 알린다. |
| 텍스트 서명 | 선 서명, 라벨 서명, 원형 서명 | 말풍선·일반 텍스트와 총 8개 한도 공유. 원형은 2줄. 선택한 레이어의 스타일을 바꿀 때 ID·본문·위치를 보존한다. |
| 스티커 | 화살표, 하트, 별, 반짝임, 체크, 원 표시 | 별도 최대 8개. 선택·이동·비율 고정 크기·90도 회전·색·불투명도·삭제를 제공한다. |

일반 텍스트의 300자·8줄, 한 장 로컬 로고·이미지 서명, 단색 테두리는 기존 기능으로 유지한다. 아트타이포 전용 글꼴, 종이 질감, 자동 얼굴 스티커, 개인 템플릿 저장, 모델 호출·bitmap 자산·새 의존성은 추가하지 않는다.

[순수 장식 모듈](../../../lib/admin/photo-editor-decorations.ts)은 허용 ID·기하·검증·텍스트 영역을 정의한다. [Canvas adapter](../../../lib/admin/photo-editor-decoration-canvas.ts)와 [비활성 SVG 썸네일](../../../components/admin/GoodsPhotoDecorationPreview.tsx)은 같은 숫자 경로를 소비한다. 임의 SVG/XML·외부 href·script·foreignObject를 입력받지 않는다.

## 좌표·합성·수명

합성 순서는 **보정·모자이크 → 로고 → 스티커 목록 → 일반/장식 텍스트 목록 → 사진 회전·반전·수평·crop → 액자 → 외곽 마스크 한 번 → 미리보기만 축소**다. 스티커와 장식 텍스트는 EXIF 방향을 반영한 원본 좌표이며 사진과 함께 변환된다. 액자는 최종 crop 좌표다.

새 이중선의 다각형·별 윤곽은 같은 중심에서 원래 꼭짓점을 비례 축소한 두 윤곽으로 그린다. 기존 단색 다각형 테두리의 균일 거리·round join 경로는 바꾸지 않았다. 모든 스타일은 기존 외곽 마스크 한 번으로 정리한다. 각 장식마다 대형 bitmap이나 새 4MP 캔버스를 만들지 않는다.

Pretendard 400의 실제 글꼴 로딩 후 각 줄의 폭과 ink bounds를 측정한다. 줄 높이는 글자 크기의 1.3배이며 문구를 자동 축소·삭제하지 않는다. 장식 문구를 초과 붙여넣거나 스타일을 더 좁은 제한으로 바꿀 때는 마지막 유효 문구를 보존하고 알려준다. 빈 문구는 장식 배경까지 숨긴다. 스티커 불투명도 0·비활성 액자만 있는 recipe는 기존 무변경 완료를 유지한다.

새 도구는 기존 단일 렌더 큐와 취소 신호를 따른다. 레이어 사이에 취소를 확인하고 필요한 경우 이벤트 루프에 제어를 돌려준다. 드래그 중에는 시작한 선택을 고정하며 pointercancel은 시작 recipe로 돌아간다. 삭제 후 다시 활성화된 추가 버튼으로 포커스를 돌리고, 이미 닫힌 대화상자에는 포커스를 보내지 않는다. 재설정·원본 비교·취소·원본 교체의 기존 수명 경계를 유지한다.

## 실행한 검증과 한계

집중 검증은 기존 사진 도구 전체 회귀와 CSS 소유권 검사를 포함한다. 검증 명령·정확한 파일 SHA·실제 브라우저 확인 순서는 QA 준비 자료 (`output/product-photo-decorations-qa-20261015/plan.json`)에 기록한다.

- 허용 ID·숫자·색·한도·ID 중복, legacy recipe·0%·빈 문구·꺼진 액자 무변경, tiny/세로/가로 사진과 source↔rotation 좌표.
- 독립 SVG 래스터 결과의 스티커 내부/외부, 반투명 alpha, 말풍선 꼬리 연결, 이중선 간격과 점선 공백. Canvas adapter의 동일 경로 소비와 일반 텍스트 baseline 보존.
- 실제 글꼴 측정 seam의 한글·줄바꿈·넓은 ink bounds·overflow 거부, 오류 뒤 같은 세션 복구, 장식 합성 후 crop/회전과 최종 mask 한 번.
- 4MP 크기 조건의 레이어 사이 취소·큐 복구·늦은 인코딩 차단. 이는 제어 흐름 검사이며 실제 브라우저 성능 수치가 아니다.
- 스타일 교체 시 레이어 identity·본문·위치 보존, 스티커별 조절·선택·8개 한도, 화면 방향 키 이동·드래그 취소·비교·재설정·삭제 포커스.

후속 실제 브라우저 보고 (`output/product-photo-decorations-browser-qa-20261015/README.md`)와 상세 결과 (`output/product-photo-decorations-browser-qa-20261015/browser-result.json`)는 실행 당시 source350을 기준으로 한다. 고정 소스 21개·캡처·직접 시각 검수 파일의 SHA는 근거 manifest (`output/product-photo-decorations-browser-qa-20261015/browser-evidence-manifest.json`)에 결속했다. 기존 집중 검증과 이번 브라우저 실행은 구분하며 과거 도구의 시간·저장 결과를 재사용하지 않았다.

- 13종은 1280×1280 실제 UI 미리보기로 확인했고 ROOT가 contact sheet를 직접 검수했다. 최대 레이어·복합 편집 2개를 포함한 캡처는 15개이며, 13종 개별 native 저장 검증으로 세지 않는다.
- 2000×2000 사진에 1000×1000 로고·스티커 8개·텍스트 8개와 보정/모자이크·액자·마스크를 합성한 **1건**을 정상 업로드·상품 저장·새로고침·편집 재열기까지 확인했다. native 후보 (`output/product-photo-decorations-browser-qa-20261015/final-candidate-2000.png`)와 정상 저장 파일 (`output/product-photo-decorations-browser-qa-20261015/final-stored-2000.png`)을 ROOT가 각각 직접 검수했다. 두 PNG의 파일 SHA는 다르지만 픽셀 대조 (`output/product-photo-decorations-browser-qa-20261015/candidate-stored-pixel-comparison.json`)에서 RGBA 16,000,000바이트 전체가 같았다.
- PC 1440×1000·모바일 390×844의 도구 접근·포커스 복귀와 모바일 가로 넘침 0을 확인했다. 정상 대화상자 취소와 실제 Storage 업로드가 HTTP 200으로 끝난 뒤 늦은 응답을 버리고 기존 이미지 경로를 유지하는 동작을 확인했다. 기록된 page error는 0개다.
- 4MP 최대 레이어 조합의 단회 warm-cache 입력→미리보기는 105ms, 최종 렌더→편집기 닫힘은 132ms였다. 후자는 업로드·네트워크·상품 저장 전체 시간을 포함하지 않는다. JS heap은 173,452,077→189,599,026바이트였고 native/GPU 메모리는 측정하지 않았다. cold-start나 다른 기기의 성능 보장은 아니다.

폰트 네트워크 실패/8초 timeout, 인코딩 크기 초과·실패 주입, 모든 기존 마스크/필터 조합, pointercancel과 렌더/인코딩 중간 취소의 독립 강제는 이번 실제 브라우저에서 실행하지 않았다. multipart 관측 도구 실패와 전용 브라우저 종료, 만료된 upload claim 1건의 진단도 보존했으며 앱 회귀나 만료 원인으로 단정하지 않는다.

사진 fixture 은퇴 (`output/shared-scoped-fixtures-20261015/photo-retirement.json`)는 PASS다. 공유 원본과 정규화 bitmap 6개의 바이트·Storage 행 SHA, upload claim 7개의 조회 결과를 유지했다. 다만 원 보존 실패 기록 (`output/shared-scoped-fixtures-20261015/photo-post-ui-preservation-diagnostic.json`)과 관측된 Auth 변화 (`output/shared-scoped-fixtures-20261015/photo-observed-external-auth-delta.json`)를 유지한다. 비소유 계정 1개에 연결된 Auth 4개 테이블의 기존 3행 변경·refresh 1행/감사 2행 추가를 PHOTO에만 명시하고, 그 밖의 330테이블·ledger·migration source 일치를 확인한 결과다. **모든 기존 Auth 행의 완전 일치가 아니며**, 변화의 브라우저/프로세스 출처는 미확인이다. PHOTO 직전 baseline은 테이블 집계이고 개별 before 행의 근거는 더 이른 EXPORT baseline이다.

사진 보고 작성 당시 후속 CS 검수를 위해 유지했던 공유 실행 환경도 이후 정리 영수증 (`output/shared-local-browser-qa-20261015/runtime-cleanup.json`)에서 PASS를 확인했다. 검토 포트 종료와 소유 runtime·fixture 디렉터리·자격 파일 제거를 확인한 범위이며 운영 배포·라이브 결제·원본 전체 전수 완료를 뜻하지 않는다.

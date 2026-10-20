# 스토어 대표 이미지·고객센터 안내 대조

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14 로그인된 기본정보 관리 화면과 공식 도움말을 다시 읽었다. 네이버의 저장·이미지 등록·인증 요청은 실행하지 않았다.

## 고객센터 노출위치 — 조사 정정과 안내 구현

원본의 `노출위치` 버튼은 위치를 고르는 설정이 아니다. `고객센터 전화번호 노출 영역` 안내창을 열어 스토어 프로필/판매자 정보와 구매자의 결제내역에서 연락처가 보인다고 설명한다. 위치 선택·저장 컨트롤은 없다. 앞선 대조표의 ‘고객센터 노출위치 미구현’은 이 안내와 실제 연락처 표시를 나누지 않은 표현이었다.

- 원본 안내문 (`output/store-profile-reference-20261014/customer-contact-help.txt`), 원본 안내창 (`output/store-profile-reference-20261014/customer-contact-help.png`).
- ICONS의 기존 `SiteFooter`는 저장된 전화·이메일을 표시하며 주문 상세에서도 같은 푸터를 사용한다. `getBusinessInfo()`가 공개 사업자 정보와 법정 문서의 연락처를 제공한다. 이번 변경은 연락처 값을 수정하지 않았다.
- 사업자·CS 연락처의 전화 입력 옆에 `고객센터 노출위치` 안내를 추가했다. 저장한 값과 미저장 입력, 빈 항목의 차이를 설명한다. 공개 연락처를 임의로 숨기는 새 설정은 추가하지 않는다.
- 실제 Chrome에서 안내 열기·확인/닫기·Escape와 원래 버튼으로의 포커스 복귀를 확인했다. 390px에서 문서 390/390, 대화상자 368/368로 가로 넘침이 없고 문단 간격은 24px다. 모바일 (`output/store-profile-reference-20261014/local-contact-help-mobile-final.png`), PC (`output/store-profile-reference-20261014/local-contact-help-desktop-final.png`).
- 관련 화면·푸터·연락처 단위 테스트 34개와 변경 파일 ESLint를 통과했다. DB·연락처 저장·운영 반영은 실행하지 않았다.

## 정사각형 스토어 대표 이미지 — 구현 및 검증

원본은 헤더 로고와 별도의 프로필 이미지를 받는다. 현재 화면은 정사각형 최소 160×160, 가로 1300px 이상 권장, 최대 20MB, JPG/JPEG/GIF/PNG를 안내한다. [공식 기본정보 안내](https://help.sell.smartstore.naver.com/faq/content.help?faqId=4510)와 [대표 이미지 변경 안내](https://help.sell.smartstore.naver.com/faq/content.help?faqId=3718)는 프로필·네이버 쇼핑 노출과 저장 후 플랫폼 검수를 설명한다. 파일을 올리거나 검수를 요청하지 않았다.

ICONS는 `스토어 대표 이미지`를 PC/모바일 로고와 별도 항목으로 저장한다. 최소 160×160px 정사각형이며 1300×1300px를 권장한다. 공개 푸터의 소개 영역에 80×80px로 표시한다. 헤더 로고, 법정 사업자 정보와 OG 이미지는 바뀌지 않는다. 네이버 검색 노출과 네이버의 검수 절차는 이식 대상이 아니다.

- **원본과의 차이:** ICONS의 기존 검증 업로드 계약을 사용하므로 최대 5MB의 JPEG/PNG/WebP만 받으며 GIF·애니메이션은 지원하지 않는다. 가로·세로 최대 8192px, 총 4천만 픽셀 이하이며 EXIF 방향을 적용하고 재인코딩한 결과의 실제 크기를 서버가 기록한다. 업로드 안내에 해당 조건을 명시한다.
- **저장 경계:** 새 대표 이미지에는 현재 관리자의 미사용 검증 업로드와 정사각형·최소 크기가 필요하다. 크기 정보가 없는 예전 이미지나 이미 로고에 연결된 경로는 다시 업로드해야 한다. 현재 저장된 대표 이미지는 유지할 수 있다. 삭제한 이미지를 다시 선택하려면 새로 업로드한다. 동일한 새 이미지를 로고와 대표 이미지에 함께 쓰면 업로드 건은 한 번만 연결한다.
- **호환·재시도:** `branding.profileImagePath`를 모르는 이전 7필드 요청은 기존 대표 이미지를 보존한다. 새 감사 영수증은 요청과 실제 저장 결과를 따로 기록하며 요청·편집 시각이 같은 재시도만 재생한다. 이전 영수증도 조회할 수 있다. 이전 공개 5필드 RPC는 유지하고 v2 공개 응답에 대표 이미지 경로만 추가했다. 저장 후 공개 캐시를 갱신한다.
- **검증:** OWN·FRESH·59922 로컬 DB에서 최종 migration SHA `b2e81b437712d85ef198382c87a628f647e42de61ffa0051166913b39a40bfdd`와 migration ledger 원문이 일치한다. 새 profile·기존 branding·operator coverage SQL을 통과했다. service_role의 새 5인자 검증 → 기존 3인자 검증 호출과 anon/authenticated의 v2 → v1 호출을 실제 권한으로 확인했다. 관련 단위 테스트 36개, 전체 TypeScript와 변경 파일 ESLint를 통과했다. DB security advisors 경고는 없고 기존 범위 밖 lint 73함수/124건 중 이번 함수의 문제는 없다.
- **실제 API 경로:** 정상 관리자 로그인 → 인증된 Storage 업로드 → 실제 Sharp 정규화 → 공개 파일 바이트와 DB 크기 readback을 확인했다. 159px 정사각형·160×161 직사각형 저장 거부, 160px·1300px 정사각형 저장, 재시도, 이전 입력 보존, 삭제·재등록 경계를 검증했다. 실제 Server Action HTTP 저장 후 공개 캐시 갱신과 푸터 80×80 HTML까지 확인했다. API 증거 (`output/smartstore-reference-20261014/store-profile-image/api-readback.json`), Server Action·캐시 증거 (`output/smartstore-reference-20261014/store-profile-image/action-readback.json`).
- **실제 폼 후속 검증(2026-10-14):** 별도 주매니저 호스트의 Chrome에서 파일 선택과 업로드, 159px 정사각형·160×161px 직사각형 저장 거부, 잘못된 PNG의 업로드 실패와 선택 취소, 정상 320px 정사각형 저장을 확인했다. 공개 PC/390px에서 같은 파일을 80×80px로 표시했다. 저장 전 이미지 제거는 새로고침으로 폐기되고, 제거를 저장하면 공개 이미지가 사라졌다. 관리자 폼과 공개 화면의 390px 문서 폭/스크롤 폭은 380/380이었다. 실제 UI 증거 (`output/store-profile-file-ui-qa-20261014/manifest.json`).
- **복원·정리:** 시작 전 branding·수정시각과 기존 세 이미지 바이트를 보존했다. 기존 대표 이미지는 이미 연결된 경로여서 교체 후 같은 경로를 다시 연결할 수 없다. 승인된 격리 QA 범위에서 기존 1,300px 이미지 바이트를 재업로드하고 정상 CAS 저장으로 콘텐츠를 복원했다. 복원 파일 6,844바이트의 SHA-256은 기존과 완전히 같고 다른 branding·설정은 그대로다. 경로는 새로 생겼으며 수정시각은 증가했고 교체·삭제·복원 감사 3건을 보존했다. 기존 원본과 현재 복원 자산은 유지하고 본인 검수용 중간 자산 3개만 제거했다. 복원 readback (`output/store-profile-file-ui-qa-20261014/restoration-readback.json`), 정리 결과 (`output/store-profile-file-ui-qa-20261014/storage-cleanup.json`). 실제 폼 검증의 이전 차단은 해소됐으며 운영·Preview에는 적용하지 않았다.

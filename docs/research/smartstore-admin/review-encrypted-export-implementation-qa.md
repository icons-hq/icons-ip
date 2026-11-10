# 일반 리뷰 암호화 XLSX 검증

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-15. 일반 리뷰의 현재 적용 조건 전체를 최대10,000행·16열 암호화 XLSX로 내보내는 기능을 구현했다. DRAFT/정식 적용 transaction의 실제 OWN·CANON 복제 검증과 로컬 named3개 적용이 통과했다. 이후 실제 HTTP 다운로드5개·PC/390px·독립 파일/감사 대조와 정상 fixture 은퇴까지 완료했다. 아래 명시한 브라우저 미실행 범위와 운영 배포는 완료에 포함하지 않는다.

## 범위와 확정 순서

12개 조회 조건을 엄격히 정규화하며 페이지·목록수·선택 행·상세 패널은 다운로드 범위를 제한하지 않는다. 후기 ID 단독 필터와 도움수 정렬을 보존한다. 전체 본문, 리뷰/상품 ID·상품명·작성자 표시명, 평점·사진/도움/신고 수, 공개/BEST/답글 상태와 시각을 16개 열로 내보낸다. 연락처·주문/회원 ID·이미지 URL·답글 본문·숨김 사유는 포함하지 않는다. 0행은 헤더가 있는 정상 파일이고 10,001행은 잘라내지 않고 거절한다.

caller의 실제 사용자·세션과 `cs.manage`를 확인한 뒤 동일 snapshot을 읽는다. 메모리에서 XLSX를 만들고 ECMA-376 Agile로 암호화한 다음 평문 buffer를 지운다. 파일 응답 직전에 실제 사용자/세션·정지/탈퇴 fence·현재 권한을 다시 잠그고 같은 조건을 다시 집계한다. 지문·건수가 바뀌면 409로 거절한다. 성공 감사에는 암호문 SHA·snapshot 지문·건수·검색어 존재/길이만 남기며 비밀번호와 원문 검색어를 저장하지 않는다.

POST만 허용하고 모든 응답은 private/no-store다. UI는 비밀번호 두 번 확인, 중복 클릭 방지, 취소·필터·계정·세션·sign-out·unmount 시 입력과 늦은 응답 무효화를 적용한다. 자동 재시도는 하지 않는다.

## 검증 결과

- 앱 관련11파일 132테스트·타입 검사·집중 린트 통과. 기능 검증 (`output/review-export-implementation-20261015/final-summary.json`)은 실제 OWN/CANON 각각110 SQL assertions·경합11개를 포함한다.
- 0/1/100/101/10,000행을 실제 SQL로 확인했다. 103행과10,000행 snapshot을 production DTO→ExcelJS→실제 암호화 파일→독립 `msoffcrypto-tool 6.0.0` 복호화·`openpyxl` 재조회까지 연결했다. 16열의 순서/ID/본문/도움수, 수식 없음, 잘못된 비밀번호·변조 거절과 실제 암호문 SHA 감사 readback을 확인했다. 10,001행의 읽기와 최종 감사 모두 거절하며 감사가 추가되지 않았다.
- 10,000행 단회 SQL은 CANON 약1,497ms·OWN 약1,363ms, 파일은667,136bytes였다. 약594~596MiB peak RSS는 ExcelJS 재조회와 두 번째 암호화를 포함한 Vitest 프로세스 값이다. 실제 HTTP 메모리·전체 다운로드 지연으로 사용하지 않는다.
- 정식 [347 migration](../../../supabase/migrations/20261020085417_admin_review_encrypted_export.sql)은 검증 DRAFT와 첫 주석 외 본문이 같다. 새 함수3개만 만들며 실제 대상 reader owner를 따르고 기본 ACL을 봉인한다. 기존 helper의 owner/ACL은 변경하지 않는다.
- exact transaction 복제 검증 (`output/review-export-named-qa-20261015/runner-clones-6c4f3239208d4e159dc8dc933a3a80f0/result.json`)은 각11개 의도적 변조 거절, [상설 SQL](../../../supabase/tests/admin_review_export.sql) 각128 assertions, 전체 rollback·원본/기존 행·전체 ledger·registry·owner/ACL/RLS 보존과 소유 복제 DB/임시 파일 정리를 통과했다.
- 로컬 named readback (`output/review-export-named-qa-20261015/plan-fc55501b820f43efb343288557778a8c/named-summary.json`)은 적용 직후 OWN279·FRESH312·CANON347에서 모두 PASS다. 이후 다른 migration의 적용 결과와 구분한다. 현재 기능별 상태 (`output/review-export-named-qa-20261015/final-status-347.json`)에 연결했다.

초기 fixture에서는 KC 재심사가 필요한 상품명 변경, UUID 이미지 경로, BEST 상태의 정상 쓰기 경로, 리뷰 본문1,000자 제한을 바로잡았다. 실제 OWN의 신규 public 함수에 따라붙은 별도 postgres 기본 EXECUTE 권한은 신규 함수에만 명시적으로 revoke해 정확한 owner+필요 역할 ACL을 맞췄다. 실패 실행과 정리/원본 보존 결과는 기존 출력에 남겼다.

## 실제 브라우저 후속

실제 결과 (`output/review-export-browser-qa-20261015/browser-result.json`)와 증거 manifest (`output/review-export-browser-qa-20261015/browser-evidence-manifest.json`)는 `PASS_WITH_EXPLICIT_BROWSER_EXCLUSIONS`다. 실제 쿠키 세션·POST에서 목록2페이지의 선택1행과 무관한 전체24행, 연결 실패 후 재시도24행, 모바일0행, 단건1행, 도움수 변경 후24행의 파일5개를 내려받았다. 모두 HTTP200·private/no-store·ECMA-376 Agile이며 독립 암호/HMAC·16열 모든 값/순서·DB 지문·암호문 SHA 감사가 일치했다.

연속 Enter2회는 POST·파일·감사 각1건이었다. 비밀번호 불일치의 전송0·입력 삭제, 연결 실패의 자동 재시도0·명시 재입력, Escape 초점 복귀·취소 시 입력 삭제·URL/웹 저장소의 비밀번호 부재와390px를 확인했다. Native dialog의 Tab은 브라우저 chrome을 거칠 수 있어 페이지 내부의 엄격한 focus trap 통과로 표현하지 않는다. 초기 스크롤 전환 캡처와 자동화 복구 이력은 원본 보고서에 보존했다.

정상 은퇴 (`output/review-export-browser-qa-20261015/retirement-result.json`)에서 계정3개·세션·자격 증명을 종료하고 상품2개/IP를 비공개 처리했다. 리뷰24개·도움수 투표2개·취소된 FK 주문24개는 보존했고 금융·리뷰·투표 삭제는0이다. 기존334개 테이블·Auth·원장·전역 값·앱/build/migration 소스 보존을 확인했다. 해당 시점에는 공유 runtime을 유지했고, 이후 전체 scope 종료 후 공유 runtime 정리 (`output/shared-local-browser-qa-20261015/runtime-cleanup.json`)도 완료했다.

원래 브라우저 계획 (`output/review-export-implementation-20261015/browser-plan.json`)의 늦은 응답 폐기, method/filter/origin 오류, 비인가 발급, snapshot 충돌409와 사진/BEST 행은 이번 실제 브라우저에서 실행하지 않았다. 기존 자동 검증으로 이 실행 한계를 대체하지 않는다. 이 파일5개의 사용자 Excel 직접 열기와 운영 배포도 수행하지 않았다.

# 판매 목록·거래확정 엑셀 암호화

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14. 목록 7종과 거래확정 파일에 비밀번호를 설정하는 기능을 구현했다. 격리 DB·실제 HTTP와 실제 Chrome 다운로드 3개를 검증했으며, 파일의 독립 복호화·무결성과 감사 해시가 일치했다. 같은 다운로드 파일 3개를 Mac Excel에서 정상 암호로 여는 검증도 마쳤다. 운영 배포는 하지 않았다.

적용 범위는 [판매 대조표](sales-parity.md)의 주문통합검색·미결제·발주발송·배송현황·취소·반품·교환 목록 및 거래확정이다. 정산·통계·고객·리뷰 이벤트 파일과 창고 연동 XLSX/CSV는 기존 계약을 유지한다.

## 원본에서 확인한 것

로그인된 [주문통합검색](https://sell.smartstore.naver.com/#/naverpay/manage/order)의 `엑셀다운` → `주문정보 다운받기`를 읽었다. 원본에는 비밀번호를 입력하거나 최종 다운로드를 실행하지 않았다.

- 비밀번호와 재확인 입력이 있고, 최초에는 재확인·다운로드가 비활성이다.
- 표시 정책은 공백 불가, 대문자를 포함하지 않는 4~16자리 문자열이다. 동일 문자 반복·개인정보·쉽게 연상하는 단어를 피하도록 안내한다.
- 업무 목적 사용과 목적 달성 후 파기, 법령상 보관 시 분리 보관, Excel 2007 이하의 호환성 제한을 안내한다.
- 원본의 실제 문자 검증, 암호 저장 여부, 결과 파일의 암호 방식·호환성은 미확인이다. UI 문구로 내부 구현을 단정하지 않는다.

근거는 `output/smartstore-reference-20261014/encrypted-xlsx/source-password-modal.json`·`source-password-modal.png`다. 이전 전체 모달은 `output/smartstore-reference-20261012/sales/01-order-excel.jpg`다. 원본 발송 파일 반입은 비암호화 파일을 요구하므로 창고·운송장 연동에 이번 방식을 확대하지 않는다.

## 채택한 앱 계약

1. **ICONS는 공백 없는 인쇄 ASCII 12~64자, 영문 대문자·소문자·숫자·기호를 허용한다.** 원본의 4~16자·대문자 금지와 다른 제품 정책이며 UI와 서버가 같은 검증 함수를 쓴다. 입력을 trim하거나 대소문자를 바꾸지 않는다.
2. 비밀번호와 재확인은 이름이 있는 비제어 입력에만 두고, 제출 시 FormData를 읽은 직후 입력을 비운다. 닫으면 모달을 해제한다. 실패 후 다시 입력해야 하며, URL·검색 필터·hidden 링크·local/session storage·자동저장·분석 이벤트·오류·로그·DB·감사·워크북 메타데이터에는 넣지 않는다. 브라우저 암호 자동 저장을 요청하지 않는다. JS 메모리의 물리적 영구 소거는 보장하지 않는다.
3. 파일은 같은 origin의 JSON `POST`로만 응답한다. 본문은 4,096바이트까지 스트림으로 읽으며, `password`와 `passwordConfirmation` 외의 키는 거부한다. URL의 알 수 없는 키·중복 키도 거부한다. 현재 권한과 기존 정규화 필터·행 상한 확인 → 기존 ExcelJS 생성 → Office 암호화 → 암호화 파일 SHA-256 → 서버 전용 감사 성공 → 파일 응답 순서다. 암호화·감사 실패는 평문으로 대체하지 않는다.
4. 목록 `GET`은 405와 사용 안내만 응답한다. 거래확정의 기존 `?id=` 링크는 현재 권한 확인 후 `/admin/sales/settled?exportReceipt=…`로 303 이동한다. 이 화면에서 같은 보존 기록의 다운로드 버튼을 눌러 새 비밀번호를 입력한다. 어느 GET에서도 파일 바이트를 주지 않는다.
5. 목록 재다운로드는 같은 조건의 **최신 자료**를 읽는다. 거래확정은 **기존 생성자의 receipt payload**를 다시 읽고 현재 권한·소유자를 검사한다. 과거 비밀번호나 비밀번호 해시는 저장하지 않는다. 암호 분실 시 새 비밀번호로 다시 받는다. 무작위 salt 때문에 재발급 파일 바이트가 달라도 복호화된 기록 내용은 같다.
6. `.xlsx` 확장자·MIME·파일명과 `private, no-store`·`nosniff`를 유지하고 오류에도 no-store를 적용한다. ExcelJS 버퍼는 파일·객체 스토리지에 저장하지 않으며 암호화 뒤 해당 원본 버퍼를 비운다. 암호화 라이브러리는 `server-only` 모듈에서만 사용한다.

`Request.url`은 Next 개발 서버에서 실제 요청 호스트와 달리 localhost로 정규화되는 것을 실측했다. origin 검사는 **브라우저 요청의 Host와 Request.url의 protocol**로 구성하며 Host가 없는 단위 테스트 요청에서만 URL origin을 사용한다. userinfo·쉼표·공백·경로·query·fragment가 있는 Host는 거부하고 기본 포트·IPv6·HTTPS를 검증했다. `x-forwarded-host`는 신뢰하지 않는다. 운영 프록시는 원래 Host와 외부 protocol을 Route Handler까지 보존해야 한다.

## 라이브러리와 감사 경계

`officecrypto-tool@0.0.19`를 정확히 고정하고 lockfile을 갱신했다. MIT 라이선스와 npm SHA-512 integrity, Git commit `a9c18b89c58b95439d40a531fae6fcc0d5c77e4f`의 공개 API·Agile 구현을 대조했다. ExcelJS를 다시 파싱하지 않고 완성된 ZIP 바이트를 그대로 감싼다. 대안 `xlsx-populate@1.21.0`은 파일을 파싱·재작성하고 배포 이력도 오래되어 채택하지 않았다.

출처: [npm 고정 배포물](https://registry.npmjs.org/officecrypto-tool/0.0.19), [공개 API](https://github.com/zurmokeeper/officecrypto-tool/blob/a9c18b89c58b95439d40a531fae6fcc0d5c77e4f/index.js), [Agile 구현](https://github.com/zurmokeeper/officecrypto-tool/blob/a9c18b89c58b95439d40a531fae6fcc0d5c77e4f/src/crypto/ecma376_agile.js), [xlsx-populate 원본](https://github.com/dtjohnson/xlsx-populate/tree/7480a02575c9140c0e7995623ea192c88c1886d3#encryption), [Microsoft Agile 암호화](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-offcrypto/9e61da63-8ddb-4c0a-b25d-f85d990f44c8), [Microsoft 무결성 생성](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-offcrypto/63d9c262-82b9-4fa3-a06d-d087b93e3b00).

기본 ECMA-376 Agile은 AES-256-CBC·SHA-512·spinCount 100000과 암호학적 난수 key/salt를 사용한다. `type: 'standard'`는 지정하지 않는다. CFB 헤더와 암호화 여부를 다시 확인하고 최종 파일의 SHA-256을 계산한다. 라이브러리 자체의 decrypt는 HMAC을 검증하지 않으므로 왕복 결과만으로 무결성을 승인하지 않았다. 별도 임시 Python 환경의 [msoffcrypto-tool 6.0.0](https://msoffcrypto-tool.readthedocs.io/en/stable/)을 `verify_password=True`, `verify_integrity=True`로 실행했다. Python 도구는 앱 의존성이 아니다.

감사는 기존 RPC·원장을 수정하지 않고 [별도 migration](../../../supabase/migrations/20261020085322_admin_encrypted_export_audit.sql)의 새 RPC 두 개로 남긴다.

| RPC | 호출자와 재검사 | 기록 |
| --- | --- | --- |
| `service_record_encrypted_list_export` | service_role 전용. 서버 guard가 확인한 actor를 전달하고 DB가 현재 sales.read 또는 sales.manage를 잠금 아래 재검사 | 화면·정규화 필터·행수·건수·형식·암호화 방식·파일 SHA-256 |
| `service_record_encrypted_settled_export` | service_role 전용. 현재 sales.manage와 receipt 생성자 재검사 | receipt ID·보존 필터·보존 주문/품목 건수·보존 시각·형식·방식·파일 SHA-256 |

익명·authenticated는 직접 실행할 수 없다. 권한 있는 브라우저가 임의 해시를 제출해 발급 증거를 만들 수 없으며, 서버가 읽은 현재 actor만 전달한다. DB의 `require_actor_operator_capability`는 profile/membership과 계정 잠금을 유지해 권한 회수와 직렬화한다. 비밀번호 관련 인자는 없다. 이벤트는 `admin.list_export.file_issued`와 `admin.settled_export.file_issued`이며 **파일 발급**을 뜻한다. 디스크 저장 성공을 증명하는 이벤트로 쓰지 않는다.

## 검증 결과와 남은 제한

근거 디렉터리: `output/smartstore-reference-20261014/encrypted-xlsx/`.

- 9개 관련 테스트 파일 46개, 테스트 포함 TypeScript, 변경 TypeScript ESLint 통과. GET 평문 차단, cross-origin·누락 Origin·위조 actor·본문 상한·암호 오류·암호화/감사 실패를 포함한다.
- 새 [SQL 회귀](../../../supabase/tests/admin_encrypted_export_audit.sql)·기존 상세검색·운영자 계약 검증을 disposable clone과 OWN/FRESH에서 통과했다. 기존 함수 정의·소유자·ACL fingerprint는 불변이고 새 함수 소유자는 실제 적용 계정 supabase_admin, 실행권한은 service_role만이다. OWN security advisor 경고 없음.
- migration 최종 SHA-256은 `d2ce0ed73ecf6528ef4ca846ffdfb2022e87d1f6d217755b24977e7b0cfe35bd`다. 리뷰된 DRAFT의 첫 주석만 바꿨고 OWN/FRESH ledger의 전체 원문과 일치한다. 적용 후 원문은 수정하지 않았다.
- 새 service RPC의 별도 경합 검증을 disposable clone에서 통과했다. 발급이 먼저 잠금을 잡으면 권한 회수가 기다렸고, 회수가 먼저 잠금을 잡으면 발급이 기다린 뒤 거부됐다. 성공 감사는 정확히 1건이었다. `concurrency-verification.json`에 기록했다.
- 실제 HTTP 10개 요청 경계 검증과 파일 3개 응답을 확인했다. 반품 103건을 105행으로 내보냈으며 파일 SHA-256과 감사 레코드가 일치했다. 잘못된 요청에서는 감사가 추가되지 않았다. 같은 거래확정 receipt를 두 번 발급하면 암호문은 다르고 두 시트 내용은 같았다. `http-integration.json`·`http-files-verification.json`에 기록했다.
- 독립 구현에서 정답 암호·HMAC 검증과 원본 XLSX 바이트 일치, 잘못된 암호 거부, ciphertext 변조 거부, 매회 다른 salt를 확인했다. 암호화 파일은 평문 ZIP으로 열리지 않는다. 실제 HTTP 파일도 별도로 독립 복호화했다.
- 10,000행 × 30열 합성 파일은 평문 1,686,334바이트/암호화 1,702,912바이트였다. Node 24.16.0 단일 실행에서 ExcelJS 생성 872.5ms, 암호화 201.8ms, 전체 프로세스 peak RSS 약 685MiB였다. 이 메모리는 엑셀 작성·직렬화·두 차례 암호화를 포함하며, 암호화 단독 증가량이나 운영 동시 요청 메모리로 해석하지 않는다. 동시 대형 요청과 실제 호스팅 환경의 메모리는 별도 검증 대상이다.
- Chrome은 합성 PRIMARY 로그인, 103건 필터, 암호 모달, 불일치 후 두 입력 초기화, 390px 가로 넘침 0까지 확인했다. `password-mobile.png`를 직접 검토했다. 유효 암호 다운로드 직전에 다른 확장 프로그램 UI가 자동화를 차단했고, 요청이 서버에 도달하지 않았음을 확인했다. 중복 제출하지 않았다. Mac 잠금 때문에 네이티브 Excel 열기도 확인하지 못했다. **HTTP 파일 검증을 실제 Chrome 저장·Excel 호환 검증으로 대체해서 보고하지 않는다.**

최초 production 의존성 감사에서 새 암호화 의존성의 advisory 기여는 0건이었다. 기존 Next·sharp·brace-expansion·source-map-js 항목은 부모 작업의 별도 패치 검증으로 넘겼다. 당시 결과는 `npm-audit-production.json`이며 현재 lockfile 감사 결과로 혼동하지 않는다. 전이 의존성 crypto-js의 유지보수 중단 경고가 있으나 이번 Agile encrypt는 Node crypto를 사용하며 legacy decrypt 경로는 앱에서 사용하지 않는다.

## 실제 Chrome 다운로드 후속 검증 (2026-10-14)

브라우저 도구가 다시 동작한 뒤 같은 합성 PRIMARY 계정과 격리 앱에서 반품 103건/105행 파일 1개, 기존 거래확정 receipt의 2주문 파일 2개를 실제 다운로드 폴더에 저장했다. 두 번째 거래확정 파일은 다른 비밀번호로 재발급했다. 파일 검증 결과 (`output/smartstore-reference-20261014/encrypted-xlsx/browser-files-verification.json`), DB 감사 대조 (`output/smartstore-reference-20261014/encrypted-xlsx/browser-audit-readback.json`), 화면·파일 해시 (`output/smartstore-reference-20261014/encrypted-xlsx/browser-manifest.json`)가 근거다.

- 세 파일 모두 CFB 암호화 형식이며 msoffcrypto의 암호/HMAC 검증을 통과했다. 잘못된 암호는 거부됐고 복호화된 워크북 어디에도 비밀번호가 없다.
- 반품 시트는 머리글을 제외해 105행이다. 거래확정 두 파일은 보존된 품목/주문 2건과 메타데이터가 모두 같고, 기존 HTTP 파일의 모든 압축 해제 항목과도 일치한다. ZIP 포장 시각 때문에 평문 파일 바이트는 달라질 수 있어 기록 내용의 동일성과 구분한다.
- 각 파일 SHA-256은 별도 발급 감사 1건과 정확히 일치했다. 처음 반품 다운로드의 도구 이벤트 대기는 시간 초과였으나 실제 파일·완료 문구를 확인해 중복 요청하지 않았다. 거래확정 클릭 도중의 요소 교체도 파일/감사 미발급을 확인한 뒤 다시 실행했다.
- 비밀번호 창의 390px 표시를 직접 검수했다. 재발급 완료 캡처는 기본 PC 크기로 돌아온 상태이므로 모바일 완료 화면의 근거로 사용하지 않는다. 임시 화면 크기 설정은 해제했다.
- 이 단계의 Excel 열기는 Mac 잠금으로 미확인이었으며, 아래 네이티브 검증에서 별도로 확인했다.

## Mac Excel 후속 검증 (2026-10-14)

사용자가 잠금 해제를 알린 뒤 **Microsoft Excel for Mac 16.113.3 (16.113.26092714)**에서 위 실제 다운로드 파일 3개를 열었다. 반품 파일의 잘못된 암호는 거부됐고, 정상 암호와 재발급 파일의 서로 다른 암호로 각각 열렸다. 통합 문서 복구·손상 안내는 나타나지 않았다. 네이티브 검증과 파일·캡처 해시 (`output/smartstore-reference-20261014/encrypted-xlsx/native-excel-verification.json`).

반품 관리 시트의 사용 범위는 `A1:AA106`이며 데이터105행과 마지막 요청번호 `C00508`을 직접 확인했다. `내려받기 정보`는 `A1:B12`이고103건·엑셀105행이 표시됐다. 거래확정의 `거래확정 품목`은 `A1:U9`, `주문 대조`는 `A1:R9`이며2주문·수량2·합계2,000원이 보였다. 원래 XML의 빈5행 때문에 실제 행 인덱스9와 비어 있지 않은8행은 구분한다.

세 통합 문서를 저장하지 않고 닫은 뒤 다운로드 원본과 보관 사본의 SHA-256이 모두 기존 감사 해시와 같은지 확인했다. 이 결과는 해당 합성 파일3개와 Mac Excel 버전에 한정하며 Windows·모바일 Excel이나 모든 내보내기 양식의 네이티브 검증으로 확대하지 않는다.

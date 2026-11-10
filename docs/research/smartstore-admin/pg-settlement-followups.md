# PG 정산 후속 범위와 미확정 계약

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

확인일: 2026-10-13. 구현한 정산 수집·대조의 상태는 [PG 정산 문서](pg-settlement-parity.md)를 따른다. 이 문서는 그 밖의 부가세 자료, 수취 세금계산서, 우대수수료 환급, 지급보류·조정에 필요한 원본과 계약을 정리한다. 기존 네이버 읽기 증거와 공급자의 공개 문서를 확인했으며, 실제 PG 거래·정산 조회와 운영 설정 변경은 실행하지 않았다.

## 네이버 원본에서 확인한 범위

2026-10-12 로그인 화면에서 확보한 캡처 manifest (`output/smartstore-reference-20261012/sales/manifest.json`)의 채택 자료를 사용했다. 아래 제어 목록·도움말 12개 파일은 이번 조사에서도 SHA-256을 다시 대조했다. 화면에 보이는 고객·사업자 식별자나 금액을 ICONS 시험 데이터로 복사하지 않는다.

| 대상 | 직접 확인한 입력·조회 구조 | 확인하지 않은 결과 |
| --- | --- | --- |
| 부가세신고 내역 | 분기·반기, 과세·면세, 카드 매출전표·현금영수증·기타 분류, 월·일·건별 다운로드 진입점. 원본 도움말은 구매확정에 따른 세금신고기준일과 실제 정산지급일을 구분한다. 제어 목록 (`output/smartstore-reference-20261012/sales/12-vat-controls.json`), 기준일 안내 (`output/smartstore-reference-20261012/sales/details/vat-verified-02.txt`), 조회결과 안내 (`output/smartstore-reference-20261012/sales/details/vat-result-tooltip.txt`) | 실제 다운로드 파일의 열·부호·합계와 신고 연계. 기존 교육 도움말에는 과거 제도·시행일 예시가 있어, 이를 현재 ICONS의 세무 판정 규칙으로 옮기지 않는다. |
| 수취 세금계산서 | 발행·발행예정 탭, 작성일자·공급자·품목·공급가액·세액·신고상태, 원문 열기와 인쇄. 원문에는 공급자·공급받는자, 작성일·수정사유, 품목과 합계가 있다. 발행 목록 (`output/smartstore-reference-20261012/sales/13-tax-invoice-controls.json`), 예정 목록 (`output/smartstore-reference-20261012/sales/13b-tax-expected-controls.json`), 원문 항목 (`output/smartstore-reference-20261012/sales/13-tax-invoice-document-controls.json`) | 실제 발행·신고·인쇄 결과. 원본의 미신고·접수완료·신고완료·신고실패를 다른 PG의 상태값으로 간주하지 않는다. |
| 우대수수료 환급 | 원결제일·정산기준일·정산예정일 검색, 거래금액·기준금액·환급액, 원결제·취소·정산 날짜, 사업자 등급, 반기별 대상 조회 입력창. 목록 (`output/smartstore-reference-20261012/sales/17-preferential-refund-controls.json`), 대상 조회 (`output/smartstore-reference-20261012/sales/17-refund-eligibility-controls.json`) | 사업자번호를 입력한 대상 판정, 실제 환급 파일·지급 결과. |
| 지급보류·조정 | 일별 공제·환급의 사유·상세·금액·세금계산서 여부, 지급보류의 신청·완료·취소·해제대기·해제완료·잔액과 보류번호별 이력. 공제·환급 목록 (`output/smartstore-reference-20261012/sales/11c-deduction-refund-controls.json`), 지급보류 목록 (`output/smartstore-reference-20261012/sales/11d-hold-settlement-controls.json`) | 보류 설정·해제 제출과 실제 자금 처리. ICONS 클레임의 `on_hold`를 PG 지급보류로 대응하지 않는다. |

## 토스페이먼츠의 공개 제공 범위

- **결제 매출의 세액과 정산 수수료의 세액은 다른 값이다.** `Settlement.supplyAmount`·`Settlement.vat`는 결제 수수료의 공급가액·부가세다. 상품 결제의 공급가액·세액·면세 등은 `Payment.suppliedAmount`·`vat`·`taxFreeAmount`·`taxExemptionAmount`에 설명되어 있다. 현재 정산 스냅샷은 앞의 수수료 필드만 보관하므로 매출 부가세 신고 원장을 대신하지 않는다. [코어 API 객체 정의](https://docs.tosspayments.com/reference#settlement-객체), [세금 처리 가이드](https://docs.tosspayments.com/guides/v2/learn/tax), [현재 수집 필드](../../../lib/settlements/types.ts)
- **부가세 자료를 보는 공급자 화면이 있다.** 개발자센터가 현재 연결하는 상점관리자 가이드의 87쪽은 매출·매입 탭과 엑셀 다운로드를 안내한다. 파일명은 `230810` 버전이므로 현재 ICONS 계정의 화면·권한·내보내기 스키마 확인을 대신하지 않는다. [공식 상점관리자 안내와 가이드 링크](https://docs.tosspayments.com/resources/glossary/dashboard)
- **수취 수수료 세금계산서와 우대수수료 제도가 확인된다.** 현재 홈페이지 연결 서비스 이용계약 제23조는 월 수수료에 대한 세금계산서 발행, 제24조는 영세중소 우대수수료를 설명한다. 요금 안내는 신규 사업자의 등급 반영·환급을 안내한다. ICONS의 실제 등급·적용률·환급 대상·이미 수취한 문서는 별도 확인 대상이다. [서비스 이용계약 제23·24조](https://pages.tosspayments.com/terms/onboarding/), [공식 요금 안내](https://www.tosspayments.com/about/fee)
- **지급보류와 차감·재정산은 계약상 별도 사실이다.** 같은 계약의 제27조는 내역 대조·과오납 재정산·후속 차감 등을, 제28조는 지급보류를 다룬다. 이는 정산 행의 지급액·지급일만으로 보류 사유나 해제 완료를 만들어도 된다는 뜻이 아니다. [서비스 이용계약 제27·28조](https://pages.tosspayments.com/terms/onboarding/)
- **확인한 공개 정산 스키마에는 별도 세금계산서 문서번호·원문, 우대환급 식별자, 지급보류·해제 이력이 정의되어 있지 않다.** 해당 기능의 관리 화면 또는 제공 파일/API 계약을 먼저 확보해야 한다. 공급자 기능 자체가 없다고 결론 내린 것은 아니다. [정산 객체·조회 정의](https://docs.tosspayments.com/reference#정산-조회)

세무 집계 전에는 공식 설명의 차이도 해소해야 한다. 코어 API의 `Payment.taxFreeAmount` 설명은 취소 시 값이 바뀐다고 적고, 세금 가이드의 ‘부분 취소 후 남은 면세 금액’ 절은 최초 면세 금액이 유지된다고 적는다. 적용 API 버전의 취소 응답과 공급자 확인 없이 어느 설명을 기준으로 세무 원장을 만들지 않는다. 이 문서가 ICONS의 [전체 주문·전액 환급 계약](partial-claims-contract.md)을 바꾸지는 않는다. [API 필드 설명](https://docs.tosspayments.com/reference#payment-객체), [세금 가이드 해당 절](https://docs.tosspayments.com/guides/v2/learn/tax#부분-취소-후-남은-면세-금액을-계산하고-싶을-때)

공식 환경 안내상 정산 조회 기록은 라이브에만 있으며 테스트 환경에서는 내역이 없는 것으로 조회된다. 로컬 합성 정산 자료와 테스트 API의 0건 응답은 실제 가맹점 정산 검증과 구분한다. [테스트 환경의 정산 제한](https://docs.tosspayments.com/guides/v2/get-started/environment#테스트-환경)

## 코페이의 공개 제공 범위

코페이 [공식 자료실](https://www.korpay.com/resource)이 연결하는 문서를 확인했다. 자료실의 계약서 서식은 실제 ICONS가 서명한 계약서가 아니며, 공개 소개가 ICONS 계정의 사용 권한을 입증하지 않는다.

- **장부 조회 기능:** Korpay장부 소개서 3쪽은 총 입금액·월별 입금보고서와 월별 부가세 신고금액 조회를 안내한다. 정산/VAT 기능이 없다고 표시할 근거는 없지만, 자동 수집 API나 파일의 열·단위·정정 규칙은 이 소개서에 없다. [공식 장부 소개서](https://kr.object.fin-ncloudstorage.com/korpay-public-storage/public/homepage/files/pg/Korpay%EC%9E%A5%EB%B6%80%20%EC%84%9C%EB%B9%84%EC%8A%A4%20%EC%86%8C%EA%B0%9C%EC%84%9C.pdf)
- **정산자료·수취 세금계산서:** 공개 전자결제 이용계약서 제5조는 정산자료 제공, 제6조는 수수료 세금계산서의 월별 발급을 규정한다. 서식상 발급 시점은 해당 월 마지막 정산 마감 후 익월 5일 이내다. 실제 수취 경로와 수정·취소 문서는 확인하지 못했다. [공식 자료실 연결 계약서](https://kr.object.fin-ncloudstorage.com/korpay-public-storage/public/homepage/files/pg/%EC%A0%84%EC%9E%90%EA%B2%B0%EC%A0%9C%20%EC%84%9C%EB%B9%84%EC%8A%A4%20%EC%9D%B4%EC%9A%A9%EA%B3%84%EC%95%BD%EC%84%9C.docx)
- **차감·보류:** 같은 서식 제9조는 취소 등 다음 정산 차감, 제11조는 비정상 거래 관련 지급보류를 다룬다. 구체적 원장 상태와 보류 해제 데이터의 제공 방식은 확인하지 못했다. [공식 계약서 제9·11조](https://kr.object.fin-ncloudstorage.com/korpay-public-storage/public/homepage/files/pg/%EC%A0%84%EC%9E%90%EA%B2%B0%EC%A0%9C%20%EC%84%9C%EB%B9%84%EC%8A%A4%20%EC%9D%B4%EC%9A%A9%EA%B3%84%EC%95%BD%EC%84%9C.docx)
- **우대수수료:** PG 서비스 소개서 2쪽에 우대수수료 정책은 있지만, 이는 네이버와 같은 소급 환급 파일·원결제 연결·대상 조회 API의 제공 근거가 아니다. 공개 예시 수수료를 ICONS 적용률로 사용하지 않는다. [공식 PG 소개서](https://kr.object.fin-ncloudstorage.com/korpay-public-storage/public/homepage/files/pg/PG%20%EC%84%9C%EB%B9%84%EC%8A%A4%20%EC%86%8C%EA%B0%9C%EC%84%9C.pdf)

공식 인증결제 샘플은 결제 연동 자료다. 위 정산·세무·환급·보류를 위한 자동 조회 endpoint나 응답 계약은 이번 확인 범위에서 찾지 못했다. 이름이 비슷한 타사 Korapay 문서로 보충하거나 URL을 추측하지 않는다. [코페이 공식 샘플](https://github.com/korpay/korpay-sample), [현재 코페이 운영 경계](../../runbooks/korpay-production-rollout.md)

## 후속 구현 전에 확정할 데이터 계약

아래는 구현 예정 스키마가 아니라, 공급자 원본·실제 계약에서 확인해야 할 항목이다.

| 후속 단위 | 필요한 원본과 확인 사항 | 현재 정산 화면으로 대신할 수 없는 것 |
| --- | --- | --- |
| 매출 부가세 참고자료 | 과세·면세·영세율 등 원거래 분류, 매출·취소 귀속 기준일, 결제수단별 증빙 분류, 할인·적립금·배송비 반영, PG 자료와 직접입금 거래의 포함 범위, 정정·재발행 기준 | 수수료 VAT 합계, `orders.done_at`, PG 지급일을 신고 기준으로 임의 치환하는 계산 |
| 수취 세금계산서 | 발행자·공급받는 사업자 범위, 작성·발급일, 문서 식별자, 수수료 대상 기간, 공급가액·세액, 정정 원문 연결, 수취·열람·내보내기 경로 | 정산 XLSX를 공급자의 세금계산서로 출력하거나 고객 대상 발행 기능으로 확장하는 처리 |
| 우대수수료 환급 | 실제 대상 등급과 적용 기간, 원결제 연결 키, 원수수료·환급 기준·환급액, 취소 거래 처리, 정산 반영일·입금 근거, 중복·정정 식별자 | 현재 수수료율 차이만으로 환급액·대상 여부를 추정하는 계산 |
| 지급보류·공제·조정 | 공급자 보류·조정 번호, 사유·금액·상태·효력일, 보류와 해제의 연결, 정산 묶음 또는 원거래 연결, 통화·부호·차기 이월, 정정·부분 해제 의미 | 클레임 보류를 지급보류로 표시하거나 지급액 차이만으로 공제·환급 사유를 생성하는 처리 |
| 은행 실입금 대사 | 계정에 허용된 PG 입금보고서·은행 원본 경로, 지급 묶음과 은행 거래의 연결 키, 입금일·금액·통화, 보류·수수료·차감과 불일치 처리 | 정산 지급일이 지났다는 이유로 실입금 완료를 확정하는 표시 |

각 단위는 실제 계약 계정에서 제공되는 원본 예시, 자료 누락·0건의 의미, 기간과 정정 범위, 안정적인 식별자, 접근 권한과 민감 정보 범위를 확인한 뒤 읽기 연동부터 설계한다. 공급자가 파일만 제공한다면 그 파일 계약을 확인한 후 가져오기 방식을 정하고, 공개 소개만으로 API 연동이 가능한 것으로 표시하지 않는다.

## 이번 정산 조회 범위에서 제외하는 실행

- 네이버 빠른정산의 신청·자격심사·선지급과 판매자 비즈월렛의 충전·출금은 [기존 범위 구분](sales-parity.md)을 유지한다.
- 토스의 수동 정산 요청 `POST /v1/settlements`는 추가 계약을 요구하는 매입 요청이며, 현재 `GET` 조회의 후속 저장 단계가 아니다. [공식 수동 정산 요청](https://docs.tosspayments.com/reference#수동-정산-요청)
- 토스 지급대행은 입점 셀러에게 자금을 지급하는 별도 계약 서비스다. 셀러 등록·잔액·지급 요청의 모델과 상태를 ICONS 자체 PG 정산조회에 섞지 않는다. [공식 지급대행 범위](https://docs.tosspayments.com/reference/additional#지급대행)
- 코페이 선지급·정산 지급대행도 소개와 별도 신청·특약이 있는 서비스다. 신청, 동의, 지급 요청, 자금 이동을 이번 읽기 원장에 추가하지 않는다. [PG 소개서](https://kr.object.fin-ncloudstorage.com/korpay-public-storage/public/homepage/files/pg/PG%20%EC%84%9C%EB%B9%84%EC%8A%A4%20%EC%86%8C%EA%B0%9C%EC%84%9C.pdf), [계약서 제12조](https://kr.object.fin-ncloudstorage.com/korpay-public-storage/public/homepage/files/pg/%EC%A0%84%EC%9E%90%EA%B2%B0%EC%A0%9C%20%EC%84%9C%EB%B9%84%EC%8A%A4%20%EC%9D%B4%EC%9A%A9%EA%B3%84%EC%95%BD%EC%84%9C.docx)

## 조사 검증 기록

공식 웹 문서의 관련 절을 열어 확인했고, 토스 상점관리자 가이드 87쪽·코페이 PG 소개서 2쪽·장부 소개서 3쪽은 렌더링하여 직접 확인했다. 코페이 공개 계약서는 DOCX 본문에서 제5·6·9·11·12조를 확인했다. 공개 문서의 제공 기능과 실제 ICONS 계약·계정 상태는 구분했다.

원본 URL·파일 해시·검토 범위 기록 (`output/smartstore-reference-20261013/pg-settlement-db/followup-source-manifest.json`)을 남겼다. 문서와 참조 경로만 검증했으며, 새 코드·DDL·PG API·신고·발급·보류 설정은 실행하지 않았다.

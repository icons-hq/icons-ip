import type { AdminGuideTopic } from '../types';
export const STORE_SETTINGS_TOPIC:AdminGuideTopic={
  slug:'store-settings',title:'운영 설정과 변경 이력',navLabel:'운영 설정',summary:'사업자·CS 연락처, 무통장 계좌 표시값과 택배사를 배포 없이 관리합니다.',
  sections:[
    {id:'origins',heading:'출고지와 배송 정책',paragraphs:[
      '상품마다 출고지를 지정합니다. 다른 출고지의 상품을 함께 주문하면 출고지별 배송 건이 만들어지고 운송장이 각각 등록됩니다.',
      '출고지 정책 따름은 할인 전 정책 적용 상품 소계를 기준으로 배송비를 한 번 계산합니다. 무료배송 상품은 그 소계에서 제외하며, 개별 배송비는 옵션·수량과 관계없이 상품마다 한 번 붙습니다.',
      '기본 택배사·배송비·무료 배송 기준·반품 주소·출고 마감을 확인한 뒤 새 주문 사용을 켭니다. 남양주는 실제 계약과 출고 절차 확인 전까지 비활성 상태입니다.',
      '출고지시의 표준 12개 열은 이름과 순서를 바꿀 수 있습니다. 실제 WMS·서원 양식과 대조한 뒤 저장하며 배송건번호를 보존합니다. 설정을 바꿔도 기존 주문의 출고지 이름과 배송비는 바뀌지 않습니다. 직원은 읽기만 가능하며 관리자만 변경할 수 있습니다.',
    ],screens:[{href:'/admin/settings/origins'}]},
    {id:'store',heading:'사업자·CS와 무통장 계좌',paragraphs:[
      '직원(staff)은 설정과 변경 이력을 조회합니다. 활성 관리자(admin)만 저장할 수 있습니다.',
      '사업자·CS 연락처를 저장하면 푸터와 법정 문서에 함께 반영됩니다. 빈 항목은 공개 행에서 숨겨집니다.',
      '무통장 계좌는 은행·계좌번호·예금주를 모두 입력해야 새 주문에서 표시됩니다. 모두 비우면 결제수단이 숨겨집니다. 기존 입금 대기 주문을 먼저 확인하고 변경해주세요.',
      '다른 관리자가 먼저 저장하면 덮어쓰지 않습니다. 작성한 값을 복사한 뒤 새로고침해 최신 설정을 확인해주세요.',
    ],screens:[{href:'/admin/settings/store'}]},
    {id:'carriers',heading:'택배사 등록·비활성화',steps:[
      {text:'택배사 코드·이름·HTTPS 배송조회 주소를 등록합니다. 운송장번호 자리는 {trackingNumber}로 표시합니다.',screenHref:'/admin/settings/carriers'},
      {text:'계약이 끝난 택배사는 새 발송에서 사용을 해제하고 저장합니다. 기존 주문의 배송조회 링크는 유지됩니다.'},
      {text:'최근 변경 이력에서 변경자·시각·변경 전후 값을 확인합니다.'},
    ],screens:[{href:'/admin/settings/carriers'}]},
  ],
};

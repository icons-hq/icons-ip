/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
export function reviewEventProblemLabel(problem: string | null): string {
  return ({ review_deleted: '리뷰 삭제', review_hidden: '리뷰 비공개', review_changed: '리뷰 정보 변경', purchase_ineligible: '취소·반품 또는 구매 자격 변경', customer_unavailable: '고객 계정 이용 불가', good_unavailable: '상품 공개 상태 변경' } as Record<string, string>)[problem ?? ''] ?? (problem ? '자격 확인 필요' : '선정 가능');
}
export function reviewEventError(message: string | undefined): string {
  const errors: Record<string, string> = {
    review_event_changed: '다른 운영자가 변경했습니다. 입력은 유지됩니다. 최신 이벤트를 다시 열어 확인해주세요.',
    review_event_review_changed: '선정한 리뷰가 변경되었습니다. 최신 리뷰를 확인하고 선정을 다시 저장해주세요.',
    review_event_terms_locked: '이벤트가 시작되면 조건을 바꾸거나 보관할 수 없습니다.',
    review_event_start_tomorrow: '이벤트는 한국 시각으로 내일부터 시작할 수 있습니다.',
    review_event_credit_policy: '적립금 정책의 활성 여부·보유 상한·유효기간을 확인해주세요.',
    invalid_review_event: '입력값을 확인해주세요. 이벤트명 1~15자, 내용 1~30자, 종료일은 시작일 +1~31일, 발표일은 종료일 +3~10일입니다.',
    review_event_selection_closed: '응모 마감 후, 발표 전에만 선정을 저장할 수 있습니다.',
    review_event_publish_not_ready: '발표일 이후에만 발표 및 지급할 수 있습니다.',
    review_event_entry_ineligible: '선정 대상의 리뷰·구매·고객 상태가 바뀌었습니다. 최신 응모 현황에서 확인해주세요.',
    review_event_customer_once: '한 이벤트에서는 고객 한 명당 리뷰 하나만 선정할 수 있습니다.',
    review_event_target_missing: '선택한 상품이나 카테고리가 보관·삭제되었습니다.',
    store_credit_balance_limit: '일부 고객의 적립금 보유 상한을 넘었습니다. 전체 지급과 발표가 취소되었으니 대상 잔액을 확인해주세요.',
    store_credit_disabled: '적립금 정책이 비활성 상태입니다. 지급과 발표는 반영되지 않았습니다.',
    account_suspended: '일부 고객의 계정이 정지되었습니다. 전체 지급과 발표는 반영되지 않았습니다.',
    account_deletion_in_progress: '탈퇴 처리 중인 고객이 있습니다. 전체 지급과 발표는 반영되지 않았습니다.',
  };
  return errors[message ?? ''] ?? '입력값과 현재 권한을 확인해주세요. 입력과 기존 선정은 유지됩니다.';
}

import { ADMIN_UNPAID_MEMO_MAX, ADMIN_UNPAID_MEMO_MIN } from '@/lib/admin/unpaid';
import { BANK_TRANSFER_HOLD_HOURS } from '@/lib/payments/bank-transfer';
import type { AdminGuideTopic } from '../types';

const MEMO_RANGE = `${ADMIN_UNPAID_MEMO_MIN}자 이상 ${ADMIN_UNPAID_MEMO_MAX}자 이하`;

export const BANK_TRANSFER_TOPIC: AdminGuideTopic = {
  slug: 'bank-transfer',
  title: '무통장 입금 확인',
  navLabel: '무통장 입금',
  summary: '입금 대기 주문을 확인해 결제완료로 확정하고, 기한 연장·취소와 입금 내역 큐를 다루는 절차입니다.',
  sections: [
    {
      id: 'overview',
      heading: '무통장 주문이 흘러가는 방식',
      paragraphs: [
        '무통장 입금 주문은 고객이 법인계좌로 직접 이체하는 결제입니다. 이체가 들어와도 시스템이 알아서 결제완료로 바꾸지 않습니다 — 운영자가 미입금 확인 화면에서 입금을 확인해야 주문이 결제완료가 됩니다.',
        `입금 대기 동안 재고는 잡혀 있습니다(최대 ${BANK_TRANSFER_HOLD_HOURS}시간). 기한 안에 입금이 확인되지 않으면 주문은 자동 취소 대상이 됩니다.`,
        '모든 처리(확인·연장·취소)에는 근거 메모가 필수입니다. 메모 없는 확정을 폼 단계에서 막는 화면입니다.',
      ],
      screens: [{ href: '/admin/sales/unpaid' }],
    },
    {
      id: 'confirm',
      heading: '입금 확인 처리',
      steps: [
        { text: '미입금 확인 화면을 엽니다. 주문코드·구매자로 검색할 수 있습니다.', screenHref: '/admin/sales/unpaid' },
        {
          text: '목록에서 주문을 선택하고 안내된 입금자명·입금액·남은 기한을 실제 계좌 입금 내역과 대조합니다.',
          detail: [
            '금액이 다르거나 입금자명이 다른 애매한 건은 확정하지 말고 팀과 상의합니다 — 확정은 결제완료를 만드는 조작입니다.',
          ],
        },
        {
          text: `입금 확인을 누르고 근거 메모(${MEMO_RANGE})를 남깁니다.`,
          detail: [
            '은행·입금자명·금액을 적어 두면 나중에 대조할 수 있습니다.',
          ],
        },
        {
          text: '결과 문구를 확인합니다. 확정되면 주문은 결제완료가 되고 고객에게 주문확인 메일이 발송됩니다.',
        },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '"확정되지 않았습니다" 경고가 뜨면',
          body: [
            '입금 기록은 남았지만 주문이 결제완료로 확정되지 않은 상태입니다. 화면에 표시된 결과를 확인하고, 해결되지 않으면 개발팀에 주문번호와 함께 알려주세요.',
          ],
        },
      ],
      screens: [{ href: '/admin/sales/unpaid' }],
    },
    {
      id: 'extend',
      heading: '기한 연장',
      paragraphs: [
        `고객이 조금 늦게 입금하겠다고 알려온 경우 기한을 24시간 연장할 수 있습니다. 연장 사유(${MEMO_RANGE})가 필수입니다 — 재고를 하루 더 묶는 판단이기 때문입니다.`,
        '연장은 주문당 한 번만 됩니다. 두 번째 연장 시도는 거부되며, 더 기다릴 수 없다면 취소를 선택해야 합니다.',
      ],
    },
    {
      id: 'cancel',
      heading: '즉시 취소',
      paragraphs: [
        `기한 전이라도 고객 요청 등으로 주문을 접을 때는 즉시 취소를 씁니다. 취소 사유(${MEMO_RANGE})가 필수이며, 취소되면 잡혀 있던 재고가 바로 복원됩니다.`,
      ],
    },
    {
      id: 'deposit-queue',
      heading: '입금 내역 큐',
      paragraphs: [
        '미입금 확인 화면 하단에는 계좌로 들어온 입금 내역이 쌓이는 큐가 있습니다. 시스템이 입금과 주문을 짝지어 제안하지만, 이것은 제안일 뿐 자동으로 확정되지 않습니다 — 마지막 확정 클릭은 언제나 사람이 합니다.',
        `제안을 받아들여 확정할 때도 근거 메모(${MEMO_RANGE})를 남깁니다. 제안을 그대로 받아들이는 경우에도 무엇을 보고 확정했는지 적어야 합니다.`,
        '주문과 무관한 입금(이중 입금·오입금 등)은 보류 처리합니다. 보류해도 기록은 남으므로 반환 절차의 근거가 됩니다.',
      ],
      screens: [{ href: '/admin/sales/unpaid' }],
    },
  ],
};

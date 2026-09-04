import { VARIANT_LIMIT, VARIANT_OPTION_LIMIT } from '@/lib/admin/variants';
import type { AdminGuideTopic } from '../types';

/* 한도 수치는 순수 모듈 상수에서 파생한다 — 제한이 바뀌면 가이드가 따라온다. */

export const VARIANTS_INVENTORY_TOPIC: AdminGuideTopic = {
  slug: 'variants-inventory',
  title: '옵션·품목과 출고지별 재고',
  navLabel: '옵션·품목·재고',
  summary: '색상·사이즈 같은 옵션을 마스터로 만들고, 굿즈마다 품목(옵션 조합)을 세우고, 출고지별로 보유·예약·안전재고를 다루는 절차입니다.',
  sections: [
    {
      id: 'overview',
      heading: '전체 흐름',
      paragraphs: [
        '옵션이 없는 굿즈는 품목 1행이 곧 굿즈 자체입니다. 옵션을 붙이면 고른 값의 조합마다 품목이 생기고, 재고는 품목 × 출고지 단위로 셉니다.',
      ],
      steps: [
        { text: '옵션 마스터에서 옵션(색상·사이즈…)과 값을 만듭니다.', screenHref: '/admin/catalog/options' },
        { text: '굿즈 편집의 「품목 · 재고」 카드에서 옵션을 고르고 「조합으로 품목 생성」을 누른 뒤 저장합니다.', screenHref: '/admin/catalog/goods' },
        { text: '기존 품목의 수량은 같은 카드의 「재고 조정」으로만 바꿉니다 — 사유가 함께 기록됩니다.' },
        { text: '재고 화면에서 품목 × 출고지 전체를 보고, 안전재고 이하만 걸러 봅니다.', screenHref: '/admin/catalog/inventory' },
        { text: '출고지는 설정의 출고지 화면에서 관리합니다. 기본 출고지는 하나입니다.', screenHref: '/admin/settings/shipping' },
      ],
      callouts: [
        {
          tone: 'info',
          title: '한도',
          body: [
            `굿즈 하나에 옵션은 ${VARIANT_OPTION_LIMIT}개, 품목은 ${VARIANT_LIMIT}개까지입니다.`,
          ],
        },
      ],
    },
    {
      id: 'option-masters',
      heading: '옵션 마스터',
      paragraphs: [
        '옵션과 값은 굿즈가 아니라 마스터가 소유합니다. 값의 표기를 고치면 그 값을 쓰는 모든 품목의 표기가 함께 바뀝니다.',
      ],
      steps: [
        { text: '옵션 마스터 화면에서 「새 옵션」을 엽니다.', screenHref: '/admin/catalog/options' },
        { text: '옵션 이름과 표시 방식을 고르고, 새 옵션값을 줄마다 하나씩 적어 저장합니다.' },
        { text: '값을 없애려면 삭제가 아니라 보관입니다. 품목이 쓰고 있는 값은 보관할 수 없습니다.' },
      ],
      screens: [{ href: '/admin/catalog/options' }],
    },
    {
      id: 'variants',
      heading: '품목 표',
      paragraphs: [
        '굿즈 편집 화면의 「품목 · 재고」 카드는 저장 폼과 별개로 저장됩니다. 옵션을 처음 붙이면 기본 품목은 보관되고, 그 재고는 「재고 이동」으로 새 품목에 옮겨야 판매 수량에 잡힙니다.',
      ],
      steps: [
        { text: '옵션 칸에서 마스터를 고르고 쓸 값을 체크합니다.' },
        { text: '「조합으로 품목 생성」을 누르면 값의 조합마다 행이 생깁니다. 이미 있는 조합은 그대로 둡니다.' },
        { text: '새 행에는 출고지별 초기 재고를 적을 수 있습니다. 자체 품목코드(ERP 품목코드)와 추가금액도 여기서 적습니다.' },
        { text: '「품목 저장」을 누릅니다. 품목 코드는 저장 시 굿즈 ID 뒤에 번호로 붙습니다.' },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '기존 품목의 수량은 표에서 바꾸지 않습니다',
          body: [
            '수량의 입구는 둘뿐입니다 — 새 품목의 초기 재고와 기존 품목의 재고 조정. 조정은 현재 보유 수량을 기준으로 적용되므로, 다른 사람이 먼저 바꿨다면 최신 수량을 확인하라는 안내가 뜹니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/goods' }],
    },
    {
      id: 'inventory',
      heading: '재고 화면과 안전재고',
      paragraphs: [
        '보유는 창고에 있는 수, 예약은 아직 출고하지 않은 주문에 묶인 수, 가용은 둘의 차입니다. 안전재고는 판매를 막지 않고, 가용이 그 수 이하로 내려가면 「재고 부족」으로 표시됩니다.',
      ],
      steps: [
        { text: '재고 화면에서 굿즈 이름·굿즈 ID·품목코드·자체코드로 찾습니다.', screenHref: '/admin/catalog/inventory' },
        { text: '「안전재고 이하만」으로 보충이 필요한 품목만 봅니다.' },
        { text: '엑셀이나 창고 실적으로 수량을 한 번에 맞추려면 「수량 일괄 맞추기」에 한 줄에 하나씩 붙여 넣습니다. 한 행이라도 틀리면 아무것도 반영하지 않습니다.' },
      ],
      screens: [{ href: '/admin/catalog/inventory' }],
    },
    {
      id: 'locations',
      heading: '출고지',
      paragraphs: [
        '굿즈는 기본 출고지를 갖고 품목이 덮어쓸 수 있습니다. 새 출고지를 켜면 모든 품목에 0개 재고 행이 생기고, 재고가 남은 출고지는 비활성화할 수 없습니다.',
      ],
      steps: [
        { text: '설정의 출고지 화면에서 「새 출고지」를 엽니다.', screenHref: '/admin/settings/shipping' },
        { text: '코드(영문 소문자·숫자·하이픈), 이름, ERP 창고 코드, 기본 택배사를 적어 저장합니다.' },
        { text: '기본 출고지를 바꾸려면 새 출고지에서 「기본 출고지」를 켭니다 — 이전 기본은 자동으로 해제됩니다.' },
      ],
      screens: [{ href: '/admin/settings/shipping' }],
    },
  ],
};

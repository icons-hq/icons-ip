import { CATEGORY_MAX_DEPTH, GOOD_SALE_STATES } from '@/lib/admin/categories';
import type { AdminGuideTopic } from '../types';

/* 상태 목록·깊이 상한은 순수 모듈 상수에서 파생한다 — 규칙이 바뀌면 가이드가 따라온다. */

export const CATEGORIES_SALE_TOPIC: AdminGuideTopic = {
  slug: 'categories-sale',
  title: '분류와 판매 기간',
  navLabel: '분류·판매 기간',
  summary: '굿즈를 분류 트리에 넣고 분류별 진열 순서를 정하는 법, 그리고 판매 시작·종료·선주문·판매 중지를 다루는 법입니다.',
  sections: [
    {
      id: 'overview',
      heading: '전체 흐름',
      paragraphs: [
        '분류는 고객이 굿즈를 찾아 들어오는 길이고, 판매 기간은 그 굿즈를 언제부터 언제까지 살 수 있는지입니다. 둘 다 굿즈 저장 폼과 따로 저장됩니다 — 값 하나를 고치려고 고시정보를 다시 채우지 않아도 됩니다.',
      ],
      steps: [
        { text: '분류 화면에서 트리를 만듭니다.', screenHref: '/admin/catalog/categories' },
        { text: '굿즈 편집 화면의 「분류」 카드에서 그 굿즈가 속할 분류와 대표 분류를 고릅니다.', screenHref: '/admin/catalog/goods' },
        { text: '분류 화면으로 돌아와 「분류별 진열」에서 순서와 고정을 정합니다.' },
        { text: '굿즈 편집 화면의 「판매 기간 · 상태」 카드에서 판매 시작·종료와 선주문을 정합니다.' },
      ],
      callouts: [
        {
          tone: 'info',
          title: '분류는 몇 단까지',
          body: [`분류는 ${CATEGORY_MAX_DEPTH}단까지 만들 수 있습니다. 그보다 깊게 만들거나 옮기려 하면 저장이 거부됩니다.`],
        },
      ],
    },
    {
      id: 'tree',
      heading: '분류 트리 만들기',
      paragraphs: [
        '분류 코드는 주소에 쓰이므로 저장한 뒤에는 바꿀 수 없습니다. 짧고 읽기 좋은 영문 소문자로 정합니다.',
      ],
      steps: [
        { text: '분류 화면에서 「새 분류」를 누르거나, 트리의 항목 옆 「+ 하위」로 하위 분류를 엽니다.', screenHref: '/admin/catalog/categories' },
        { text: '분류 코드와 이름을 적고 상위 분류를 고릅니다. 기획전은 상위 분류를 가질 수 없습니다.' },
        { text: '트리에서 화살표로 같은 단계 안의 순서를 바꿉니다. 상위 분류를 바꾸려면 「상위 분류 옮기기」를 씁니다.' },
        { text: '쓰지 않는 분류는 보관합니다. 하위 분류나 소속 굿즈가 남아 있으면 보관되지 않습니다.' },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '숨김과 내부 전용',
          body: [
            '표시 상태를 숨김으로 두거나 내부 전용으로 표시하면 고객에게 그 분류가 보이지 않습니다. 소속된 굿즈 자체는 그대로 팔립니다 — 굿즈를 감추려면 굿즈 쪽 진열 스위치를 씁니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/categories' }],
    },
    {
      id: 'display',
      heading: '분류별 진열',
      paragraphs: [
        '진열 순서는 고정 핀이 가장 앞이고, 그다음 이 분류에 직접 속한 굿즈, 그다음 하위 분류에서 올라온 굿즈입니다. 품절은 설정에 따라 맨 뒤로 보냅니다.',
      ],
      steps: [
        { text: '분류를 고르고 「분류별 진열」 표에서 화살표로 순서를 바꿉니다.' },
        { text: '항상 맨 앞에 두고 싶은 굿즈는 「고정」을 누릅니다.' },
        { text: '기간을 정해 진열하려면 「진열 기간 지정」에서 굿즈와 시작·종료를 고릅니다. 기간 밖이면 그 분류에서만 빠지고 다른 분류에는 그대로 남습니다.' },
      ],
      callouts: [
        {
          tone: 'info',
          title: '자동 정렬로 두면',
          body: ['진열 방식을 자동 정렬로 바꾸면 순서를 직접 바꿀 수 없습니다. 정렬 기준(최근 등록순·판매가순 등)이 대신 정합니다.'],
        },
      ],
    },
    {
      id: 'sale-window',
      heading: '판매 기간과 상태',
      paragraphs: [
        '판매 상태는 어딘가에 저장해 두는 값이 아니라 그때그때 계산됩니다. 그래서 시작 시각이 지나면 따로 누르지 않아도 판매가 열리고, 종료 시각이 지나면 바로 닫힙니다.',
      ],
      table: {
        columns: ['상태', '뜻'],
        rows: GOOD_SALE_STATES.map((state) => [state.label, {
          on_sale: '지금 살 수 있습니다.',
          preorder: '지금 결제하고 정한 날짜에 받습니다.',
          soldout: '수량이 없거나 운영자가 품절로 두었습니다.',
          scheduled: '판매 시작 전입니다. 목록에는 남습니다.',
          ended: '판매 종료 시각이 지났습니다. 재입고해도 열리지 않습니다.',
          stopped: '운영자가 판매를 멈췄습니다. 보이지만 살 수 없습니다.',
          hidden: '진열에서 뺐습니다. 목록·검색·상세에 나오지 않습니다.',
          archived: '보관된 굿즈입니다.',
        }[state.value] ?? '']),
      },
      steps: [
        { text: '굿즈 편집 화면을 열고 「판매 기간 · 상태」 카드로 갑니다.', screenHref: '/admin/catalog/goods' },
        { text: '판매 시작·종료를 정합니다. 비우면 제한이 없습니다.' },
        { text: '선주문으로 팔려면 판매 방식을 선주문으로 바꾸고 출고 예정일을 적습니다.' },
        { text: '급히 멈춰야 하면 「판매 · 진열 스위치」에서 판매를 끕니다. 끌 때는 사유를 남깁니다.' },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '진열에서 빼는 것과 판매를 멈추는 것은 다릅니다',
          body: [
            '진열을 끄면 고객 화면에서 사라지고, 판매를 끄면 보이되 살 수 없습니다. 어느 쪽이든 결제 직전에 다시 검사하므로, 이미 열어 둔 결제 창으로도 주문이 들어오지 않습니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/goods' }],
    },
    {
      id: 'search-seo',
      heading: '요약 · 검색어 · SEO',
      paragraphs: [
        '요약은 목록 카드와 상세 상단에 나오는 한 줄이고, 검색어는 이름에 없는 말로도 찾히게 하는 보조어입니다.',
      ],
      steps: [
        { text: '굿즈 편집 화면의 「요약 · 검색어 · SEO」 카드를 엽니다.', screenHref: '/admin/catalog/goods' },
        { text: '검색어는 쉼표나 줄바꿈으로 구분해 적습니다. 저장할 때 공백을 정리하고 중복을 지웁니다.' },
        { text: 'SEO 제목과 설명은 비워 두면 굿즈 이름과 요약이 대신 쓰입니다.' },
      ],
      screens: [{ href: '/admin/catalog/goods' }],
    },
  ],
};

import type { AdminHelpBook } from './types';

/**
 * 지역별 추가배송비 관리 화면의 "?" 도움말(docs/admin-screen-rules.md 규칙 3).
 * 붙여넣는 지역표의 열 규칙처럼 화면 구조·미리보기로 풀리지 않는 것에만 단다.
 * 처리 이름(추가배송비 받음 등)은 `lib/admin/shipping-regions.ts`의 `REGION_DISPOSITION_LABELS`와 같게 쓴다.
 */
export const SHIPPING_REGIONS_HELP = {
  regionTable: {
    what: '엑셀에서 6개 열을 한꺼번에 복사해 붙여넣습니다. 열 순서는 우편번호 시작, 우편번호 끝, 주소 시작문구, 지역명, 처리, 추가배송비입니다.',
    example: '63000부터 63644까지 3,000원을 받으려면 처리에 추가배송비 받음, 추가배송비에 3000을 적습니다.',
    caution: '우편번호는 5자리이고 시작과 끝 번호도 범위에 들어갑니다. 금액은 추가배송비 받음 줄에만 적고, 0원이면 0을 적습니다.',
  },
  regionPreview: {
    what: '붙여넣은 지역표를 읽은 결과입니다. 왼쪽 번호는 안내에 나오는 줄 번호와 같습니다.',
    where: '지역명은 상품 상세의 배송 안내와 고객의 주문 내역에 그대로 보입니다. 제주·도서산간처럼 묶어서 적습니다.',
    caution: '배송 불가 줄과 개별 확인 필요 줄의 주소로는 주문할 수 없습니다. 고객에게 보이는 안내 글만 다릅니다.',
  },
  addressPrefix: {
    what: '같은 우편번호 안에서 일부 주소만 가를 때 적습니다. 고객의 기본주소가 이 글과 단어까지 똑같이 시작할 때만 그 줄이 적용됩니다.',
    example: '제주특별자치도 제주시처럼 띄어쓰기까지 주소 그대로 적습니다.',
    caution: '주소 시작문구를 적은 우편번호에서는 어느 줄과도 맞지 않는 주소로 주문할 수 없습니다.',
  },
} as const satisfies AdminHelpBook;

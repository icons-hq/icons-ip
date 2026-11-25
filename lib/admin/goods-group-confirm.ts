import type { AdminConfirmRequest } from './confirm';
import type { GoodsGroupSnapshot } from './goods-groups';
import type { GoodsAfterSalesValues } from '@/lib/goods-after-sales';

/*
 * 그룹상품 화면의 확인창 문구(docs/admin-screen-rules.md 규칙 7).
 * 사라지는 것이 없으면 null을 돌려줘 묻지 않는다. 문구만 만들고 화면 상태는 건드리지 않는다.
 */

const written = (value: string) => value.trim().length > 0;
const quoted = (names: string[]) => names.map((name) => `‘${name}’`).join('·');

/** 옵션명 개수를 줄일 때 사라지는 입력: 줄어드는 쪽의 이름이 있는 옵션명과 값이 있는 옵션값. */
export function goodsGroupAxisConfirm(optionNames: readonly string[], rows: readonly { values: readonly string[] }[], count: number): AdminConfirmRequest | null {
  const names = optionNames.slice(count).filter(written).map((name) => name.trim());
  const values = rows.reduce((sum, row) => sum + row.values.slice(count).filter(written).length, 0);
  if (!names.length && !values) return null;
  const lost = names.length && values ? `${quoted(names)} 옵션명과 적어 둔 옵션값 ${values}개가 사라집니다.`
    : names.length ? `${quoted(names)} 옵션명이 사라집니다.` : `적어 둔 옵션값 ${values}개가 사라집니다.`;
  return { title: `옵션명을 ${count}개로 줄일까요?`, message: lost, confirmLabel: '줄이기' };
}

/** 그룹 구성에서 상품을 제외할 때 사라지는 입력: 그 상품에 적어 둔 옵션값. */
export function goodsGroupMemberConfirm(name: string, values: readonly string[]): AdminConfirmRequest | null {
  const count = values.filter(written).length;
  return count ? { title: '이 상품을 그룹에서 제외할까요?', message: `‘${name}’ 상품에 적어 둔 옵션값 ${count}개가 사라집니다.`, confirmLabel: '제외' } : null;
}

/** 그룹 전환에서 옵션을 빼면 사라지는 입력. `edited`는 원상품에서 채워진 값과 달라진 옵션값 수라, 다시 체크하면 되살아나는 값은 세지 않는다. */
export function goodsGroupSelectionConfirm(name: string, edited: number): AdminConfirmRequest | null {
  return edited ? { title: '전환할 옵션에서 뺄까요?', message: `‘${name}’ 옵션에 고쳐 적은 옵션값 ${edited}개가 사라집니다.`, confirmLabel: '빼기' } : null;
}

/** 그룹 전환에서 원상품을 바꾸면 고쳐 적은 입력이 새 상품의 값으로 다시 채워진다. 고친 것이 있을 때만 쓴다. */
export const GOODS_GROUP_SOURCE_CONFIRM: AdminConfirmRequest = {
  title: '다른 상품으로 바꿀까요?',
  message: '지금 고쳐 적은 그룹상품명·옵션명·옵션값이 사라지고, 고른 상품의 값으로 다시 채워집니다.',
  confirmLabel: '상품 바꾸기',
};

/** 서버가 A/S 안내를 비우는 기준과 같다: 세 칸이 공백뿐이면 모든 연결 상품의 A/S 안내를 비운다. */
export const goodsGroupAfterSalesBlank = (values: GoodsAfterSalesValues) => ![values.phone, values.guide, values.sellerSpecialNotes].some((value) => /[^ \t\r\n]/.test(value));

/**
 * 그룹 공통정보 저장의 확인창. 저장은 연결된 모든 상품에 같은 값을 넣고(DB 함수 admin_save_goods_group_common),
 * 공개 중인 상품을 초안으로 바꾸며 KC 검토를 처음 상태로 돌린다. 공개 중인 수는 화면을 연 때의 값이다.
 */
export function goodsGroupCommonConfirm(group: Pick<GoodsGroupSnapshot, 'members'>, afterSales: GoodsAfterSalesValues): AdminConfirmRequest {
  const total = group.members.length;
  const published = group.members.filter((member) => member.publishedAt && !member.archivedAt).length;
  return {
    title: `연결된 ${total}개 상품에 공통정보를 적용할까요?`,
    message: [
      published ? `공개 중인 상품 ${published}개가 초안으로 바뀌어 고객 화면에서 내려갑니다.` : '',
      `상품 ${total}개 모두 KC 검토를 다시 마쳐야 공개할 수 있습니다.`,
      goodsGroupAfterSalesBlank(afterSales) ? `A/S 안내와 판매자 특이사항은 상품 ${total}개 모두에서 비워집니다.` : '',
    ].filter(Boolean).join('\n'),
    confirmLabel: '적용',
  };
}

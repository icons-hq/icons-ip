'use client';
import { findGoodsForAnnouncementAction } from '@/app/admin/goods-announcement-actions';
import { GOODS_ANNOUNCEMENT_GOOD_LIMIT, type GoodsAnnouncementGood } from '@/lib/admin/goods-announcements';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { AdminPickerDialog } from '../console/AdminPickerDialog';

/*
 * 공지를 붙일 상품을 고르는 창(화면 규칙 1 — 공용 선택창).
 * 조회는 공지 전용 상품 조회를 쓴다. 공지 화면은 공지 권한으로 열리고 상품 조회 권한이 없는 계정(물류출고관리)도 쓰므로,
 * 상품 조회 권한을 보는 공용 상품 조회(AdminGoodsPicker의 기본 조회)를 쓰면 그 계정에서 막힌다.
 * 보관한 상품은 조회 단계에서 빠진다(규칙 2).
 */
export const goodsAnnouncementPickerLoader: AdminPickerLoader<GoodsAnnouncementGood> = async (request) => {
  const response = await findGoodsForAnnouncementAction(request.query, request.page);
  return 'data' in response ? response.data : { error: response.error };
};

const count = (value: number) => value.toLocaleString('ko-KR');

export function GoodsAnnouncementProductPicker({ value, onSelect, onDeselect, onClose }: {
  /** 지금까지 고른 상품. */
  value: readonly GoodsAnnouncementGood[];
  onSelect: (good: GoodsAnnouncementGood) => void;
  onDeselect: (good: GoodsAnnouncementGood) => void;
  onClose: () => void;
}) {
  const picked = new Set(value.map(good => good.id));
  const full = value.length >= GOODS_ANNOUNCEMENT_GOOD_LIMIT;
  return <AdminPickerDialog<GoodsAnnouncementGood>
    title="상품 고르기"
    description="고른 상품의 상세 화면에 이 공지가 보입니다."
    load={goodsAnnouncementPickerLoader}
    rowKey={good => good.id}
    rowView={good => ({ title: good.name, meta: good.code })}
    searchPlaceholder="상품명·상품 자동코드·상품 URL"
    excludedNote="보관한 상품은 목록에서 뺐습니다."
    multiple
    selectedKeys={[...picked]}
    onSelect={onSelect}
    onDeselect={onDeselect}
    rowBlocked={full ? good => (picked.has(good.id) ? null : `최대 ${count(GOODS_ANNOUNCEMENT_GOOD_LIMIT)}개까지`) : undefined}
    footer={<p className="text-sm tabular-nums text-muted-foreground" role="status">고른 상품 {count(value.length)}개 / 최대 {count(GOODS_ANNOUNCEMENT_GOOD_LIMIT)}개</p>}
    onClose={onClose}
  />;
}

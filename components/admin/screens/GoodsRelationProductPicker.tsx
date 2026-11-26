'use client';
import { findGoodsForRelationAction } from '@/app/admin/goods-relation-actions';
import { parseGoodUrl } from '@/lib/admin/good-url';
import { relationGoodStatusText, type GoodsRelationGood } from '@/lib/admin/goods-relations';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { publicMediaUrl } from '@/lib/media';
import { AdminPickerDialog, type AdminPickerRowView } from '../console/AdminPickerDialog';

/*
 * 연관상품에 담을 상품 고르기. 공용 선택창(화면 규칙 1)을 여러 개 고르기로 쓴다: [선택]하면 바로 담기고 [빼기]로 빼며 [완료]로 닫는다.
 * 조회는 연관상품 전용 검색을 쓴다 — 줄마다 게시 상태(초안·공개)와 판매 제한 표시를 편집 화면과 같은 판정으로 보여야 해서다.
 * 초안 상품도 미리 담을 수 있다(고를 수 없는 항목이 아니라 아직 안 보이는 항목이다). 보관한 상품만 조회에서 빠진다.
 */

/** 검색어 한 칸으로 상품명·상품 자동코드를 찾는다. 상품 페이지 주소를 붙여 넣으면 주소 끝 값으로 찾는다(예전 'URL로 추가' 칸을 대신한다). */
export const relationGoodsLoader: AdminPickerLoader<GoodsRelationGood> = async (request) => {
  const address = request.query.includes('/shop/') ? parseGoodUrl(request.query, typeof window === 'undefined' ? null : window.location.host) : null;
  const result = await findGoodsForRelationAction(address?.ok ? address.id : request.query, request.page);
  return 'data' in result ? result.data : { error: result.error };
};

/** 선택창 한 줄: 사진·상품명·상품 자동코드·게시 상태. 내부 값(상품 URL)은 보이지 않는다(화면 규칙 8). */
export function relationGoodRowView(good: GoodsRelationGood, adultGoodsHidden = false): AdminPickerRowView {
  return { title: good.name, meta: `${good.code} · ${relationGoodStatusText(good, adultGoodsHidden)}`, imageUrl: good.imagePath ? publicMediaUrl(good.imagePath) : null };
}

export function GoodsRelationProductPicker({ value, limit, adultGoodsHidden = false, onAdd, onRemove, onClose }: {
  /** 지금 담은 상품. 그 줄은 '선택됨'과 [빼기]로 보인다. */
  value: GoodsRelationGood[];
  /** 지금 유형·표시 방식에서 담을 수 있는 수. 다 담으면 나머지 줄은 고를 수 없다. */
  limit: number;
  adultGoodsHidden?: boolean;
  onAdd: (good: GoodsRelationGood) => void;
  onRemove: (good: GoodsRelationGood) => void;
  onClose: () => void;
}) {
  const picked = new Set(value.map(good => good.id));
  return <AdminPickerDialog<GoodsRelationGood>
    description={`${value.length}개 담았습니다. ${limit}개까지 담을 수 있습니다.`}
    excludedNote="보관한 상품은 목록에서 뺐습니다."
    load={relationGoodsLoader}
    multiple
    onClose={onClose}
    onDeselect={onRemove}
    onSelect={onAdd}
    rowBlocked={good => value.length >= limit && !picked.has(good.id) ? `${limit}개를 모두 담았습니다` : null}
    rowKey={good => good.id}
    rowView={good => relationGoodRowView(good, adultGoodsHidden)}
    searchPlaceholder="상품명·상품 자동코드·상품 페이지 주소"
    selectedKeys={[...picked]}
    showImages
    title="상품 고르기"
  />;
}

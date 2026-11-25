'use client';

import { useState } from 'react';
import { searchErpItemPickerAction } from '@/app/admin/erp-item-picker-actions';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import { formatWon } from '@/lib/admin/goods-price-editor';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { AdminPickerDialog, type AdminPickerRowView } from './console/AdminPickerDialog';

/*
 * 옵션의 ERP 품목 고르기(공용 선택창, docs/admin-screen-rules.md 규칙 1·2).
 *
 * 예전에는 ERP 품명 칸이 입력하면 뜨는 제안 목록(2자 이상, 최대 8개)이었다 — 9번째부터는 볼 수 없었고, 같은 칸이 검색과 직접 입력을 겸해
 * 고른 것인지 적은 것인지 구분되지 않았다. 지금은 고르는 길과 적는 길을 나눈다: [ERP 품목 고르기]는 ERP 품목 메뉴에 올린 품목 전체를
 * 20개씩 보여 주고, ERP 코드·바코드·ERP 품명 칸은 ERP 품목에 없는 것을 직접 적는 평범한 입력 칸이다.
 * 열림 상태는 줄마다 이 부품이 가진다(옵션 편집기의 상태 순서를 바꾸지 않는다).
 */

/** ERP 품목 메뉴에 올린 품목을 ERP 품명·ERP 코드로 찾아 20개씩 읽는다. */
export const loadErpItems: AdminPickerLoader<ErpItemMatch> = async (request) => {
  const result = await searchErpItemPickerAction({ query: request.query, page: request.page });
  return result.ok ? result.data : { error: result.error };
};

/** 줄 하나: 품명 아래에 고르면 들어갈 ERP 코드·바코드와, 같은 이름을 구분할 ERP 분류·ERP 판매가를 보인다. */
export function erpItemRowView(item: ErpItemMatch): AdminPickerRowView {
  return {
    title: item.name,
    meta: [item.code, item.barcode ? `바코드 ${item.barcode}` : '바코드 없음', item.category, item.salePrice === null ? null : `ERP 판매가 ${formatWon(item.salePrice)}`].filter(Boolean).join(' · '),
  };
}

/**
 * 고른 ERP 품목을 그 옵션 줄에서 한 줄로 되읽는다. 직접 적은 줄에는 이 줄이 없어 고른 것과 적은 것이 구분된다.
 * 고른 뒤 ERP 코드나 ERP 품명을 손으로 고치면 더는 그 품목이 아니므로 null을 돌려준다.
 * 바코드는 칸이 비어 있을 때만 품목 값이 들어간다 — 적어 둔 바코드가 품목과 다르면 그대로 둔 것을 알린다(warning).
 */
export function erpItemPickSummary(
  row: { erpCode?: string | null; erpName?: string | null; barcode?: string | null },
  item: Pick<ErpItemMatch, 'code' | 'name' | 'barcode'>,
): { text: string; warning: boolean } | null {
  if ((row.erpCode ?? '') !== item.code || (row.erpName ?? '') !== item.name) return null;
  const head = `고른 ERP 품목 · ${item.code}`;
  const written = row.barcode?.trim() ?? '';
  const itemBarcode = item.barcode?.trim() ?? '';
  if (!itemBarcode) return { text: `${head} · 바코드 없는 품목`, warning: false };
  if (written === itemBarcode) return { text: `${head} · 바코드 ${itemBarcode}`, warning: false };
  if (!written) return { text: head, warning: false };
  return { text: `${head} · 바코드는 적어 둔 값을 그대로 뒀습니다. ERP 품목의 바코드는 ${itemBarcode}입니다.`, warning: true };
}

export function ErpItemPickButton({ target, ariaLabel, blockedReason, onSelect }: {
  /** 선택창 설명에 넣을 대상(예: '옵션 2(파랑)'). 옵션 없는 상품은 주지 않는다. */
  target?: string;
  ariaLabel: string;
  /** 이 품목을 고를 수 없는 이유(같은 상품의 다른 옵션이 쓰는 품목). 고를 수 있으면 null. */
  blockedReason?: (item: ErpItemMatch) => string | null;
  onSelect: (item: ErpItemMatch) => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    {/* 옵션 표의 좁은 칸에 들어간다. 칸보다 길면 넘치지 않고 두 줄로 접힌다(buttonVariants가 겹치는 높이·줄바꿈 클래스를 정리한다). */}
    <button type="button" className={buttonVariants({ variant: 'outline', size: 'xs', className: 'h-auto min-h-6 max-w-full py-0.5 whitespace-normal' })} data-slot="button" data-erp-item-picker="" aria-label={ariaLabel} onClick={() => setOpen(true)}>
      ERP 품목 고르기
    </button>
    {open ? <AdminPickerDialog<ErpItemMatch>
      description={`${target ? `${target}에 넣을 ERP 품목을 고릅니다. ` : ''}ERP 코드와 ERP 품명이 고른 품목 값으로 바뀌고, 바코드는 칸이 비어 있을 때만 들어갑니다.`}
      emptyText="맞는 ERP 품목이 없습니다. ‘ERP 품목’ 메뉴에 올린 품목만 나옵니다. 없는 품목은 창을 닫고 ERP 코드·바코드·ERP 품명 칸에 직접 적습니다."
      load={loadErpItems}
      onClose={() => setOpen(false)}
      onSelect={(item) => { onSelect(item); }}
      rowBlocked={blockedReason}
      rowKey={(item) => item.code}
      rowView={erpItemRowView}
      searchPlaceholder="ERP 품명·ERP 코드"
      title="ERP 품목 고르기"
    /> : null}
  </>;
}

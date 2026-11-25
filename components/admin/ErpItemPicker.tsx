'use client';

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { searchErpItemPickerAction } from '@/app/admin/erp-item-picker-actions';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import type { ErpItemMatch } from '@/lib/admin/erp-items';
import { formatWon } from '@/lib/admin/goods-price-editor';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import { AdminPickerDialog, type AdminPickerRowView } from './console/AdminPickerDialog';

/*
 * 옵션의 ERP 품목 고르기(공용 선택창, docs/admin-screen-rules.md 규칙 1·2·6).
 *
 * 예전에는 ERP 품명 칸이 입력하면 뜨는 제안 목록(2자 이상, 최대 8개)이었다 — 9번째부터는 볼 수 없었고, 같은 칸이 검색과 직접 입력을 겸했다.
 * 지금은 고르는 길과 적는 길을 나눈다: [ERP 품목 고르기]는 ERP 품목 메뉴에 올린 품목 전체를 20개씩 보여 주고,
 * ERP 코드·바코드·ERP 품명 칸은 ERP 품목에 없는 것을 직접 적는 평범한 입력 칸이다.
 *
 * 옵션이 수십 개인 상품에서 줄마다 같은 검색을 되풀이하지 않게 한다:
 *   1. 창은 그 줄에 적힌 ERP 품명·ERP 코드, 없으면 이 표에서 마지막으로 찾은 검색어로 열린다(`ErpItemPickScope`가 기억한다).
 *   2. 고른 뒤 아래에 ERP 품목이 비어 있는 옵션이 있으면 창을 닫지 않고 그 옵션으로 넘어간다(`queue`). 검색 결과는 그대로 남는다.
 * 열림 상태는 줄마다 이 부품이 가진다(옵션 편집기의 상태 순서를 바꾸지 않는다).
 */

/** ERP 품목 메뉴에 올린 품목을 ERP 품명·ERP 코드로 찾아 20개씩 읽는다. */
export const loadErpItems: AdminPickerLoader<ErpItemMatch> = async (request) => {
  const result = await searchErpItemPickerAction({ query: request.query, page: request.page });
  return result.ok ? result.data : { error: result.error };
};

/**
 * 줄 하나: 품명 아래에 고르면 들어갈 ERP 코드·바코드와, 같은 이름을 구분할 ERP 분류·ERP 판매가를 보인다.
 * `currentCode`는 지금 고르는 옵션에 들어 있는 ERP 코드다. 같은 품목의 줄 앞에 그 사실을 적는다 — 고를 수는 있다(비어 있는 바코드를 채울 때 다시 고른다).
 */
export function erpItemRowView(item: ErpItemMatch, currentCode?: string | null): AdminPickerRowView {
  return {
    title: item.name,
    meta: [currentCode && currentCode === item.code ? '이 옵션에 넣은 품목' : null, item.code, item.barcode ? `바코드 ${item.barcode}` : '바코드 없음', item.category, item.salePrice === null ? null : `ERP 판매가 ${formatWon(item.salePrice)}`].filter(Boolean).join(' · '),
  };
}

/**
 * 방금 ERP 품목에서 가져온 값을 그 옵션 줄에서 한 줄로 되읽는다(무엇이 들어갔는지 — ERP 코드와 바코드).
 * 가져온 직후의 결과 안내다. 상품을 저장하거나 화면을 다시 열면 사라진다 — 저장된 값에는 고른 것과 직접 적은 것의 구분이 없다.
 * 가져온 뒤 ERP 코드나 ERP 품명을 손으로 고치면 더는 그 품목이 아니므로 null을 돌려준다.
 * 바코드는 칸이 비어 있을 때만 품목 값이 들어간다 — 적어 둔 바코드가 품목과 다르면 그대로 둔 것을 알린다(warning).
 */
export function erpItemPickSummary(
  row: { erpCode?: string | null; erpName?: string | null; barcode?: string | null },
  item: Pick<ErpItemMatch, 'code' | 'name' | 'barcode'>,
): { text: string; warning: boolean } | null {
  if ((row.erpCode ?? '') !== item.code || (row.erpName ?? '') !== item.name) return null;
  const head = `ERP 품목에서 가져왔습니다 · ${item.code}`;
  const written = row.barcode?.trim() ?? '';
  const itemBarcode = item.barcode?.trim() ?? '';
  if (!itemBarcode) return { text: `${head} · 바코드 없는 품목`, warning: false };
  if (written === itemBarcode) return { text: `${head} · 바코드 ${itemBarcode}`, warning: false };
  if (!written) return { text: head, warning: false };
  return { text: `${head} · 바코드는 적어 둔 값을 그대로 뒀습니다. ERP 품목의 바코드는 ${itemBarcode}입니다.`, warning: true };
}

/** 옵션 표의 줄 하나를 선택창이 채울 때 필요한 것. 줄마다 다시 만들어 넘긴다(다른 옵션이 쓰는 품목은 지금 표 기준으로 가려야 한다). */
export interface ErpItemPickTarget {
  /** 줄의 키(옵션 표의 goodsOptionRowKey). */
  key: string;
  /** 선택창 설명에 넣을 대상(예: '옵션 2(파랑)'). */
  target: string;
  /** ERP 코드와 ERP 품명이 모두 비어 있는 줄인가. 이어서 고르기는 빈 줄로만 넘어간다. */
  empty: boolean;
  /** 이 줄에 들어 있는 ERP 코드. 선택창이 같은 품목의 줄에 '이 옵션에 넣은 품목'을 적는다. */
  currentCode?: string | null;
  /** 이 품목을 고를 수 없는 이유(같은 상품의 다른 옵션이 쓰는 품목). 고를 수 있으면 null. */
  blockedReason?: (item: ErpItemMatch) => string | null;
  onSelect: (item: ErpItemMatch) => void;
}

/** 표에서 `key` 줄 아래에 있는 첫 빈 줄. 없으면 null. */
export function nextEmptyErpPickTarget(queue: readonly ErpItemPickTarget[] | undefined, key: string | null): ErpItemPickTarget | null {
  if (!queue || key === null) return null;
  const from = queue.findIndex((entry) => entry.key === key);
  return from < 0 ? null : queue.slice(from + 1).find((entry) => entry.empty) ?? null;
}

const FILL_NOTE = 'ERP 코드와 ERP 품명이 고른 품목 값으로 바뀌고, 바코드는 칸이 비어 있을 때만 들어갑니다.';
/** 선택창 맨 위 글. 처음에는 무엇이 들어가는지, 이어서 고르는 동안에는 방금 넣은 것과 지금 고를 옵션을 말한다. */
export function erpItemPickDescription({ target, done, continues }: { target?: string; done?: string; continues: boolean }): string {
  if (done) return `${done} 이어서 ${target ?? '다음 옵션'}에 넣을 ERP 품목을 고릅니다.`;
  return `${target ? `${target}에 넣을 ERP 품목을 고릅니다. ` : ''}${FILL_NOTE}${continues ? ' 고르면 다음 빈 옵션으로 넘어갑니다.' : ''}`;
}

/** 옵션 표 하나가 함께 쓰는 것: 마지막으로 찾은 검색어. 줄마다 창을 새로 열어도 같은 검색어에서 시작한다. */
const ErpItemPickScopeContext = createContext<{ current: string } | null>(null);
export function ErpItemPickScope({ children }: { children: ReactNode }) {
  const lastQuery = useRef('');
  return <ErpItemPickScopeContext.Provider value={lastQuery}>{children}</ErpItemPickScopeContext.Provider>;
}

type PickSession = {
  /** 지금 채우는 줄. `queue`가 없으면 이 버튼의 줄뿐이라 null. */
  key: string | null;
  /** 창을 열 때의 검색어. */
  query: string;
  /** 이어서 고르는 동안 방금 넣은 것을 알리는 글. */
  done: string;
};

export function ErpItemPickButton({ target, ariaLabel, blockedReason, onSelect, rowText, currentCode, queue, queueKey }: {
  /** 선택창 설명에 넣을 대상(예: '옵션 2(파랑)'). 옵션 없는 상품은 주지 않는다. */
  target?: string;
  ariaLabel: string;
  /** 이 품목을 고를 수 없는 이유(같은 상품의 다른 옵션이 쓰는 품목). 고를 수 있으면 null. */
  blockedReason?: (item: ErpItemMatch) => string | null;
  onSelect: (item: ErpItemMatch) => void;
  /** 이 줄의 ERP 품명·ERP 코드 칸에 적힌 글. 있으면 그 글로 찾으며 창이 열린다. */
  rowText?: string;
  /** 이 줄에 들어 있는 ERP 코드. */
  currentCode?: string | null;
  /** 표의 모든 줄(위에서부터). 주면 고른 뒤 아래의 빈 줄로 이어서 고른다. `queueKey`는 이 버튼의 줄이다. */
  queue?: readonly ErpItemPickTarget[];
  queueKey?: string;
}) {
  /* 표가 기억하는 마지막 검색어. 누를 때 읽고 검색할 때 적는다(그리는 동안에는 읽지 않는다). */
  const lastQueryRef = useContext(ErpItemPickScopeContext);
  const [session, setSession] = useState<PickSession | null>(null);
  const close = () => setSession(null);
  /* 이어서 고르는 동안에는 지금 줄을 키로만 기억하고, 그 줄의 내용은 그릴 때마다 표에서 다시 읽는다(방금 넣은 품목이 다음 줄에서 '다른 옵션에 넣은 품목'으로 막힌다). */
  const moved = session && queue && session.key !== null && session.key !== queueKey ? queue.find((entry) => entry.key === session.key) ?? null : null;
  const lost = Boolean(session && queue && session.key !== null && session.key !== queueKey && !moved);
  const active = moved ?? { target, blockedReason, onSelect, currentCode };
  const upcoming = session ? nextEmptyErpPickTarget(queue, session.key) : null;
  return <>
    {/* 옵션 표의 좁은 칸에 들어간다. 칸보다 길면 넘치지 않고 두 줄로 접힌다(buttonVariants가 겹치는 높이·줄바꿈 클래스를 정리한다). */}
    <button type="button" className={buttonVariants({ variant: 'outline', size: 'xs', className: 'h-auto min-h-6 max-w-full py-0.5 whitespace-normal' })} data-slot="button" data-erp-item-picker="" aria-haspopup="dialog" aria-label={ariaLabel}
      onClick={() => setSession({ key: queueKey ?? null, query: rowText?.trim() || lastQueryRef?.current || '', done: '' })}>
      ERP 품목 고르기
    </button>
    {session && !lost ? <AdminPickerDialog<ErpItemMatch>
      description={erpItemPickDescription({ target: active.target, done: session.done, continues: Boolean(upcoming) })}
      emptyText="맞는 ERP 품목이 없습니다. ‘ERP 품목’ 메뉴에 올린 품목만 나옵니다. 없는 품목은 창을 닫고 ERP 코드·바코드·ERP 품명 칸에 직접 적습니다."
      initialQuery={session.query}
      load={async (request) => { if (lastQueryRef) lastQueryRef.current = request.query.trim(); return loadErpItems(request); }}
      /* 넘어갈 빈 줄이 있거나 이미 이어서 고르는 중이면 창을 [완료]로 닫는다. */
      multiple={Boolean(upcoming || session.done)}
      onClose={close}
      onSelect={(item) => {
        active.onSelect(item);
        /* 넘어갈 곳이 없으면 닫는다. 한 번 고르기는 선택창이 스스로 닫고, 이어서 고르던 창([완료]로 닫는 모양)은 여기서 닫는다. */
        if (!upcoming) { if (session.done) close(); return; }
        setSession({ key: upcoming.key, query: session.query, done: `${active.target ?? '옵션'}에 ‘${item.name}’ 품목을 넣었습니다.` });
      }}
      rowBlocked={active.blockedReason}
      rowKey={(item) => item.code}
      rowView={(item) => erpItemRowView(item, active.currentCode)}
      searchPlaceholder="ERP 품명·ERP 코드"
      title="ERP 품목 고르기"
    /> : null}
  </>;
}

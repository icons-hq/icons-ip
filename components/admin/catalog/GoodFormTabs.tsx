import type { ReactNode } from 'react';
import type { AdminFieldErrors } from '@/lib/admin/catalog';

/*
 * 상품 등록·편집 탭 7 (설계서 4-3).
 *
 * 탭은 화면 정리이지 폼 분리가 아니다 — 일곱 패널이 전부 한 <form> 안에 있고,
 * 안 보이는 패널은 `hidden` 으로 감출 뿐 값은 그대로 제출된다. 그래서 저장 실패 시
 * 오류가 난 필드가 어느 탭에 있는지 세어 배지로 알리고, 첫 오류 탭을 연다.
 */

export const GOOD_FORM_TABS = [
  { id: 'basic', label: '① 기본' },
  { id: 'sales', label: '② 판매' },
  { id: 'stock', label: '③ 옵션·재고' },
  { id: 'images', label: '④ 이미지' },
  { id: 'notice', label: '⑤ 제작·고시' },
  { id: 'shipping', label: '⑥ 배송·출고' },
  { id: 'exposure', label: '⑦ 노출' },
] as const;

export type GoodFormTabId = (typeof GOOD_FORM_TABS)[number]['id'];

const FIELD_TABS: Record<string, GoodFormTabId> = {
  id: 'basic',
  ipId: 'basic',
  name: 'basic',
  type: 'basic',
  description: 'basic',
  price: 'sales',
  compareAtPrice: 'sales',
  badge: 'sales',
  stock: 'sales',
  initialStockQty: 'stock',
  imagePath: 'images',
  detailImagePath: 'images',
};

/** 필드 이름이 속한 탭. 폼 전체 오류(`form`)처럼 탭이 없는 키는 null. */
export function goodFormTabForField(name: string): GoodFormTabId | null {
  if (name in FIELD_TABS) return FIELD_TABS[name];
  if (name.startsWith('galleryPath')) return 'images';
  if (name.startsWith('notice')) return 'notice';
  return null;
}

export function goodFormErrorCounts(errors: AdminFieldErrors | undefined): Record<GoodFormTabId, number> {
  const counts = Object.fromEntries(GOOD_FORM_TABS.map((tab) => [tab.id, 0])) as Record<GoodFormTabId, number>;
  for (const name of Object.keys(errors ?? {})) {
    const tab = goodFormTabForField(name);
    if (tab) counts[tab] += 1;
  }
  return counts;
}

/** 탭 순서 기준 첫 오류 탭. 필드 오류가 없으면 null. */
export function firstGoodFormErrorTab(errors: AdminFieldErrors | undefined): GoodFormTabId | null {
  const counts = goodFormErrorCounts(errors);
  return GOOD_FORM_TABS.find((tab) => counts[tab.id] > 0)?.id ?? null;
}

export function GoodFormTabList({
  active,
  errorCounts,
  idPrefix,
  onSelect,
}: {
  active: GoodFormTabId;
  errorCounts: Record<GoodFormTabId, number>;
  idPrefix: string;
  onSelect: (tab: GoodFormTabId) => void;
}) {
  return (
    <div aria-label="상품 등록 탭" className="admin-form-tabs" role="tablist">
      {GOOD_FORM_TABS.map((tab) => {
        const count = errorCounts[tab.id];
        return (
          <button
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            aria-selected={active === tab.id}
            className="admin-form-tab"
            id={`${idPrefix}-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
            {count > 0 ? (
              <span aria-label={`오류 ${count}건`} className="admin-form-tab-badge">{count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function GoodFormTabPanel({
  active,
  children,
  id,
  idPrefix,
}: {
  active: GoodFormTabId;
  children: ReactNode;
  id: GoodFormTabId;
  idPrefix: string;
}) {
  return (
    <div
      aria-labelledby={`${idPrefix}-tab-${id}`}
      className="admin-form-tabpanel col"
      hidden={active !== id}
      id={`${idPrefix}-panel-${id}`}
      role="tabpanel"
    >
      {children}
    </div>
  );
}

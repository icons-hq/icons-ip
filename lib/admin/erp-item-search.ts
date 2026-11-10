/*
 * 상품 옵션 ERP 품명 입력의 제안 검색 — 브라우저 상태와 분리한 순수 로직.
 *
 * 입력이 멈춘 뒤 250ms에 검색하고(2자 이상), 늦게 도착한 이전 검색 결과가
 * 최신 입력의 결과를 덮지 않게 요청마다 순번을 붙인다. 실패는 입력을 방해하지
 * 않도록 빈 제안으로만 처리한다.
 */
import { ERP_ITEM_SEARCH_MIN_LENGTH, ERP_ITEM_SUGGESTION_LIMIT, type ErpItemMatch } from './erp-items';

export const ERP_ITEM_SEARCH_DEBOUNCE_MS = 250;

export type ErpItemSearchResponse = { ok: true; items: ErpItemMatch[] } | { ok: false; error: string };

export interface ErpItemSearchScheduler {
  /** 입력이 바뀔 때마다 부른다. 2자 미만이면 대기 중인 검색을 버리고 제안을 비운다. */
  request(query: string): void;
  /** 선택·포커스 이탈·언마운트 때 부른다. 이미 보낸 검색의 결과도 버린다. */
  cancel(): void;
}

export function createErpItemSearchScheduler(options: {
  search: (query: string) => Promise<ErpItemSearchResponse>;
  onResults: (items: ErpItemMatch[], query: string) => void;
  delayMs?: number;
}): ErpItemSearchScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sequence = 0;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    request(raw) {
      clear();
      const ticket = ++sequence;
      const query = raw.trim();
      if (Array.from(query).length < ERP_ITEM_SEARCH_MIN_LENGTH) {
        options.onResults([], query);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        Promise.resolve()
          .then(() => options.search(query))
          .then(
            (result) => {
              if (ticket === sequence) options.onResults(result.ok ? result.items.slice(0, ERP_ITEM_SUGGESTION_LIMIT) : [], query);
            },
            () => {
              if (ticket === sequence) options.onResults([], query);
            },
          );
      }, options.delayMs ?? ERP_ITEM_SEARCH_DEBOUNCE_MS);
    },
    cancel() {
      clear();
      sequence += 1;
    },
  };
}

/** ↑↓로 제안을 순환한다. 제안이 없으면 -1. */
export function nextErpItemHighlight(current: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

export type ErpItemListPlacement =
  | { top: number; left: number; width: number; maxHeight: number }
  | { bottom: number; left: number; width: number; maxHeight: number };

/**
 * 제안 목록 위치. 옵션 표처럼 가로 스크롤 영역 안에서도 잘리지 않도록 화면 기준(fixed)으로 둔다.
 * 아래 공간이 좁고 위가 더 넓으면 입력 위로 연다.
 */
export function erpItemListPlacement(
  rect: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
): ErpItemListPlacement {
  const gap = 4;
  const margin = 8;
  const width = Math.min(Math.max(rect.width, 280), Math.max(160, viewport.width - margin * 2));
  const left = Math.max(margin, Math.min(rect.left, viewport.width - width - margin));
  const below = viewport.height - rect.bottom - gap - margin;
  const above = rect.top - gap - margin;
  if (below < 160 && above > below) return { bottom: viewport.height - rect.top + gap, left, width, maxHeight: Math.min(320, above) };
  return { top: rect.bottom + gap, left, width, maxHeight: Math.max(120, Math.min(320, below)) };
}

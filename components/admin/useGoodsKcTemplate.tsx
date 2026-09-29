'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { GoodsKcPresetTemplate } from '@/lib/admin/goods-notice-presets';

export interface GoodsKcTemplateRequest {
  id: string;
  template: GoodsKcPresetTemplate;
}
interface PendingTemplate extends GoodsKcTemplateRequest { goodId: string | null }
interface TemplateContext {
  pending: PendingTemplate | null;
  apply: (template: GoodsKcPresetTemplate | null, goodId: string | null) => void;
  bindSavedGood: (goodId: string) => void;
  consume: (id: string) => void;
  discard: () => void;
}
const Context = createContext<TemplateContext | null>(null);

/** Lives above the keyed goods form so first-save navigation can retain only
 * the classification draft. Evidence and review status never enter this state. */
export function GoodsKcTemplateProvider({ selectionKey, children }: { selectionKey: string; children: ReactNode }) {
  const [pending, setPending] = useState<PendingTemplate | null>(null);
  const [previousSelection, setPreviousSelection] = useState(selectionKey);
  if (selectionKey !== previousSelection) {
    setPreviousSelection(selectionKey);
    if (pending && selectionKey !== `good:${pending.goodId}`) setPending(null);
  }
  const apply = useCallback((template: GoodsKcPresetTemplate | null, goodId: string | null) => {
    setPending(template ? { id: crypto.randomUUID(), template, goodId } : null);
  }, []);
  const bindSavedGood = useCallback((goodId: string) => {
    setPending(current => current?.goodId === null ? { ...current, goodId } : current);
  }, []);
  const consume = useCallback((id: string) => {
    setPending(current => current?.id === id ? null : current);
  }, []);
  const discard = useCallback(() => setPending(null), []);
  return <Context.Provider value={{ pending, apply, bindSavedGood, consume, discard }}>{children}</Context.Provider>;
}

export function useGoodsKcTemplate(selectedId: string | null = null) {
  const context = useContext(Context);
  if (!context) throw new Error('GoodsKcTemplateProvider is required.');
  const { apply } = context;
  const applyToSelection = useCallback((template: GoodsKcPresetTemplate | null) => apply(template, selectedId), [apply, selectedId]);
  return {
    request: selectedId && context.pending?.goodId === selectedId ? context.pending : null,
    apply: applyToSelection,
    bindSavedGood: context.bindSavedGood,
    consume: context.consume,
    discard: context.discard,
  };
}

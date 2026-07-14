'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  deleteCartItemAction,
  setCartItemQuantityAction,
  syncCartAction,
} from '@/app/cart/actions';
import {
  CART_STORAGE_KEY,
  cartItemsAfterSignOut,
  cartQuantityTotal,
  parseStoredCart,
  serializeCart,
  setCartItemQuantity,
  type CartItem,
  type CartMode,
} from '@/lib/cart';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

const STOCK_ERROR = '현재 재고보다 많이 담을 수 없습니다.';

interface CartCtx {
  items: CartItem[];
  count: number;
  ready: boolean;
  mode: CartMode;
  pending: boolean;
  error: string | null;
  getQuantity: (goodId: string) => number;
  add: (goodId: string, stockQty: number) => Promise<void>;
  setQuantity: (goodId: string, qty: number, stockQty: number) => Promise<void>;
  remove: (goodId: string) => Promise<void>;
  refresh: () => Promise<void>;
  resetForSignOut: () => void;
}

const Ctx = createContext<CartCtx | null>(null);

function readLocalCart() {
  try {
    return parseStoredCart(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeLocalCart(items: readonly CartItem[]) {
  try {
    if (items.length) {
      window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(items));
    } else {
      window.localStorage.removeItem(CART_STORAGE_KEY);
    }
  } catch {
    // The in-memory cart remains usable when storage is unavailable.
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<CartMode>('local');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemsRef = useRef<CartItem[]>([]);
  const modeRef = useRef<CartMode>('local');
  const pendingRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const hydratedRef = useRef(false);
  const pendingLocalItemsRef = useRef<CartItem[]>([]);
  const lastPathnameRef = useRef(pathname);
  const operationVersionRef = useRef(0);

  const replaceItems = useCallback((next: CartItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const replaceMode = useCallback((next: CartMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const replacePending = useCallback((next: boolean) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const keepAsLocal = useCallback((next: CartItem[]) => {
    pendingLocalItemsRef.current = next;
    replaceItems(next);
    replaceMode('local');
    writeLocalCart(next);
  }, [replaceItems, replaceMode]);

  const sync = useCallback(async () => {
    if (!hydratedRef.current) return;
    if (pendingRef.current) {
      syncQueuedRef.current = true;
      return;
    }

    replacePending(true);
    setError(null);
    const operationVersion = operationVersionRef.current;
    const localItems = modeRef.current === 'local' ? pendingLocalItemsRef.current : [];

    try {
      const result = await syncCartAction(localItems);
      if (operationVersion !== operationVersionRef.current) return;
      if (!result.ok) {
        setError(result.error ?? '장바구니를 동기화하지 못했습니다.');
        return;
      }

      replaceItems(result.items);
      replaceMode(result.mode);
      if (result.mode === 'server') {
        pendingLocalItemsRef.current = [];
        writeLocalCart([]);
      } else {
        pendingLocalItemsRef.current = result.items;
        writeLocalCart(result.items);
      }
    } catch {
      if (operationVersion === operationVersionRef.current) {
        setError('장바구니를 동기화하지 못했습니다. 다시 시도해주세요.');
      }
    } finally {
      if (operationVersion === operationVersionRef.current) {
        replacePending(false);
        setReady(true);
        if (syncQueuedRef.current) {
          syncQueuedRef.current = false;
          window.setTimeout(() => void syncRef.current(), 0);
        }
      }
    }
  }, [replaceItems, replaceMode, replacePending]);

  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEffect(() => {
    let cancelled = false;
    const hydrationTimer = window.setTimeout(() => {
      if (cancelled) return;
      const stored = readLocalCart();
      pendingLocalItemsRef.current = stored;
      replaceItems(stored);
      hydratedRef.current = true;
      void syncRef.current();
    }, 0);

    if (!getSupabaseConfig().isConfigured) {
      return () => {
        cancelled = true;
        window.clearTimeout(hydrationTimer);
      };
    }
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION' || !hydratedRef.current) return;
      window.setTimeout(() => void syncRef.current(), 0);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(hydrationTimer);
      data.subscription.unsubscribe();
    };
  }, [replaceItems]);

  useEffect(() => {
    if (lastPathnameRef.current === pathname) return;
    lastPathnameRef.current = pathname;
    void sync();
  }, [pathname, sync]);

  const setQuantity = useCallback(async (goodId: string, qty: number, stockQty: number) => {
    if (!ready || pendingRef.current) return;
    if (qty > stockQty || (qty > 0 && stockQty <= 0)) {
      setError(STOCK_ERROR);
      return;
    }

    const previous = itemsRef.current;
    const next = setCartItemQuantity(previous, goodId, qty);
    setError(null);

    if (modeRef.current === 'local') {
      keepAsLocal(next);
      return;
    }

    replaceItems(next);
    replacePending(true);
    const operationVersion = operationVersionRef.current;
    try {
      const result = qty === 0
        ? await deleteCartItemAction(goodId)
        : await setCartItemQuantityAction(goodId, qty);

      if (operationVersion !== operationVersionRef.current) return;

      if (result.ok) {
        replaceItems(result.items);
        replaceMode(result.mode);
        return;
      }

      if (result.mode === 'local') {
        keepAsLocal(next);
        setError(result.error ?? null);
        return;
      }

      replaceItems(previous);
      setError(result.error ?? '장바구니를 저장하지 못했습니다.');
    } catch {
      if (operationVersion === operationVersionRef.current) {
        replaceItems(previous);
        setError('장바구니를 저장하지 못했습니다. 다시 시도해주세요.');
      }
    } finally {
      if (operationVersion === operationVersionRef.current) {
        replacePending(false);
        if (syncQueuedRef.current) {
          syncQueuedRef.current = false;
          window.setTimeout(() => void syncRef.current(), 0);
        }
      }
    }
  }, [keepAsLocal, ready, replaceItems, replaceMode, replacePending]);

  const add = useCallback(async (goodId: string, stockQty: number) => {
    const currentQty = itemsRef.current.find((item) => item.goodId === goodId)?.qty ?? 0;
    await setQuantity(goodId, currentQty + 1, stockQty);
  }, [setQuantity]);

  const remove = useCallback(async (goodId: string) => {
    await setQuantity(goodId, 0, Number.MAX_SAFE_INTEGER);
  }, [setQuantity]);

  const resetForSignOut = useCallback(() => {
    const localItems = cartItemsAfterSignOut(modeRef.current, pendingLocalItemsRef.current);
    operationVersionRef.current += 1;
    syncQueuedRef.current = false;
    pendingLocalItemsRef.current = localItems;
    replaceItems(localItems);
    replaceMode('local');
    replacePending(false);
    setError(null);
    setReady(true);
    writeLocalCart(localItems);
  }, [replaceItems, replaceMode, replacePending]);

  const count = cartQuantityTotal(items);

  const value = useMemo<CartCtx>(() => ({
    items,
    count,
    ready,
    mode,
    pending,
    error,
    getQuantity: (goodId) => items.find((item) => item.goodId === goodId)?.qty ?? 0,
    add,
    setQuantity,
    remove,
    refresh: sync,
    resetForSignOut,
  }), [add, count, error, items, mode, pending, ready, remove, resetForSignOut, setQuantity, sync]);

  return (
    <Ctx.Provider value={value}>
      <span className="cart-live-status" role="status" aria-live="polite" aria-atomic="true">
        {ready && !pending ? `장바구니 총 ${count}개` : ''}
      </span>
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCart must be used within CartProvider');
  return value;
}

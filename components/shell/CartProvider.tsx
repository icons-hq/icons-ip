'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface CartCtx {
  count: number;
  add: () => void;
  remove: () => void;
}

const Ctx = createContext<CartCtx>({ count: 0, add: () => {}, remove: () => {} });

export function CartProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  return (
    <Ctx.Provider
      value={{
        count,
        add: () => setCount((c) => c + 1),
        remove: () => setCount((c) => Math.max(0, c - 1)),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useCart = () => useContext(Ctx);

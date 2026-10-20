'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_STORE_PRESENTATION, type StorePresentation } from '@/lib/store-presentation';
const StorePresentationContext = createContext(DEFAULT_STORE_PRESENTATION);
export function StorePresentationProvider({ value, children }: { value: StorePresentation; children: ReactNode }) {
  return <StorePresentationContext.Provider value={value}>{children}</StorePresentationContext.Provider>;
}
export function useStorePresentation() { return useContext(StorePresentationContext); }

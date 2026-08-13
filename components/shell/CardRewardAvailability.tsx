'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchCardRewardsEnabled } from '@/lib/card-rewards/gate.client';

const CardRewardAvailabilityContext = createContext(false);

export function CardRewardAvailabilityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchCardRewardsEnabled().then((nextEnabled) => {
      if (active) setEnabled(nextEnabled);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <CardRewardAvailabilityContext.Provider value={enabled}>
      {children}
    </CardRewardAvailabilityContext.Provider>
  );
}

export function useCardRewardsEnabled() {
  return useContext(CardRewardAvailabilityContext);
}

'use client';

import { useEffect } from 'react';
import { updatePasswordPath } from '@/lib/auth/onboarding';

export function RecoverySessionBridge({ next }: { next: string }) {
  useEffect(() => {
    window.location.replace(updatePasswordPath(next));
  }, [next]);

  return (
    <main
      aria-busy="true"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '40px 24px',
        position: 'relative',
        zIndex: 2,
      }}
    >
      <p role="status" style={{ color: 'var(--dim)', fontSize: 14, fontWeight: 700 }}>
        재설정 세션을 확인하고 있습니다…
      </p>
    </main>
  );
}

'use client';

import { useEffect } from 'react';
import { updatePasswordPath } from '@/lib/auth/onboarding';

export function RecoverySessionBridge({ next }: { next: string }) {
  useEffect(() => {
    window.location.replace(updatePasswordPath(next));
  }, [next]);

  return (
    <main aria-busy="true" className="wc-root wc-auth">
      <div className="wc-auth__panel">
        <p className="wc-auth__lede" role="status">
          재설정 세션을 확인하고 있습니다…
        </p>
      </div>
    </main>
  );
}

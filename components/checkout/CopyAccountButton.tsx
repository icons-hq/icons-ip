'use client';

import { useState } from 'react';

/** 계좌번호 복사 버튼. 클립보드를 못 쓰면 직접 복사하도록 안내한다. */
export function CopyAccountButton({ value, label = '계좌번호 복사' }: { value: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{label}</button>
      <span className="money-caption" role="status" aria-live="polite">
        {status === 'copied' ? '복사했어요' : status === 'failed' ? '복사하지 못했어요. 직접 복사해주세요' : ''}
      </span>
    </>
  );
}

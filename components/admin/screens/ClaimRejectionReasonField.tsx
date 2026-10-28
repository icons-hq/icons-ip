'use client';

import { useId, useState } from 'react';
import { adminClaimRejectionPresets } from '@/lib/admin/claims';
import type { OrderClaimType } from '@/lib/orders/claims';

/*
 * 거부 사유 입력(R7). 자주 쓰는 사유를 고르면 사유 칸에 채워지고, 그대로 보내거나 고쳐 쓴다.
 * 프리셋은 요청 유형에 맞는 확정 문장만 보인다(lib/admin/claims.ts). 사유는 구매자에게 그대로
 * 전달되고, DB가 앞뒤 공백 없는 10~200자만 받는다.
 *
 * 상세 처리 패널의 거부 양식과 목록의 선택 건 거부가 같은 입력을 쓴다.
 */
export function ClaimRejectionReasonField({
  claimType,
  id,
  label,
  name = 'note',
  onChange,
  suppressEnter = false,
  value,
}: {
  claimType: OrderClaimType;
  id: string;
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  /** 한 양식에 버튼이 여럿일 때 사유 칸의 Enter가 첫 버튼을 누르지 않게 막는다. */
  suppressEnter?: boolean;
  value?: string;
}) {
  const presetId = useId();
  const [internal, setInternal] = useState('');
  const current = value ?? internal;
  const presets = adminClaimRejectionPresets(claimType);
  const set = (next: string) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };

  return <div className="admin-claim-reject-reason">
    <label htmlFor={presetId}>
      <span>자주 쓰는 거부 사유</span>
      <select id={presetId} onChange={(event) => { if (event.target.value) set(event.target.value); }} value={presets.includes(current) ? current : ''}>
        <option value="">직접 입력</option>
        {presets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
      </select>
    </label>
    <label htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        maxLength={200}
        name={name}
        onChange={(event) => set(event.target.value)}
        onKeyDown={suppressEnter
          ? (event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault(); }
          : undefined}
        type="text"
        value={current}
      />
    </label>
  </div>;
}

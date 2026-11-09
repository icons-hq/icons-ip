'use client';
import { useState } from 'react';
import { Input } from '@/components/admin/kit/ui/input';

/**
 * 원 단위 금액 칸. 평소에는 쉼표로(50,000) 읽히고, 고치는 동안에는 숫자만 보여 커서가 튀지 않는다.
 * 제출 값은 숨김 칸의 숫자 그대로라 서버 계약은 숫자 입력칸과 같다.
 */
export function WonInput({ id, name, value, defaultValue = '', onValueChange, 'aria-describedby': describedBy, 'aria-invalid': invalid }: {
  id: string; name: string;
  /** 주면 부모가 값을 소유한다. 안 주면 defaultValue로 시작해 칸이 값을 들고 있다. */
  value?: string; defaultValue?: string;
  onValueChange?: (value: string) => void;
  'aria-describedby'?: string; 'aria-invalid'?: boolean;
}) {
  const [own, setOwn] = useState(defaultValue);
  const [editing, setEditing] = useState(false);
  const raw = value ?? own;
  const shown = editing || !/^\d+$/.test(raw) ? raw : Number(raw).toLocaleString('ko-KR');
  return <>
    <input name={name} type="hidden" value={raw} />
    <Input
      aria-describedby={describedBy} aria-invalid={invalid} autoComplete="off" className="tabular-nums" id={id} inputMode="numeric" maxLength={16}
      onBlur={() => setEditing(false)}
      onChange={event => { const next = event.target.value.replace(/\D/g, ''); setOwn(next); onValueChange?.(next); }}
      onFocus={() => setEditing(true)}
      value={shown}
    />
  </>;
}

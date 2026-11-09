'use client';
import { useState } from 'react';
import { Input } from '@/components/admin/kit/ui/input';

/**
 * 붙여넣은 금액에서 쉼표·공백·통화 표시 같은 형식 문자만 뺀다. 소수점과 음수 기호는 남긴다 — 숫자만 골라내면
 * `5,000.00`이 `500000`으로, `-5000`이 `5000`으로 금액이 바뀐 채 저장된다. 남긴 값은 숫자가 아니어서 서버 검증이 거절한다.
 */
export function normalizeWonInput(value: string): string {
  return value.replace(/[^\d.-]/g, '');
}

/** 빈 값이거나 0 이상의 정수일 때만 맞는 금액이다. */
export function wonInputValid(value: string): boolean {
  return value === '' || /^\d+$/.test(value);
}

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
      aria-describedby={describedBy} aria-invalid={invalid || !wonInputValid(raw) || undefined} autoComplete="off" className="tabular-nums" id={id} inputMode="numeric" maxLength={16}
      onBlur={() => setEditing(false)}
      onChange={event => { const next = normalizeWonInput(event.target.value); setOwn(next); onValueChange?.(next); }}
      onFocus={() => setEditing(true)}
      value={shown}
    />
  </>;
}

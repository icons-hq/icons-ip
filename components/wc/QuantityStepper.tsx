'use client';

import { useState, type KeyboardEvent } from 'react';

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
  className?: string;
}

export function QuantityStepper({
  className,
  label = '수량',
  max,
  min = 1,
  onChange,
  value,
}: QuantityStepperProps) {
  /* 타이핑 중에는 '' 이나 '01' 같은 중간 상태가 정상이다. 매 키 입력마다 클램프해서
     부모로 올리면 지우는 순간 값이 min 으로 튀어 백스페이스가 먹히지 않는다.
     draft 가 있는 동안만 화면을 맡기고, 확정 시점(blur·Enter)에 한 번만 정리한다. */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  const clamp = (next: number) => {
    const lifted = Math.max(min, next);
    return max != null ? Math.min(max, lifted) : lifted;
  };

  const commit = () => {
    const parsed = Number.parseInt(shown, 10);
    const next = Number.isNaN(parsed) ? min : clamp(parsed);
    setDraft(null);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit();
  };

  /* 경계에서도 버튼을 실제 disabled 로 만들지 않는다. 초점을 잃고 사라지는 컨트롤이라
     시각적으로만 한계를 알리고, 클릭은 조용히 무시한다. */
  const atMin = value <= min;
  const atMax = max != null && value >= max;

  return (
    <div
      aria-label={label}
      className={`wc-stepper${className ? ` ${className}` : ''}`}
      role="group"
    >
      <button
        aria-label="수량 줄이기"
        className={`wc-stepper__btn${atMin ? ' is-limit' : ''}`}
        onClick={() => { if (!atMin) onChange(clamp(value - 1)); }}
        type="button"
      >
        −
      </button>
      <input
        aria-label={label}
        className="wc-stepper__input"
        inputMode="numeric"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        type="number"
        value={shown}
      />
      <button
        aria-label="수량 늘리기"
        className={`wc-stepper__btn${atMax ? ' is-limit' : ''}`}
        onClick={() => { if (!atMax) onChange(clamp(value + 1)); }}
        type="button"
      >
        +
      </button>
    </div>
  );
}

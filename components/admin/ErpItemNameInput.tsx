'use client';

import type { ErpItemMatch } from '@/lib/admin/erp-items';

export type ErpItemNameInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** 반입된 ERP 품목을 고르면 호출한다. 직접 입력만 한 경우에는 호출하지 않는다. */
  onSelect?: (item: ErpItemMatch) => void;
  ariaLabel: string;
  ariaDescribedBy?: string;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * 옵션별 ERP 품명 입력. props 시그니처는 상품 편집기와 ERP 품목 반입 작업이
 * 함께 쓰는 고정 계약이다. 검색·자동완성 구현은 ERP 품목 반입 작업이 채운다.
 */
export function ErpItemNameInput({ value, onChange, ariaLabel, ariaDescribedBy, maxLength, placeholder, disabled }: ErpItemNameInputProps) {
  return <input aria-label={ariaLabel} aria-describedby={ariaDescribedBy} value={value} maxLength={maxLength}
    placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
}

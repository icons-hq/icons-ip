'use client';

import { Field } from './fields';

/** 추가 설정의 진열 순서(고객 화면 '추천순' 자리). `goodId`는 저장된 상품의 번호이고 새 상품은 null이다. */
export function GoodDisplayOrderField({ defaultValue, error }: { defaultValue?: string | number | null; error?: string; goodId: string | null }) {
  return <Field defaultValue={defaultValue} error={error} label="진열 순서 (선택)" name="displayOrder" min={0} type="number" />;
}

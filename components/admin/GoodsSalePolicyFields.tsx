'use client';

import { useState } from 'react';
import { AdminFormGrid } from './console/AdminKit';
import { GoodEditorSection } from './GoodWorkspace';
import { Field, SelectField } from './fields';

export function GoodsSalePolicyFields({ values, errors, quantityReadOnly = false }: {
  values: Record<string, string>;
  quantityReadOnly?: boolean;
  errors?: Record<string, string>;
}) {
  const [orderLimit, setOrderLimit] = useState(values.orderQuantityLimitEnabled === 'true');
  const [memberLimit, setMemberLimit] = useState(values.memberPurchaseLimitEnabled === 'true');
  function choice(name: string, label: string, enabled: string, disabled: string) {
    return <SelectField name={name} label={label} defaultValue={values[name]} error={errors?.[name]} onChange={name === 'orderQuantityLimitEnabled' ? (event) => setOrderLimit(event.target.value === 'true') : name === 'memberPurchaseLimitEnabled' ? (event) => setMemberLimit(event.target.value === 'true') : undefined}>
      <option value="true">{enabled}</option><option value="false">{disabled}</option>
    </SelectField>;
  }
  return <GoodEditorSection defaultOpen={false} errorCount={Object.keys(errors ?? {}).filter(key => ['allowCardPayment', 'allowBankTransfer', 'saleRestriction', 'minOrderQty', 'maxOrderQty', 'memberLifetimeQtyLimit'].includes(key)).length} title="구매수량·결제 설정" id="good-section-sale" requirement="선택 · 적용 시 수량 입력 필요" status={Object.keys(errors ?? {}).some((key) => ['minOrderQty', 'maxOrderQty', 'memberLifetimeQtyLimit'].includes(key)) ? '확인 필요' : '설정 확인'} summary={`주문당 제한 ${orderLimit ? '적용' : '미적용'} · 회원 누적 제한 ${memberLimit ? '적용' : '미적용'}`} >
    <AdminFormGrid>
      {choice('allowCardPayment', '카드 결제', '허용', '받지 않음')}
      {choice('allowBankTransfer', '무통장 입금', '허용', '받지 않음')}
      <SelectField name="saleRestriction" label="판매 제한" defaultValue={values.saleRestriction} error={errors?.saleRestriction}>
        <option value="none">없음</option><option value="adult">성인(19금)</option>
      </SelectField>
    </AdminFormGrid>
    <p>함께 주문한 모든 상품이 허용하는 결제수단만 사용할 수 있습니다. 두 수단을 모두 닫으면 새 주문을 받지 않습니다. 실제 결제는 결제사·계좌 준비 상태도 확인합니다.</p>
    <p>성인(19금) 상품은 성인 인증을 마친 회원에게만 공개·판매됩니다. 성인 인증이 열리기 전에는 스토어에 노출되지 않습니다.</p>
    <fieldset disabled={quantityReadOnly} style={{ border: 0, padding: 0, margin: 0 }}><AdminFormGrid>
      {choice('orderQuantityLimitEnabled', '주문당 수량 제한', '적용', '사용 안 함')}
      <div hidden={!orderLimit && !errors?.minOrderQty && !errors?.maxOrderQty} className="admin-good-workspace__conditional">
      <Field name="minOrderQty" label="주문당 최소 수량" type="number" min={1} max={2147483647} defaultValue={values.minOrderQty} error={errors?.minOrderQty} />
      <Field name="maxOrderQty" label="주문당 최대 수량" type="number" min={1} max={2147483647} defaultValue={values.maxOrderQty} error={errors?.maxOrderQty} />
      </div>
      {!orderLimit && <p>주문당 수량 제한 미적용 · 입력한 최소·최대 수량은 보존됩니다.</p>}
      {choice('memberPurchaseLimitEnabled', '회원 누적 구매 제한', '적용', '사용 안 함')}
      <div hidden={!memberLimit && !errors?.memberLifetimeQtyLimit}>
      <Field name="memberLifetimeQtyLimit" label="회원 누적 최대 수량" type="number" min={1} max={2147483647} defaultValue={values.memberLifetimeQtyLimit} error={errors?.memberLifetimeQtyLimit} />
      </div>
      {!memberLimit && <p>회원 누적 구매 제한 미적용 · 입력한 한도는 보존됩니다.</p>}
    </AdminFormGrid>
    </fieldset>{quantityReadOnly ? ['orderQuantityLimitEnabled','minOrderQty','maxOrderQty','memberPurchaseLimitEnabled','memberLifetimeQtyLimit'].map(name => <input key={name} type="hidden" name={name} value={values[name] ?? ''} />) : null}
    <p>수량은 같은 상품의 모든 옵션을 합산합니다. 제한을 적용하려면 해당 수치를 모두 입력해주세요. 제한을 끄면 입력한 수치는 보존됩니다.</p>
    <p>회원 한도에는 과거 구매와 결제 대기 중인 주문도 포함합니다. 전액 취소·환불 처리가 완료된 주문 수량은 제외합니다.</p>
  </GoodEditorSection>;
}

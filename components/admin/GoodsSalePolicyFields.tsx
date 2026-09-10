import { AdminFormGrid, AdminSectionCard } from './console/AdminKit';
import { Field, SelectField } from './fields';

export function GoodsSalePolicyFields({ values, errors }: {
  values: Record<string, string>;
  errors?: Record<string, string>;
}) {
  function choice(name: string, label: string, enabled: string, disabled: string) {
    return <SelectField name={name} label={label} defaultValue={values[name]} error={errors?.[name]}>
      <option value="true">{enabled}</option><option value="false">{disabled}</option>
    </SelectField>;
  }
  return <AdminSectionCard title="결제·구매 조건">
    <AdminFormGrid>
      {choice('allowCardPayment', '카드 결제', '허용', '받지 않음')}
      {choice('allowBankTransfer', '무통장 입금', '허용', '받지 않음')}
      <SelectField name="saleRestriction" label="판매 제한" defaultValue={values.saleRestriction} error={errors?.saleRestriction}>
        <option value="none">없음</option><option value="adult">성인(19금)</option>
      </SelectField>
    </AdminFormGrid>
    <p>함께 주문한 모든 상품이 허용하는 결제수단만 사용할 수 있습니다. 두 수단을 모두 닫으면 새 주문을 받지 않습니다. 실제 결제는 결제사·계좌 준비 상태도 확인합니다.</p>
    <p>성인(19금) 상품은 성인인증을 도입하기 전까지 공개되지 않고 구매가 차단됩니다.</p>
    <AdminFormGrid>
      {choice('orderQuantityLimitEnabled', '주문당 수량 제한', '적용', '사용 안 함')}
      <Field name="minOrderQty" label="주문당 최소 수량" type="number" min={1} max={2147483647} defaultValue={values.minOrderQty} error={errors?.minOrderQty} />
      <Field name="maxOrderQty" label="주문당 최대 수량" type="number" min={1} max={2147483647} defaultValue={values.maxOrderQty} error={errors?.maxOrderQty} />
      {choice('memberPurchaseLimitEnabled', '회원 누적 구매 제한', '적용', '사용 안 함')}
      <Field name="memberLifetimeQtyLimit" label="회원 누적 최대 수량" type="number" min={1} max={2147483647} defaultValue={values.memberLifetimeQtyLimit} error={errors?.memberLifetimeQtyLimit} />
    </AdminFormGrid>
    <p>수량은 같은 상품의 모든 옵션을 합산합니다. 제한을 적용하려면 해당 수치를 모두 입력해주세요. 제한을 끄면 입력한 수치는 보존됩니다.</p>
    <p>회원 한도에는 과거 구매와 결제 대기 중인 주문도 포함합니다. 전액 취소·환불 처리가 완료된 주문 수량은 제외합니다.</p>
  </AdminSectionCard>;
}

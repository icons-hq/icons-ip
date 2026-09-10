import { Field, SelectField, TextArea } from './fields';
import { AdminFormGrid, AdminSectionCard } from './console/AdminKit';

export function GoodsClaimPolicyFields({ values, errors }: { values: Record<string, string>; errors?: Record<string, string> }) {
  return <AdminSectionCard title="교환·반품 조건과 안내비">
    <p className="muted">미확인 비용은 비워두고, 확인된 무료 비용만 0원으로 입력하세요. 고객 귀책 비용의 안내이며 실제 청구·환불 차감은 하지 않습니다. 조건 문구로 고객센터 접수나 법정 권리를 제한하지 않습니다.</p>
    <AdminFormGrid>
      {(['claimReturnAllowed', 'claimExchangeAllowed'] as const).map((name) => <SelectField key={name} defaultValue={values[name]} error={errors?.[name]} name={name} label={name === 'claimReturnAllowed' ? '반품 조건' : '교환 조건'}>
        <option value="">미검토 · 기본 정책 확인</option><option value="true">기본 정책에 따라 가능</option><option value="false">제한 사유와 개별 확인 필요</option>
      </SelectField>)}
      <Field defaultValue={values.claimReturnFee} error={errors?.claimReturnFee} label="고객 귀책 반품비 · 편도 (원)" name="claimReturnFee" type="number" min={0} />
      <Field defaultValue={values.claimReturnFreeShippingFee} error={errors?.claimReturnFreeShippingFee} label="최초 무료배송 후 반품비 · 왕복 합계 (원)" name="claimReturnFreeShippingFee" type="number" min={0} />
      <Field defaultValue={values.claimExchangeFee} error={errors?.claimExchangeFee} label="고객 귀책 교환비 · 왕복 합계 (원)" name="claimExchangeFee" type="number" min={0} />
    </AdminFormGrid>
    <TextArea defaultValue={values.claimRestrictionReason} error={errors?.claimRestrictionReason} label="제한 사유와 적용 조건" name="claimRestrictionReason" />
  </AdminSectionCard>;
}

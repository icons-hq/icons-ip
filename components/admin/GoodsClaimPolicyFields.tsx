import Link from 'next/link';
import { Field, SelectField, TextArea } from './fields';
import { AdminFormGrid } from './console/AdminKit';
import { GoodFoldedRow } from './GoodWorkspace';
import { RETURN_ADDRESSES_PATH, returnAddressOptionLabel, type ReturnAddressOption } from '@/lib/admin/return-addresses';

const CLAIM_FIELDS = ['claimReturnAllowed', 'claimExchangeAllowed', 'claimReturnFee', 'claimReturnFreeShippingFee', 'claimExchangeFee', 'claimRestrictionReason', 'claimReturnAddressId'];
const claimLabel = (value: string | undefined) => value === 'true' ? '기본 정책 가능' : value === 'false' ? '개별 확인 필요' : '기본 정책 확인';

/*
 * 상품의 반품·교환 조건과 반품/교환지(S36-040·S36-044). 반품/교환지는 주소록에서 고르고, 비우면 출고지 반품 주소를
 * 쓴다. 반품을 승인할 때의 반품지가 회수 주소로 고정된다. 조건은 고객 상세에 '교환·반품 가능' 또는 '교환·반품
 * 제한(사유)'로 보이지만 고객의 신청을 막지 않는다(하자·오배송은 제한할 수 없다).
 */
export function GoodsClaimPolicyFields({ values, current, errors, returnAddresses = [] }: {
  values: Record<string, string>; current?: Record<string, string>; errors?: Record<string, string>;
  returnAddresses?: readonly ReturnAddressOption[];
}) {
  const live = current ?? values;
  const selectedPlace = returnAddresses.find((entry) => entry.id === live.claimReturnAddressId);
  /* 저장된 반품지가 주소록 선택지에 없으면(다른 탭에서 지운 직후 등) 값을 잃지 않게 그대로 선택지로 둔다. */
  const unknownSaved = values.claimReturnAddressId && !returnAddresses.some((entry) => entry.id === values.claimReturnAddressId);
  return <GoodFoldedRow title="반품·교환" id="good-section-claims" isDefault={CLAIM_FIELDS.every((name) => !live[name]?.trim())}
    summary={`반품 ${claimLabel(live.claimReturnAllowed)} · 교환 ${claimLabel(live.claimExchangeAllowed)} · 반품지 ${selectedPlace?.name ?? '출고지 반품 주소'}`}
    errorCount={Object.keys(errors ?? {}).filter(key => key.startsWith('claim')).length}>
    <p className="text-sm text-muted-foreground">미확인 비용은 비워두고, 확인된 무료 비용만 0원으로 입력하세요. 고객 귀책 비용의 안내이며 실제 청구·환불 차감은 하지 않습니다. 조건 문구로 고객센터 접수나 법정 권리를 제한하지 않습니다.</p>
    <AdminFormGrid>
      {(['claimReturnAllowed', 'claimExchangeAllowed'] as const).map((name) => <SelectField key={name} defaultValue={values[name]} error={errors?.[name]} name={name} label={name === 'claimReturnAllowed' ? '반품 조건' : '교환 조건'}>
        <option value="">미검토 · 기본 정책 확인</option><option value="true">기본 정책에 따라 가능</option><option value="false">제한 사유와 개별 확인 필요</option>
      </SelectField>)}
      <Field defaultValue={values.claimReturnFee} error={errors?.claimReturnFee} label="고객 귀책 반품비 · 편도 (원)" name="claimReturnFee" type="number" min={0} />
      <Field defaultValue={values.claimReturnFreeShippingFee} error={errors?.claimReturnFreeShippingFee} label="최초 무료배송 후 반품비 · 왕복 합계 (원)" name="claimReturnFreeShippingFee" type="number" min={0} />
      <Field defaultValue={values.claimExchangeFee} error={errors?.claimExchangeFee} label="고객 귀책 교환비 · 왕복 합계 (원)" name="claimExchangeFee" type="number" min={0} />
      <SelectField defaultValue={values.claimReturnAddressId} error={errors?.claimReturnAddressId} name="claimReturnAddressId" label="반품/교환지">
        <option value="">출고지 반품 주소 사용 (기본)</option>
        {unknownSaved ? <option value={values.claimReturnAddressId}>저장된 반품지 · 주소록에서 확인 필요</option> : null}
        {returnAddresses.map((entry) => <option key={entry.id} value={entry.id}>{returnAddressOptionLabel(entry)}</option>)}
      </SelectField>
    </AdminFormGrid>
    <p className="text-sm text-muted-foreground" data-good-return-address-hint="">
      반품/교환지를 비우면 이 상품의 출고지 반품 주소를 씁니다. 반품을 승인할 때의 반품지가 회수 주소로 고정되고, 같은 배송 건이라도 반품지가 다르면 회수를 나눠 받습니다.
      반품지는 <Link className="underline underline-offset-2" href={RETURN_ADDRESSES_PATH}>반품/교환지 관리</Link>에서 등록합니다.
    </p>
    <TextArea defaultValue={values.claimRestrictionReason} error={errors?.claimRestrictionReason} label="제한 사유와 적용 조건" name="claimRestrictionReason" />
    <p className="text-sm text-muted-foreground">반품이나 교환 조건을 &lsquo;제한&rsquo;으로 고르면 고객 상세에 &lsquo;교환·반품 제한(사유)&rsquo;이 보이고, 아니면 &lsquo;교환·반품 가능&rsquo;이 보입니다. 제한 상품도 고객의 신청은 접수되고, 하자·오배송은 제한할 수 없다는 안내가 함께 보입니다.</p>
  </GoodFoldedRow>;
}

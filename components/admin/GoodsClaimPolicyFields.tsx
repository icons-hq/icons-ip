import Link from 'next/link';
import { Field, SelectField, TextArea } from './fields';
import { AdminFormGrid } from './console/AdminKit';
import { GoodFoldedRow } from './GoodWorkspace';
import { RETURN_ADDRESSES_PATH, returnAddressOptionLabel, type ReturnAddressOption } from '@/lib/admin/return-addresses';
import { GOOD_FIELDS_A_HELP } from '@/lib/admin/help/good-fields-a';

const CLAIM_FIELDS = ['claimReturnAllowed', 'claimExchangeAllowed', 'claimReturnFee', 'claimReturnFreeShippingFee', 'claimExchangeFee', 'claimRestrictionReason', 'claimReturnAddressId'];
/* 선택지 이름은 배송정보 템플릿 화면(ShippingSettingsTemplateForm)·사용 가이드와 같은 말이다. 한쪽만 바꾸면 같은 것이 두 이름이 된다. */
const claimLabel = (value: string | undefined) => value === 'true' ? '기본 정책 가능' : value === 'false' ? '개별 확인 필요' : '기본 정책 확인';
/** 비용 칸을 비우면 고객 상세에 '확인 후 안내'로 보인다(GoodAdditionalInfo). 무료로 확인된 비용만 0을 넣는다. */
const FEE_PLACEHOLDER = "비우면 '확인 후 안내', 무료면 0";

/*
 * 상품의 반품·교환 조건과 반품/교환지(S36-040·S36-044). 반품/교환지는 주소록에서 고르고, 비우면 출고지 반품 주소를
 * 쓴다. 반품을 승인할 때의 반품/교환지가 회수 주소로 고정된다. 조건은 고객 상세에 '교환·반품 가능' 또는 '교환·반품
 * 제한(사유)'로 보이지만 고객의 신청을 막지 않는다(하자·오배송은 제한할 수 없다).
 */
export function GoodsClaimPolicyFields({ values, current, errors, returnAddresses = [] }: {
  values: Record<string, string>; current?: Record<string, string>; errors?: Record<string, string>;
  returnAddresses?: readonly ReturnAddressOption[];
}) {
  const live = current ?? values;
  const selectedPlace = returnAddresses.find((entry) => entry.id === live.claimReturnAddressId);
  /* 저장된 반품/교환지가 주소록 선택지에 없으면(다른 탭에서 지운 직후 등) 값을 잃지 않게 그대로 선택지로 둔다. */
  const unknownSaved = values.claimReturnAddressId && !returnAddresses.some((entry) => entry.id === values.claimReturnAddressId);
  return <GoodFoldedRow title="반품·교환" id="good-section-claims" isDefault={CLAIM_FIELDS.every((name) => !live[name]?.trim())}
    summary={`반품 ${claimLabel(live.claimReturnAllowed)} · 교환 ${claimLabel(live.claimExchangeAllowed)} · 반품/교환지 ${selectedPlace?.name ?? '출고지 반품 주소'}`}
    errorCount={Object.keys(errors ?? {}).filter(key => key.startsWith('claim')).length}>
    <p className="text-sm text-muted-foreground">여기 적은 조건과 금액은 상품 상세에 보이는 안내입니다. 실제로 받거나 환불에서 빼는 금액이 아닙니다. 환불에서 빼는 반품배송비는 따로 정한 정책 금액을 씁니다.</p>
    <AdminFormGrid>
      {(['claimReturnAllowed', 'claimExchangeAllowed'] as const).map((name) => <SelectField key={name} defaultValue={values[name]} error={errors?.[name]} name={name} label={name === 'claimReturnAllowed' ? '반품 조건' : '교환 조건'}>
        <option value="">미검토 · 기본 정책 확인</option><option value="true">기본 정책에 따라 가능</option><option value="false">제한 사유와 개별 확인 필요</option>
      </SelectField>)}
      <Field defaultValue={values.claimReturnFee} error={errors?.claimReturnFee} label="고객 귀책 반품비 · 편도 (원)" name="claimReturnFee" type="number" min={0} placeholder={FEE_PLACEHOLDER} help={GOOD_FIELDS_A_HELP.claimFees} />
      <Field defaultValue={values.claimReturnFreeShippingFee} error={errors?.claimReturnFreeShippingFee} label="최초 무료배송 후 반품비 · 왕복 합계 (원)" name="claimReturnFreeShippingFee" type="number" min={0} placeholder={FEE_PLACEHOLDER} />
      <Field defaultValue={values.claimExchangeFee} error={errors?.claimExchangeFee} label="고객 귀책 교환비 · 왕복 합계 (원)" name="claimExchangeFee" type="number" min={0} placeholder={FEE_PLACEHOLDER} />
      <SelectField defaultValue={values.claimReturnAddressId} error={errors?.claimReturnAddressId} name="claimReturnAddressId" label="반품/교환지">
        <option value="">출고지 반품 주소 사용 (기본)</option>
        {unknownSaved ? <option value={values.claimReturnAddressId}>저장된 반품/교환지 · 주소록에서 확인 필요</option> : null}
        {returnAddresses.map((entry) => <option key={entry.id} value={entry.id}>{returnAddressOptionLabel(entry)}</option>)}
      </SelectField>
    </AdminFormGrid>
    <p className="text-sm text-muted-foreground" data-good-return-address-hint="">
      반품을 승인하면 그때의 반품/교환지가 회수 주소로 정해집니다. 반품/교환지는 <Link className="underline underline-offset-2" href={RETURN_ADDRESSES_PATH}>반품/교환지 관리</Link>에서 등록합니다.
    </p>
    <TextArea defaultValue={values.claimRestrictionReason} error={errors?.claimRestrictionReason} label="제한 사유와 적용 조건" name="claimRestrictionReason" placeholder="예: 포장을 뜯으면 반품할 수 없습니다" />
    <p className="text-sm text-muted-foreground">제한으로 정해도 고객의 신청은 접수되고, 하자·오배송은 제한할 수 없습니다. 상세에는 제한일 때만 &lsquo;교환·반품 제한(사유)&rsquo;이, 나머지는 &lsquo;교환·반품 가능&rsquo;이 보입니다.</p>
  </GoodFoldedRow>;
}

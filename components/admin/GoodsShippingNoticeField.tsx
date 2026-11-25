import Link from 'next/link';
import type { ShippingNoticeSnapshot } from '@/lib/fulfillment';
import { SelectField } from './fields';

export type GoodsShippingNoticeOption = Omit<ShippingNoticeSnapshot, 'templateId'> & { id: string };

/**
 * 상품 상세의 배송·교환·반품 안내 글(템플릿)을 고른다. 값은 `코드@버전`으로 제출하지만 화면에는 이름만 보인다(화면 규칙 8).
 * `currentName`은 지금 상품에 적용 중인 안내의 이름이다. 목록에 없는 옛 안내가 적용 중이어도 저장하면 그대로 이어지게 선택지로 남긴다.
 */
export function GoodsShippingNoticeField({ options, value, error, currentName }: {
  options: GoodsShippingNoticeOption[]; value: string; error?: string; currentName?: string | null;
}) {
  const currentIsListed = !value || options.some((option) => `${option.code}@${option.version}` === value);
  return <div className="flex min-w-0 flex-col gap-2" data-goods-shipping-notice="">
    <SelectField defaultValue={value} error={error} label="배송·교환·반품 안내 템플릿" name="shippingNoticeTemplate">
      <option value="">기본 안내 사용</option>
      {!currentIsListed && <option value={value}>{currentName ? `${currentName} (지금 적용 중)` : '지금 적용 중인 안내'}</option>}
      {options.map((option) => <option key={option.id} value={`${option.code}@${option.version}`}>{option.name}</option>)}
    </SelectField>
    <p className="text-xs leading-relaxed text-muted-foreground">확인이 끝난 템플릿만 고를 수 있습니다. 배송비와 회수 주소는 출고지 설정을 따릅니다. <Link className="font-medium text-foreground underline underline-offset-4" href="/admin/settings/shipping-notices">템플릿 관리</Link></p>
  </div>;
}

import Link from 'next/link';
import type { ShippingNoticeSnapshot } from '@/lib/fulfillment';
import { SelectField } from './fields';

export type GoodsShippingNoticeOption = Omit<ShippingNoticeSnapshot, 'templateId'> & { id: string };

export function GoodsShippingNoticeField({ options, value, error }: {
  options: GoodsShippingNoticeOption[]; value: string; error?: string;
}) {
  const currentIsListed = !value || options.some((option) => `${option.code}@${option.version}` === value);
  return <div className="col" style={{ gap: 8 }}>
    <SelectField defaultValue={value} error={error} label="배송·교환·반품 안내 템플릿" name="shippingNoticeTemplate">
      <option value="">기본 안내 사용</option>
      {!currentIsListed && <option value={value}>{value} · 현재 적용 버전</option>}
      {options.map((option) => <option key={option.id} value={`${option.code}@${option.version}`}>{option.name} · {option.code} v{option.version}</option>)}
    </SelectField>
    <p className="muted" style={{ margin: 0, fontSize: 12 }}>확인이 끝난 버전만 적용할 수 있습니다. 배송비와 회수 주소는 출고지 설정을 따릅니다. <Link href="/admin/settings/shipping-notices">템플릿 관리</Link></p>
  </div>;
}

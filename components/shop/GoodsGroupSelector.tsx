import Link from 'next/link';
import { goodsGroupAxisChoices, type PublicGoodsGroup } from '@/lib/goods-groups';

export function GoodsGroupSelector({ group }: { group: PublicGoodsGroup | null | undefined }) {
  if (!group || group.members.length < 2) return null;
  return <section aria-label={`${group.name} 판매옵션`} className="wc-goods-group">
    {group.optionNames.map((axis, index) => <fieldset className="wc-goods-group__axis" key={axis}>
      <legend>{axis}</legend>
      <div className="wc-goods-group__values">
        {goodsGroupAxisChoices(group, index).map(({ value, destination, selected }) => <Link
          key={value} href={`/shop/${destination.goodId}`} prefetch={false}
          className="wc-goods-group__value" aria-current={selected ? 'true' : undefined}
          aria-label={`${group.optionNames.map((name, i) => `${name} ${destination.values[i]}`).join(', ')} 굿즈 보기`}>
          {value}
        </Link>)}
      </div>
    </fieldset>)}
    <p className="wc-goods-group__note">판매옵션을 선택하면 해당 굿즈로 이동합니다.</p>
  </section>;
}

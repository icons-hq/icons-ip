import type { GoodsBenefitValues } from '@/lib/goods-benefits';
import { publicMediaUrl } from '@/lib/media';

export function GoodsBenefitContent({ value }: { value: GoodsBenefitValues | null }) {
  if (!value || (!value.eventText && !value.giftText)) return null;
  return <section className="wc-goods-benefits" aria-label="굿즈 혜택 안내">
    {value.eventText ? <div><h2>이벤트</h2><p>{value.eventText}</p></div> : null}
    {value.giftText ? <div><h2>사은품</h2><div><p>{value.giftText}</p>{value.giftImagePaths.length ? <ul>{value.giftImagePaths.map((path, index) => {
      const url = publicMediaUrl(path); return url ? <li key={path}><a href={url} target="_blank" rel="noreferrer" aria-label={`사은품 이미지 ${index + 1} 새 창에서 보기`}>
        {/* Storage 이미지는 기존 상품 이미지와 동일하게 공개 원본 URL을 사용한다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`사은품 ${index + 1}`} width={72} height={72} loading="lazy" />
      </a></li> : null;
    })}</ul> : null}</div></div> : null}
  </section>;
}

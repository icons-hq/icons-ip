/* eslint-disable @next/next/no-img-element -- Verified artwork keeps its intrinsic aspect ratio. */
import Link from 'next/link';
import { hrefFor } from '@/lib/routes';
import { publicMediaUrl } from '@/lib/media';
import { PriceBlock } from '@/components/wc/PriceBlock';
import type { MarketingContent, MarketingProduct } from '@/lib/admin/marketing-messages';
import type { MarketingCoupon } from '@/lib/admin/marketing-coupons';
import { MarketingCouponAttachment } from './MarketingCouponAttachment';
export function MarketingMessageContent({content,goods=[],coupon,preview=false,imagePreview,productNames={}}:{content:MarketingContent;goods?:MarketingProduct[];coupon?:MarketingCoupon|null;preview?:boolean;imagePreview?:string|null;productNames?:Record<string,string>}){
 const image=imagePreview??(content.imagePath?publicMediaUrl(content.imagePath):null);
 return <article className={`wc-marketing-message wc-marketing-message--${content.template}`}>
  <span className="wc-marketing-message__brand">ICONS · 마케팅 소식</span><h2>{content.title||'메시지 제목'}</h2><p className="wc-marketing-message__body">{content.body||'메시지 내용을 입력해주세요.'}</p>
  {image&&<div className="wc-marketing-message__image">{/* Verified static artwork preserves its original aspect ratio. */}
   <img src={image} alt="메시지 이미지" /></div>}
  {content.goodIds.length>0&&<div className="wc-marketing-message__products">{(preview?content.goodIds:goods.map(g=>g.id)).map((id,index)=>{const good=goods.find(g=>g.id===id);return <div className="wc-marketing-message__product" key={id}>{good?.imageUrl&&
   <img src={good.imageUrl} alt="" />}{preview?<strong>{good?.name??productNames[id]??`선택한 상품 ${index+1}`}</strong>:<Link href={`${hrefFor('shop')}/${id}`}>{good?.name}</Link>}{good&&<PriceBlock price={good.price} priceMax={good.priceMax} compareAtPrice={good.compareAtPrice} />}</div>;})}</div>}
  {!preview&&content.goodIds.length>0&&goods.length===0&&<p>현재 표시할 수 있는 굿즈가 없습니다.</p>}
  {content.couponCode&&<MarketingCouponAttachment key={content.couponCode} code={content.couponCode} coupon={coupon} preview={preview} />}
  {!!content.buttons.length&&<div className="wc-marketing-message__buttons">{content.buttons.map((button,index)=>preview?<span key={index}>{button.label||'버튼 이름'}</span>:<Link key={index} href={button.path}>{button.label}</Link>)}</div>}
 </article>;
}

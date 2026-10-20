import type { GoodsMediaAsset } from '@/lib/goods-media';
import { GoodsVideoPlayer } from './GoodsVideoPlayer';
export function ProductShortclips({ clip, fallbackBackground }: { clip: GoodsMediaAsset; fallbackBackground: string }) {
  return <section className="wc-product-shortclips" aria-labelledby="product-shortclips-heading"><h2 id="product-shortclips-heading">숏클립으로 살펴보기</h2><div><GoodsVideoPlayer asset={clip} fallbackBackground={fallbackBackground} /><p>{clip.title}</p></div></section>;
}

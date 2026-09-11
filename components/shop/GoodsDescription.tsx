import { sanitizeGoodsDescription, type GoodsDescriptionFormat } from '@/lib/goods-description';

export function GoodsDescription({ description, format = 'plain', imagePaths = [] }: {
  description: string | null;
  format?: GoodsDescriptionFormat;
  imagePaths?: readonly string[];
}) {
  if (!description) return null;
  if (format !== 'html') return <p className="wc-pdp-panel__desc" style={{ whiteSpace: 'pre-wrap' }}>{description}</p>;
  const { html } = sanitizeGoodsDescription(description, { imagePaths, renderImages: true });
  return <div className="wc-goods-description" dangerouslySetInnerHTML={{ __html: html }} />;
}

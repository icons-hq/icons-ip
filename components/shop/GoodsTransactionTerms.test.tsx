import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { Good } from '@/lib/data';
import { GoodsTransactionTerms } from './GoodsTransactionTerms';

const good = { id: 'g13', name: '아크릴 블록', ip: 'hong-sil-quest', type: '아크릴', price: 12000, badge: null, stock: 'ok' as const, stockQty: 8, img: '' } satisfies Good;

/* R26: 고객 화면은 '출고지'를 말하지 않는다 — 묶음배송 조건도 배송 묶음으로 말한다. */
it('묶음배송 조건은 출고지 대신 배송 묶음으로 말한다', () => {
  for (const regionalMode of ['inherit', 'override'] as const) {
    const html = renderToStaticMarkup(<GoodsTransactionTerms quantity={1} good={{ ...good, transactionOffer: { goodId: good.id, volume: null, delivery: null, collectReady: false, collector: null,
      chargeGroup: { id: '00000000-0000-4000-8000-000000000009', revision: 1, calculationMode: 'max', regionalMode, available: true, inherited: false } } }} />);
    expect(html).toContain('같은 배송 묶음의 묶음 대상 굿즈를 함께 구매하면');
    expect(html).not.toContain('출고지');
  }
});

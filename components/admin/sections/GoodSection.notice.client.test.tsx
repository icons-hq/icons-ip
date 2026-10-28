import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';

/* GoodSection을 함수로 불러 운영 패널에 넘기는 값을 본다. 상태 훅은 호출 순서대로 흉내 낸다. */
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }]; },
}));
vi.mock('../useGoodsKcTemplate', () => ({ useGoodsKcTemplate: () => ({ request: null, apply: vi.fn(), bindSavedGood: vi.fn(), consume: vi.fn(), discard: vi.fn() }) }));
import { GOOD_OPERATION_LOCKED_POINTER, GOOD_UNSAVED_BASE_COPY, GoodOperationDisabledNotice } from '../GoodWorkspace';
import { GoodEditor } from '../GoodEditor';
import { GoodsFulfillmentPanel } from '../GoodsFulfillmentPanel';
import { GoodsProductionPanel } from '../GoodsProductionPanel';
import { GoodsSubscriptionPolicyPanel } from '../GoodsSubscriptionPolicyPanel';
import { GoodsTransactionTermsPanel } from '../GoodsTransactionTermsPanel';
import { GoodShippingChargeGroupPanel } from '../GoodShippingChargeGroupPanel';
import { GoodsOptionSaleModePanel } from '../GoodsOptionSaleModePanel';
import { GoodSection } from './GoodSection';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const good = { id: 'notice-good', code: 'NOTICE-GOOD', ipId: 'notice-ip', name: 'TEST 잠금 안내', type: '문구', price: 10000, compareAtPrice: null, badge: null,
  publishedAt: null, firstPublishedAt: null, archivedAt: null, stock: 'ok', stockQty: 1, bg: null, imagePath: null, imageUrl: null,
  galleryPaths: [], galleryUrls: [], detailImagePath: null, detailImageUrl: null, description: '' } as unknown as AdminGoodRecord;
const PANELS = [GoodsTransactionTermsPanel, GoodShippingChargeGroupPanel, GoodsSubscriptionPolicyPanel, GoodsFulfillmentPanel, GoodsProductionPanel];

function render(selected: AdminGoodRecord = good, state: Parameters<typeof GoodSection>[0]['state'] = {}) {
  hooks.index = 0;
  return nodes(GoodSection({ action: vi.fn(), adjustmentId: 'adjust', catalogIps: [], ipOptions: [], onSelect: vi.fn(), pending: false, records: [selected],
    selected, state, accountId: 'operator-1', hideRecordList: true }));
}
beforeEach(() => { hooks.values = []; hooks.index = 0; });

/* 리뷰 T3a-7 — 공통 잠금 안내를 패널 위에 보이면 패널 본문(disabledReason을 다시 그린다)에 같은 문장을 넘기지 않는다. */
it('공통 잠금 안내를 보인 5개 패널에는 같은 문장 대신 위 안내를 가리키는 짧은 이유를 넘겨 이유가 두 번 나오지 않는다', () => {
  let tree = render();
  (tree.find(node => node.type === GoodEditor)!.props.onEditingStateChange as (state: unknown) => void)({ goodId: good.id, dirty: true, busy: false });
  tree = render();
  /* 안내는 운영 섹션의 notice prop으로 패널 위에 그려진다. */
  const notices = tree.map(node => node.props.notice).filter((notice): notice is Element => isValidElement(notice) && notice.type === GoodOperationDisabledNotice);
  /* 5개 정책 패널 + 판매 방식(D5②). */
  expect(notices).toHaveLength(6);
  for (const notice of notices) expect(notice.props).toMatchObject({ reason: GOOD_UNSAVED_BASE_COPY, unsaved: true });
  for (const panel of PANELS) {
    const reason = tree.find(node => node.type === panel)!.props.disabledReason;
    expect(reason).toBe(GOOD_OPERATION_LOCKED_POINTER);
    expect(reason).not.toBe(GOOD_UNSAVED_BASE_COPY);
  }
  /* 저장해 미저장 변경이 없으면 잠금도 안내도 없다. */
  (tree.find(node => node.type === GoodEditor)!.props.onEditingStateChange as (state: unknown) => void)({ goodId: good.id, dirty: false, busy: false });
  tree = render();
  for (const panel of PANELS) expect(tree.find(node => node.type === panel)!.props.disabledReason).toBe('');
});

it('다른 패널 저장을 기다리느라 공통 안내를 보이지 않는 패널은 자기 이유 문장을 그대로 받는다', () => {
  let tree = render();
  (tree.find(node => node.type === GoodsTransactionTermsPanel)!.props.onBusyChange as (busy: boolean) => void)(true);
  tree = render();
  const charge = tree.find(node => node.type === GoodShippingChargeGroupPanel)!;
  expect(charge.props.disabledReason).toBe('할인·배송 또는 정기배송 요청의 결과를 확인한 뒤 배정해주세요.');
});

/* D5② — 판매 방식 패널은 옵션·가격 저장과 낙관 잠금을 나눠 쓰므로 기본 입력이 잠기면 함께 잠기고, 상품을 저장하면 다시 읽는다. */
it('판매 방식 패널은 기본 입력 잠금을 따라 비활성화되고 상품 수정 시각·저장 시도가 바뀌면 다시 읽는다', () => {
  const saleMode = (tree: Element[]) => tree.find(node => node.type === GoodsOptionSaleModePanel)!.props;
  const stored = { ...good, updatedAt: '2026-10-28T03:00:00.000Z' } as AdminGoodRecord;
  let tree = render(stored);
  expect(saleMode(tree)).toMatchObject({ goodId: good.id, disabled: true });
  (tree.find(node => node.type === GoodEditor)!.props.onEditingStateChange as (state: unknown) => void)({ goodId: good.id, dirty: false, busy: false });
  tree = render(stored);
  expect(saleMode(tree).disabled).toBe(false);
  const first = saleMode(tree).revision;
  expect(saleMode(render({ ...stored, updatedAt: '2026-10-28T03:00:01.000Z' } as AdminGoodRecord)).revision).not.toBe(first);
  expect(saleMode(render(stored, { attempt: 1 })).revision).not.toBe(first);
  (tree.find(node => node.type === GoodEditor)!.props.onEditingStateChange as (state: unknown) => void)({ goodId: good.id, dirty: true, busy: false });
  expect(saleMode(render(stored)).disabled).toBe(true);
});

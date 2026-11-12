import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 훅은 위에서 순서대로 흉내 낸다(이 저장소의 client 테스트 방식). context는 상품 편집기가 알려 주는 고시 A/S 연락처다. */
const hooks = vi.hoisted(() => ({ context: '', refs: [] as { current: unknown }[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useContext: () => hooks.context,
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.refs[index] ??= { current: initial }; },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
}));
import { GoodsAfterSalesFields, afterSalesPhoneSuggestion } from './GoodsAfterSalesFields';
import type { GoodsAfterSalesValues } from '@/lib/goods-after-sales';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const onChange = vi.fn();
const empty: GoodsAfterSalesValues = { phone: '', guide: '', sellerSpecialNotes: '' };

/** 패널이 칸을 잠갔는지(저장된 안내를 읽기 전) 흉내 낸 표식 요소로 미리 채움 한 번을 돌린다. */
function renderPrefill(values: GoodsAfterSalesValues, locked: boolean) {
  const prefill = nodes(GoodsAfterSalesFields({ values, onChange })).find(node => typeof node.type === 'function' && (node.type as { name: string }).name === 'AfterSalesPhonePrefill')!;
  hooks.index = 0;
  const output = (prefill.type as (props: Record<string, unknown>) => ReactNode)(prefill.props);
  hooks.refs[0].current ??= { closest: () => null };
  (hooks.refs[0].current as { closest: () => unknown }).closest = () => locked ? { disabled: true } : null;
  for (const effect of hooks.effects.splice(0)) effect();
  return output;
}

beforeEach(() => { vi.clearAllMocks(); hooks.context = ''; hooks.refs = []; hooks.index = 0; hooks.effects = []; });

/* ADM-004(복잡도 표 387행): 비어 있는 A/S 전화번호를 상품정보고시의 A/S 연락처로 미리 채운다. 저장은 안내 저장으로 따로 한다. */
describe('A/S 전화번호 미리 채움', () => {
  it('전화번호 모양의 고시 연락처만 쓴다', () => {
    expect(afterSalesPhoneSuggestion(' 02-000-0000 ')).toBe('02-000-0000');
    expect(afterSalesPhoneSuggestion('1588-0000')).toBe('1588-0000');
    expect(afterSalesPhoneSuggestion('help@icons.example')).toBe('');
    expect(afterSalesPhoneSuggestion('고객센터 1588-0000')).toBe('');
    expect(afterSalesPhoneSuggestion(null)).toBe('');
  });

  it('저장된 안내를 읽어 칸이 풀린 첫 순간 비어 있으면 한 번만 채우고, 그 뒤 지워도 다시 채우지 않는다', () => {
    hooks.context = '02-000-0000';
    renderPrefill(empty, true);
    expect(onChange).not.toHaveBeenCalled();
    renderPrefill(empty, false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...empty, phone: '02-000-0000' });
    renderPrefill(empty, false);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('이미 저장된 번호가 있거나 다른 화면(고시 연락처 없음)이면 채우지 않는다', () => {
    hooks.context = '02-000-0000';
    renderPrefill({ ...empty, phone: '070-1234-5678' }, false);
    hooks.refs = [];
    hooks.context = '';
    renderPrefill(empty, false);
    expect(onChange).not.toHaveBeenCalled();
  });
});

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
}));
import { CustomerPurchaseFilters } from './CustomerPurchaseFilters';
import { normalizeCustomerPurchaseFilters } from '@/lib/admin/customer-purchase-report';

type Control = ReactElement<{
  children?: ReactNode; name?: string; type?: string; value?: string;
  onInput?: (event: { currentTarget: { value: string } }) => void;
  onChange?: (event: { target: { value: string; checked: boolean } }) => void;
}>;
const now = '2026-10-13T16:00:00Z';
const filters = normalizeCustomerPurchaseFilters({}, new Date(now));
const all = (node: ReactNode): Control[] => Array.isArray(node) ? node.flatMap(all) : isValidElement(node)
  ? [node as Control, ...all((node.props as { children?: ReactNode }).children)] : [];
function render() { hooks.index = 0; return all(CustomerPurchaseFilters({ filters, now })); }
function input(name: string) {
  const result = render().find(node => node.type === 'input' && node.props.name === name);
  if (!result) throw new Error(`Missing date ${name}`);
  return result;
}
function toggle(checked: boolean) {
  render().find(node => node.type === 'input' && node.props.type === 'checkbox')!.props.onChange!({ target: { value: '', checked } });
}
beforeEach(() => { hooks.index = 0; hooks.values = []; });

it('preserves native date input events through an immediate comparison toggle', () => {
  input('from').props.onInput!({ currentTarget: { value: '2019-08-01' } });
  input('to').props.onInput!({ currentTarget: { value: '2019-08-31' } });
  toggle(false); toggle(true);
  expect(input('from').props.value).toBe('2019-08-01');
  expect(input('to').props.value).toBe('2019-08-31');
});

it('retains manually entered comparison dates when comparison is disabled and re-enabled', () => {
  input('compareFrom').props.onInput!({ currentTarget: { value: '2018-08-01' } });
  input('compareTo').props.onInput!({ currentTarget: { value: '2018-08-31' } });
  toggle(false); toggle(true);
  expect(input('compareFrom').props.value).toBe('2018-08-01');
  expect(input('compareTo').props.value).toBe('2018-08-31');
});

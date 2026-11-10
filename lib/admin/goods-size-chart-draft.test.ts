import { expect, it } from 'vitest';
import { parseGoodsSizeDraft, parseGoodsSizeTemplateDraft } from './goods-size-chart-draft';
import { createAdminLocalAutosave } from './local-autosave';
const chart = { unit: 'cm' as const, sizes: ['확장'], measurements: [{ name: '둘레', values: ['42.7'] }], note: '' };
const values = { enabled: true, chart };
const request = { revision: 3, values, operationId: '99100000-0000-4000-8000-000000000001' };
it('restores incomplete text but refuses malformed or changed pending request metadata', () => {
  const draft = { baseRevision: 3, values: { ...values, chart: { ...chart, sizes: [''], measurements: [{ name: '', values: ['1e3'] }] } }, request: null };
  expect(parseGoodsSizeDraft(draft)).toEqual(draft);
  expect(parseGoodsSizeDraft({ ...draft, request })).toMatchObject({ request });
  expect(parseGoodsSizeDraft({ ...draft, request: { ...request, revision: 2 } })).toBeNull();
  expect(parseGoodsSizeDraft({ ...draft, request: { ...request, values: draft.values } })).toBeNull();
  expect(parseGoodsSizeTemplateDraft({ baseRevision: 0, name: '', chart: draft.values.chart, request: null })).not.toBeNull();
});
it('keeps a pending operation across reload and isolates account, good, and template scopes', () => {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const scope = { accountId: 'account-a', formId: 'goods-size-chart', recordId: 'good-a' };
  const create = (change = {}) => createAdminLocalAutosave({ scope: { ...scope, ...change }, fields: ['sizeChartDraft'], storage });
  const draft = { baseRevision: 3, values, request }, original = create();
  original.capture([['sizeChartDraft', JSON.stringify(draft)]]); original.flush();
  expect(parseGoodsSizeDraft(JSON.parse(create().getSnapshot().recovery!.values.sizeChartDraft))).toEqual(draft);
  for (const change of [{ accountId: 'account-b' }, { recordId: 'good-b' }, { formId: 'goods-size-template' }]) expect(create(change).getSnapshot().recovery).toBeNull();
});

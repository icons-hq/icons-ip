/** Read-only bridge: the separately authorized SQL runner provides captured
 * JSON. This file never opens a DB connection or runs a shell/browser command. */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseShippingSettingsApplyInput, parseShippingSettingsOperationReceipt, parseShippingSettingsSaveRequest,
  shippingSettingsChargeGroup, shippingSettingsOperationContext, shippingSettingsReceiptMatches,
  type ShippingSettingsApplyInput, type ShippingSettingsOperationReceipt } from '@/lib/admin/shipping-settings-templates';
import { parseShippingSettingsPreview, searchShippingSettingsGoods } from '@/lib/admin/shipping-settings-templates.server';
import { sameGoodsTerms } from '@/lib/admin/goods-transaction-terms';
import { transactionRecord, transactionInteger, transactionExactKeys } from '@/lib/goods-transaction-values';
import { parseShippingChargeGroupAssignRequest, parseShippingChargeGroupFilters, parseShippingChargeGroupIdentity,
  parseShippingChargeGroupOperationContext, parseShippingChargeGroupOperationReceipt, parseShippingChargeGroupSaveRequest,
  shippingChargeGroupOperationContext, shippingChargeGroupReceiptMatches, shippingChargeGroupValuesMatch } from '@/lib/admin/shipping-charge-groups';
import { parseShippingChargeGroupAssignmentPreview, parseShippingChargeGroupData, parseShippingChargeGroupGoodData,
  parseShippingChargeGroupListData } from '@/lib/admin/shipping-charge-groups.server';
import { hasShippingChargeDetails, parseShippingChargeSnapshot } from '@/lib/shipping-charge-groups';
import { parseGoodsTransactionQuote } from '@/lib/goods-transaction';
import { parseGoodsTransactionOffers } from '@/lib/goods-transaction-offers';
import { parseRegionalShippingSnapshot } from '@/lib/shipping-regions';

const transport = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: transport.rpc }) }));
interface TemplateCapture { kind: 'save' | 'preview' | 'apply' | 'clear' | 'move' | 'search'; input?: unknown; output: unknown }
const TEMPLATE_KINDS = ['save', 'preview', 'apply', 'clear', 'move', 'search'] as const;

function readCaptures(path: string, prefix: string): unknown[] {
  if (!isAbsolute(path)) throw new Error('shipping_charge_dto_file_must_be_absolute');
  const file = statSync(path);
  if (!file.isFile() || file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error('shipping_charge_dto_file_invalid');
  const contents = readFileSync(path, 'utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(contents); } catch {
    const lines = contents.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(prefix));
    if (!lines.length) throw new Error('shipping_charge_dto_markers_missing');
    parsed = lines.map(line => JSON.parse(line.slice(prefix.length)) as unknown);
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100) throw new Error('shipping_charge_dto_captures_invalid');
  return parsed;
}
function templateCaptures(path: string): Map<TemplateCapture['kind'], TemplateCapture> {
  const result = new Map<TemplateCapture['kind'], TemplateCapture>();
  for (const raw of readCaptures(path, 'SHIPPING_CHARGE_TEMPLATE_DTO:')) {
    if (!transactionRecord(raw) || !transactionExactKeys(raw, ['kind', 'output', ...(Object.hasOwn(raw, 'input') ? ['input'] : [])])
      || !TEMPLATE_KINDS.includes(raw.kind as TemplateCapture['kind']) || result.has(raw.kind as TemplateCapture['kind'])) throw new Error('shipping_charge_template_capture_invalid');
    result.set(raw.kind as TemplateCapture['kind'], raw as unknown as TemplateCapture);
  }
  if (TEMPLATE_KINDS.some(kind => !result.has(kind))) throw new Error('shipping_charge_template_capture_kind_missing');
  return result;
}
function expectAppliedBinding(input: ShippingSettingsApplyInput, receipt: ShippingSettingsOperationReceipt) {
  expect(receipt.state).toBe('applied'); expect(receipt.chargeGroupVersion).toBe(1);
  expect(shippingSettingsReceiptMatches(receipt, shippingSettingsOperationContext(input))).toBe(true);
  expect(receipt.appliedCount).toBe(input.goods.length);
  expect(receipt.template).not.toBeNull();
  const directive = shippingSettingsChargeGroup(receipt.template!.settings);
  if (directive.mode === 'assign') expect(input.targetGroup?.id).toBe(directive.groupId);
  else expect(input.targetGroup).toBeNull();
  for (const row of receipt.goods) {
    const before = input.goods.find(good => good.id === row.id); expect(before).toBeDefined();
    if (!before) throw new Error('shipping_charge_template_result_good_not_requested');
    const groupId = directive.mode === 'preserve' ? before.groupId : directive.mode === 'assign' ? input.targetGroup!.id : null;
    const groupRevision = directive.mode === 'preserve' ? before.groupRevision : directive.mode === 'assign' ? input.targetGroup!.revision : null;
    const changed = groupId !== before.groupId;
    expect(row.groupId).toBe(groupId); expect(row.groupRevision).toBe(groupRevision);
    expect(row.assignmentRevision).toBe(Number(before.assignmentRevision) + Number(changed));
    if (changed) { expect(row.assignmentVersionId).not.toBeNull(); expect(row.assignmentVersionId).not.toBe(before.assignmentVersionId); }
    else expect(row.assignmentVersionId).toBe(before.assignmentVersionId);
  }
}

const templatePath = process.env.SHIPPING_CHARGE_TEMPLATE_DTO_FILE;
const corePath = process.env.SHIPPING_CHARGE_DTO_FILE;
if (!templatePath && !corePath) throw new Error('SHIPPING_CHARGE_TEMPLATE_DTO_FILE or SHIPPING_CHARGE_DTO_FILE is required; run the authorized SQL capture first');
beforeEach(() => transport.rpc.mockReset());

if (templatePath) {
const captures = templateCaptures(templatePath);
const savedInput = parseShippingSettingsSaveRequest(captures.get('save')!.input);
if (!savedInput) throw new Error('shipping_charge_template_saved_input_invalid');
const identity = { expectedActorId: savedInput.expectedActorId, expectedSessionId: savedInput.expectedSessionId };

describe('actual SQL shipping-template v3 payloads -> production TypeScript contracts', () => {
  it('reads the real save request and its context-bound receipt', () => {
    const capture = captures.get('save')!, receipt = parseShippingSettingsOperationReceipt(capture.output);
    expect(receipt).not.toBeNull(); if (!receipt) throw new Error('shipping_charge_template_saved_receipt_invalid');
    expect(receipt.state).toBe('saved'); expect(shippingSettingsReceiptMatches(receipt, savedInput)).toBe(true);
    expect(receipt.template?.name).toBe(savedInput.name); expect(receipt.template?.enabled).toBe(savedInput.enabled);
    expect(sameGoodsTerms(receipt.template?.settings, savedInput.settings)).toBe(true);
  });
  it('reads real preview owner/family, before/after groups and target CAS', () => {
    const preview = parseShippingSettingsPreview(captures.get('preview')!.output);
    expect(preview).not.toBeNull(); if (!preview) throw new Error('shipping_charge_template_preview_invalid');
    expect(preview.actorId).toBe(identity.expectedActorId); expect(preview.sessionId).toBe(identity.expectedSessionId);
    expect(Object.hasOwn(preview, 'targetGroup')).toBe(true); expect(preview.goods.length).toBeGreaterThan(0);
    for (const row of preview.goods) {
      expect(Object.hasOwn(row, 'assignmentRevision')).toBe(true);
      expect(Object.hasOwn(row.effectiveBefore, 'chargeGroup')).toBe(true);
      expect(Object.hasOwn(row.effectiveAfter, 'chargeGroup')).toBe(true);
    }
  });
  it.each(['apply', 'clear', 'move'] as const)('reads real %s request/result with immutable operation and assignment CAS', kind => {
    const capture = captures.get(kind)!, input = parseShippingSettingsApplyInput(capture.input), receipt = parseShippingSettingsOperationReceipt(capture.output);
    expect(input).not.toBeNull(); expect(receipt).not.toBeNull();
    if (!input || !receipt) throw new Error(`shipping_charge_template_${kind}_invalid`);
    expect(Object.hasOwn(input, 'targetGroup')).toBe(true); expectAppliedBinding(input, receipt);
    if (kind === 'clear') expect(shippingSettingsChargeGroup(receipt.template!.settings).mode).toBe('clear');
    if (kind === 'move') expect(input.goods.some(good => good.groupId !== null && good.groupId !== input.targetGroup?.id)).toBe(true);
    const downgraded: Record<string, unknown> = { ...receipt }; delete downgraded.chargeGroupVersion;
    expect(parseShippingSettingsOperationReceipt(downgraded)).toBeNull();
  });
  it('passes the actual search result through the current server loader without DB access', async () => {
    const output = captures.get('search')!.output;
    if (!transactionRecord(output) || !transactionInteger(output.page, 1)) throw new Error('shipping_charge_template_search_page_invalid');
    transport.rpc.mockResolvedValueOnce({ data: output, error: null });
    expect(await searchShippingSettingsGoods('', output.page, identity)).toEqual(output);
    expect(transport.rpc).toHaveBeenCalledExactlyOnceWith('admin_search_goods_for_shipping_settings_v3', {
      p_query: '', p_page: output.page, p_expected_actor_id: identity.expectedActorId, p_expected_session_id: identity.expectedSessionId,
    });
  });
});
}

const CORE_KINDS = ['seal', 'save', 'list', 'preview', 'assign', 'getgood', 'get', 'orderShipping', 'offers', 'quote'] as const;
interface CoreCapture { kind: typeof CORE_KINDS[number]; request?: unknown; value: unknown }
function coreCaptures(path: string): CoreCapture[] {
  const result: CoreCapture[] = [], counts = new Map<string, number>();
  for (const raw of readCaptures(path, 'SHIPPING_CHARGE_DTO:')) {
    if (!transactionRecord(raw) || !transactionExactKeys(raw, ['kind', 'value', ...(Object.hasOwn(raw, 'request') ? ['request'] : [])])
      || !CORE_KINDS.includes(raw.kind as CoreCapture['kind'])) throw new Error('shipping_charge_core_capture_invalid');
    const count = (counts.get(String(raw.kind)) ?? 0) + 1;
    if (count > (raw.kind === 'orderShipping' ? 2 : 1)) throw new Error('shipping_charge_core_capture_duplicate');
    counts.set(String(raw.kind), count); result.push(raw as unknown as CoreCapture);
  }
  if (CORE_KINDS.some(kind => !counts.has(kind)) || counts.get('orderShipping') !== 2) throw new Error('shipping_charge_core_capture_kind_missing');
  return result;
}
function coreReadRequest(capture: CoreCapture) {
  if (!transactionRecord(capture.request)) throw new Error('shipping_charge_core_read_request_missing');
  const request = capture.request;
  const identity = parseShippingChargeGroupIdentity({ expectedActorId: request.p_expected_actor_id, expectedSessionId: request.p_expected_session_id });
  if (!identity) throw new Error('shipping_charge_core_read_identity_invalid');
  return { request, identity };
}

if (corePath) {
const captures = coreCaptures(corePath);
describe('actual SQL shipping-charge payloads -> production TypeScript contracts', () => {
  it.each(captures.map((capture, index) => [capture.kind, index, capture] as const))('reads %s capture %s', (kind, _index, capture) => {
    if (kind === 'seal') {
      const context = parseShippingChargeGroupOperationContext(capture.request), receipt = parseShippingChargeGroupOperationReceipt(capture.value);
      expect(context).not.toBeNull(); expect(receipt).not.toBeNull();
      if (!context || !receipt) throw new Error('shipping_charge_core_seal_invalid');
      expect(receipt.state).toBe('sealed'); expect(shippingChargeGroupReceiptMatches(receipt, context)).toBe(true);
    } else if (kind === 'save') {
      const input = parseShippingChargeGroupSaveRequest(capture.request), receipt = parseShippingChargeGroupOperationReceipt(capture.value);
      expect(input).not.toBeNull(); expect(receipt).not.toBeNull();
      if (!input || !receipt || !receipt.group) throw new Error('shipping_charge_core_save_invalid');
      expect(receipt.state).toBe('saved'); expect(shippingChargeGroupReceiptMatches(receipt, shippingChargeGroupOperationContext(input))).toBe(true);
      expect(receipt.group.originId).toBe(input.originId); expect(shippingChargeGroupValuesMatch(receipt.group, input.values)).toBe(true);
    } else if (kind === 'assign') {
      const input = parseShippingChargeGroupAssignRequest(capture.request), receipt = parseShippingChargeGroupOperationReceipt(capture.value);
      expect(input).not.toBeNull(); expect(receipt).not.toBeNull();
      if (!input || !receipt) throw new Error('shipping_charge_core_assign_invalid');
      expect(receipt.state).toBe('assigned'); expect(shippingChargeGroupReceiptMatches(receipt, shippingChargeGroupOperationContext(input))).toBe(true);
      expect(receipt.appliedCount).toBe(input.goods.length);
      for (const after of receipt.goods) {
        const before = input.goods.find(row => row.id === after.id); expect(before).toBeDefined();
        if (!before) throw new Error('shipping_charge_core_assignment_subject_changed');
        const changed = before.groupId !== input.groupId;
        expect(after.ownerGoodId).toBe(before.ownerGoodId); expect(after.originId).toBe(before.originId);
        expect(after.familyGoodIds).toEqual(before.familyGoodIds); expect(after.transactionRevision).toBe(before.transactionRevision);
        expect(after.deliveryVersionId).toBe(before.deliveryVersionId); expect(after.assignmentRevision).toBe(before.assignmentRevision + Number(changed));
        if (changed) { expect(after.assignmentVersionId).not.toBeNull(); expect(after.assignmentVersionId).not.toBe(before.assignmentVersionId); }
        else expect(after.assignmentVersionId).toBe(before.assignmentVersionId);
      }
    } else if (kind === 'list') {
      const { request, identity } = coreReadRequest(capture);
      const filters = parseShippingChargeGroupFilters({ originId: request.p_origin_id, query: request.p_query, status: request.p_status, page: request.p_page });
      if (!filters) throw new Error('shipping_charge_core_list_request_invalid');
      expect(parseShippingChargeGroupListData(capture.value, filters, identity)).toEqual(capture.value);
    } else if (kind === 'get') {
      const { request, identity } = coreReadRequest(capture);
      if (typeof request.p_group_id !== 'string') throw new Error('shipping_charge_core_get_request_invalid');
      expect(parseShippingChargeGroupData(capture.value, request.p_group_id, identity)).toEqual(capture.value);
    } else if (kind === 'getgood') {
      const { request, identity } = coreReadRequest(capture);
      if (typeof request.p_good_id !== 'string') throw new Error('shipping_charge_core_get_good_request_invalid');
      expect(parseShippingChargeGroupGoodData(capture.value, request.p_good_id, identity)).toEqual(capture.value);
    } else if (kind === 'preview') {
      const { request, identity } = coreReadRequest(capture);
      if (!(request.p_group_id === null || typeof request.p_group_id === 'string') || !Array.isArray(request.p_good_ids)
        || request.p_good_ids.some(id => typeof id !== 'string')) throw new Error('shipping_charge_core_preview_request_invalid');
      expect(parseShippingChargeGroupAssignmentPreview(capture.value, request.p_group_id, request.p_good_ids, identity)).toEqual(capture.value);
    } else if (kind === 'orderShipping') {
      if (!Array.isArray(capture.value) || !capture.value.length) throw new Error('shipping_charge_core_order_shipping_invalid');
      expect(capture.value.some(hasShippingChargeDetails)).toBe(true);
      for (const row of capture.value) {
        if (hasShippingChargeDetails(row)) expect(parseShippingChargeSnapshot(row)).toEqual(row);
        else expect(parseRegionalShippingSnapshot(row)).not.toBeNull();
      }
    } else if (kind === 'offers') {
      const offers = parseGoodsTransactionOffers(capture.value); expect(offers).not.toBeNull();
      expect(offers?.some(row => row.chargeGroup !== undefined)).toBe(true);
    } else if (kind === 'quote') {
      const quote = parseGoodsTransactionQuote(capture.value); expect(quote).not.toBeNull();
      if (!quote || quote.state !== 'quoted') throw new Error('shipping_charge_core_quote_not_quoted');
      expect(quote.display.shipping.some(row => row.chargeDetails !== undefined)).toBe(true);
    }
  });
});
}

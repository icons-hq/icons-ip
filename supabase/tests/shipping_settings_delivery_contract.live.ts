import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseShippingSettingsApplyInput, parseShippingSettingsOperationContext, parseShippingSettingsOperationReceipt,
  parseShippingSettingsSaveRequest, shippingSettingsOperationContext, shippingSettingsReceiptMatches } from '@/lib/admin/shipping-settings-templates';
import { parseShippingSettingsPreview, searchShippingSettingsGoods } from '@/lib/admin/shipping-settings-templates.server';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
const path = process.env.SHIPPING_SETTINGS_DTO_FILE;
if (!path) throw new Error('Run only through the owned shipping-template clone verifier');
const captures = JSON.parse(readFileSync(path, 'utf8')) as { kind: string; request?: unknown; value: unknown }[];
const capture = (kind: string) => { const value = captures.find(row => row.kind === kind); if (!value) throw new Error(`Missing SQL response ${kind}`); return value; };

describe('실제 Postgres 배송 템플릿 응답과 TypeScript 계약', () => {
  it.each(['save', 'apply', 'seal'])('%s 결과의 실제 시각·버전·actor/session 결속을 읽는다', kind => {
    const row = capture(kind);
    const request = kind === 'save' ? parseShippingSettingsSaveRequest(row.request) : kind === 'apply'
      ? parseShippingSettingsApplyInput(row.request) : parseShippingSettingsOperationContext(row.request);
    const receipt = parseShippingSettingsOperationReceipt(row.value);
    expect(request).not.toBeNull(); expect(receipt).not.toBeNull();
    expect(shippingSettingsReceiptMatches(receipt!, shippingSettingsOperationContext(request!))).toBe(true);
  });
  it('실제 유효 정책·공유 소유자·수납 계약 미리보기를 읽는다', () => {
    const preview = parseShippingSettingsPreview(capture('preview').value);
    expect(preview).not.toBeNull(); expect(preview!.canApply).toBe(true);
    expect(preview!.goods[0].effectiveBefore.delivery?.paymentMode).toBe('buyer_choice');
    expect(preview!.goods[0].effectiveAfter.delivery?.paymentMode).toBe('collect');
    expect(preview!.goods[0].effectiveAfter.delivery?.quantityTerms?.kind).toBe('tier3');
  });
  it('실제 SQL 검색 응답을 현재 identity와 함께 읽는다', async () => {
    const request = parseShippingSettingsApplyInput(capture('apply').request)!;
    mocks.rpc.mockResolvedValue({ data: capture('search').value });
    const result = await searchShippingSettingsGoods('ST-GOOD-001', 1, { expectedActorId: request.expectedActorId, expectedSessionId: request.expectedSessionId });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].effective.delivery?.paymentMode).toBe('collect');
  });
});

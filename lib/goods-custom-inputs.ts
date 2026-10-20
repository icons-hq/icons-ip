import { isUuid } from '@/lib/uuid';

export const GOODS_CUSTOM_INPUT_LIMIT = 5;
export const GOODS_CUSTOM_INPUT_NAME_LIMIT = 25;
export const GOODS_CUSTOM_INPUT_VALUE_LIMIT = 100;

export interface GoodsCustomInputField { id: string; name: string; active: boolean }
export interface GoodsCustomInputConfig { enabled: boolean; revision: number; fields: GoodsCustomInputField[] }
export interface GoodsCustomInputValue { id: string; name: string; value: string }
export interface GoodsCustomInputSelection { revision: number; fields: GoodsCustomInputValue[] }
export const EMPTY_GOODS_CUSTOM_INPUTS: GoodsCustomInputConfig = { enabled: false, revision: 0, fields: [] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value === value.trim() && [...value].length >= 1 && [...value].length <= max
    && [...value].every(character => character.codePointAt(0)! >= 32 && character.codePointAt(0) !== 127);
}

export function parseGoodsCustomInputFields(value: unknown): GoodsCustomInputField[] | null {
  if (!Array.isArray(value) || value.length > GOODS_CUSTOM_INPUT_LIMIT) return null;
  const fields: GoodsCustomInputField[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const field of value) {
    if (!record(field) || typeof field.id !== 'string' || !isUuid(field.id)
      || !boundedText(field.name, GOODS_CUSTOM_INPUT_NAME_LIMIT) || typeof field.active !== 'boolean'
      || ids.has(field.id.toLowerCase()) || names.has(field.name)) return null;
    ids.add(field.id.toLowerCase()); names.add(field.name);
    fields.push({ id: field.id.toLowerCase(), name: field.name, active: field.active });
  }
  return fields;
}

export function parseGoodsCustomInputConfig(value: unknown): GoodsCustomInputConfig | null {
  if (!record(value) || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return null;
  const fields = parseGoodsCustomInputFields(value.fields);
  if (!fields || (value.enabled && !fields.some(field => field.active))) return null;
  return { enabled: value.enabled, revision: value.revision as number, fields };
}

export function goodsCustomInputConfigFromRow(row: { custom_inputs_enabled?: boolean; custom_inputs_revision?: number; custom_input_fields?: unknown }): GoodsCustomInputConfig {
  const config = parseGoodsCustomInputConfig({ enabled:row.custom_inputs_enabled ?? false,revision:row.custom_inputs_revision ?? 0,fields:row.custom_input_fields ?? [] });
  if (!config) throw new Error('invalid_goods_custom_input_config');
  return config;
}

/** Stored selections retain their labels until the customer explicitly replaces
 * a stale selection. Labels never participate in the cart identity. */
export function parseGoodsCustomInputSelection(value: unknown): GoodsCustomInputSelection | null {
  if (!record(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !Array.isArray(value.fields) || !value.fields.length || value.fields.length > GOODS_CUSTOM_INPUT_LIMIT) return null;
  const fields: GoodsCustomInputValue[] = [];
  const ids = new Set<string>();
  for (const field of value.fields) {
    if (!record(field) || typeof field.id !== 'string' || !isUuid(field.id)
      || !boundedText(field.name, GOODS_CUSTOM_INPUT_NAME_LIMIT) || !boundedText(field.value, GOODS_CUSTOM_INPUT_VALUE_LIMIT)
      || ids.has(field.id.toLowerCase())) return null;
    ids.add(field.id.toLowerCase());
    fields.push({ id: field.id.toLowerCase(), name: field.name, value: field.value });
  }
  return { revision: value.revision as number, fields };
}

export function readGoodsCustomInputSnapshot(value: unknown): GoodsCustomInputSelection | null {
  if (value === null || value === undefined) return null;
  const selection = parseGoodsCustomInputSelection(value);
  if (!selection) throw new Error('invalid_order_custom_inputs_snapshot');
  return selection;
}

export function goodsCustomInputSummary(selection: GoodsCustomInputSelection | null | undefined): string {
  return selection?.fields.map(field => `${field.name}: ${field.value}`).join('\n') ?? '';
}

export function goodsCustomInputIdentity(selection: GoodsCustomInputSelection | undefined): string {
  if (!selection) return '';
  return JSON.stringify([selection.revision, selection.fields.map(field => [field.id, field.value]).sort(([left], [right]) => left.localeCompare(right))]);
}

export function goodsCustomInputValues(selection: GoodsCustomInputSelection | undefined): Record<string, string> {
  return Object.fromEntries(selection?.fields.map(field => [field.id, field.value]) ?? []);
}

export function goodsCustomInputProblem(config: GoodsCustomInputConfig | undefined, selection: GoodsCustomInputSelection | undefined): string | null {
  const fields = config?.enabled ? config.fields.filter(field => field.active) : [];
  if (config?.enabled && !fields.length) return '직접입력형 옵션 설정을 확인 중입니다.';
  if (!fields.length) return selection ? '직접입력형 옵션 설정이 변경되었습니다. 상품에서 다시 확인해주세요.' : null;
  if (!selection || selection.revision !== config?.revision || selection.fields.length !== fields.length
    || fields.some(field => !selection.fields.some(value => value.id === field.id && value.name === field.name))) {
    return '직접입력형 옵션을 상품에서 다시 확인해주세요.';
  }
  return parseGoodsCustomInputSelection(selection) ? null : '직접입력형 옵션 내용을 확인해주세요.';
}

export function prepareGoodsCustomInputSelection(config: GoodsCustomInputConfig | undefined, values: Record<string, string>):
  { ok: true; selection?: GoodsCustomInputSelection } | { ok: false; error: string } {
  if (!config?.enabled) return { ok: true };
  const fields = config.fields.filter(field => field.active).map(field => ({ id: field.id, name: field.name, value: (values[field.id] ?? '').trim() }));
  for (const field of fields) {
    if (!boundedText(field.value, GOODS_CUSTOM_INPUT_VALUE_LIMIT)) return { ok: false, error: `${field.name}을(를) 1~${GOODS_CUSTOM_INPUT_VALUE_LIMIT}자로 입력해주세요.` };
  }
  const selection = parseGoodsCustomInputSelection({ revision: config.revision, fields });
  return selection ? { ok: true, selection } : { ok: false, error: '직접입력형 옵션 설정을 확인하지 못했습니다. 새로고침해주세요.' };
}

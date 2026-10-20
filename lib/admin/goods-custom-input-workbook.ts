import { isUuid } from '@/lib/uuid';
import {
  EMPTY_GOODS_CUSTOM_INPUTS,
  GOODS_CUSTOM_INPUT_LIMIT,
  GOODS_CUSTOM_INPUT_NAME_LIMIT,
  parseGoodsCustomInputConfig,
  type GoodsCustomInputConfig,
  type GoodsCustomInputField,
} from '@/lib/goods-custom-inputs';

export const GOODS_CUSTOM_INPUT_WORKBOOK_SHEET = '직접입력형 옵션';
export const GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS = {
  goodCode: '상품코드',
  mode: '변경 방식',
  enabled: '전체 사용',
  fieldId: '항목 ID',
  name: '항목명',
  action: '항목 처리',
  revision: '정의 버전',
} as const;
export const GOODS_CUSTOM_INPUT_WORKBOOK_GROUP_LIMIT = GOODS_CUSTOM_INPUT_LIMIT * 2;
export const GOODS_CUSTOM_INPUT_WORKBOOK_ROW_LIMIT = 500 * GOODS_CUSTOM_INPUT_WORKBOOK_GROUP_LIMIT;
export type GoodsCustomInputWorkbookKey = keyof typeof GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS;
export type GoodsCustomInputWorkbookRow = Record<GoodsCustomInputWorkbookKey, string>;
export type GoodsCustomInputWorkbookInputRow = { row: number; values: GoodsCustomInputWorkbookRow; errors?: string[] };
export type GoodsCustomInputWorkbookPlan =
  | { kind: 'keep'; warnings: string[] }
  | { kind: 'save'; config: Pick<GoodsCustomInputConfig, 'enabled' | 'fields'>; expectedRevision: number; warnings: string[] }
  | { kind: 'error'; errors: string[]; warnings: string[] };

export function emptyGoodsCustomInputWorkbookRow(): GoodsCustomInputWorkbookRow {
  return Object.fromEntries(Object.keys(GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS).map(key => [key, ''])) as GoodsCustomInputWorkbookRow;
}

/** The existing import-records RPC already includes these fields in good JSON. */
export function goodsCustomInputWorkbookConfig(good: Record<string, unknown>): GoodsCustomInputConfig {
  const config = parseGoodsCustomInputConfig({
    enabled: good.custom_inputs_enabled ?? false,
    revision: good.custom_inputs_revision ?? 0,
    fields: good.custom_input_fields ?? [],
  });
  if (!config) throw new Error('저장된 직접입력형 옵션을 읽지 못했습니다. 상품 편집에서 설정을 확인해주세요.');
  return config;
}

export function exportGoodsCustomInputWorkbookRows(records: readonly {
  goodCode: string;
  config: GoodsCustomInputConfig;
}[]): GoodsCustomInputWorkbookRow[] {
  return records.flatMap(({ goodCode, config }) => config.fields.map(field => ({
    goodCode,
    mode: '편집',
    enabled: config.enabled ? '예' : '아니오',
    fieldId: field.id,
    name: field.name,
    action: field.active ? '사용' : '중지',
    revision: String(config.revision),
  })));
}

function canonical(config: Pick<GoodsCustomInputConfig, 'enabled' | 'fields'>): string {
  return JSON.stringify([config.enabled, config.fields.map(field => [field.id, field.name, field.active])]);
}
function code(value: string): string { return value.trim().toUpperCase(); }

/** No sheet or no rows for this product means keep. Field deletion is always
 * explicit; omitted IDs cannot accidentally replace a whole definition. IDs for
 * added fields come only from the server's factory and become part of its plan. */
export function planGoodsCustomInputWorkbookRows(rows: readonly GoodsCustomInputWorkbookInputRow[] | null | undefined, context: {
  goodCode: string;
  existing: GoodsCustomInputConfig | null;
  newFieldId?: () => string;
}): GoodsCustomInputWorkbookPlan {
  const source = (rows ?? []).filter(row => code(row.values.goodCode) === code(context.goodCode));
  if (!source.length) return { kind: 'keep', warnings: [] };
  const errors = source.flatMap(row => (row.errors ?? []).map(error => `${GOODS_CUSTOM_INPUT_WORKBOOK_SHEET} ${row.row}행: ${error}`));
  const fail = (): GoodsCustomInputWorkbookPlan => ({ kind: 'error', errors: [...new Set(errors)], warnings: [] });
  if (!context.goodCode || source.length > GOODS_CUSTOM_INPUT_WORKBOOK_GROUP_LIMIT) {
    errors.push(`직접입력형 옵션은 상품코드와 상품당 ${GOODS_CUSTOM_INPUT_WORKBOOK_GROUP_LIMIT}행 이내의 편집이 필요합니다.`);
    return fail();
  }
  const existing = context.existing ?? EMPTY_GOODS_CUSTOM_INPUTS;
  const first = source[0].values;
  const mode = first.mode.trim();
  const enabledText = first.enabled.trim();
  const revision = first.revision.trim();
  if (!['편집', '전체 해제'].includes(mode)) errors.push('직접입력형 옵션의 변경 방식은 편집 또는 전체 해제입니다.');
  if (!['예', '아니오'].includes(enabledText)) errors.push('직접입력형 옵션의 전체 사용은 예 또는 아니오입니다.');
  if (!/^(0|[1-9][0-9]*)$/.test(revision) || Number(revision) > 2147483647 || Number(revision) !== existing.revision)
    errors.push('직접입력형 옵션의 정의 버전이 다릅니다. 최신 파일을 내려받아주세요. 새 상품은 0을 입력합니다.');
  for (const row of source) {
    if (row.values.mode.trim() !== mode || row.values.enabled.trim() !== enabledText || row.values.revision.trim() !== revision)
      errors.push(`직접입력형 옵션 ${row.row}행: 같은 상품의 변경 방식·전체 사용·정의 버전이 서로 다릅니다.`);
  }
  if (mode === '전체 해제') {
    if (source.length !== 1 || enabledText !== '아니오' || [first.fieldId, first.name, first.action].some(value => value.trim()))
      errors.push('전체 해제는 상품당 한 행에 전체 사용을 아니오로 입력하고 항목 ID·항목명·항목 처리를 비워주세요.');
    if (errors.length) return fail();
    if (!existing.enabled && !existing.fields.length) return { kind: 'keep', warnings: [] };
    return { kind: 'save', config: { enabled: false, fields: [] }, expectedRevision: existing.revision,
      warnings: [`직접입력형 옵션 ${existing.fields.length}개를 모두 해제합니다. 기존 주문 문구는 유지되며 장바구니 입력은 다시 확인해야 합니다.`] };
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const fields: GoodsCustomInputField[] = [];
  for (const row of source) {
    const label = `직접입력형 옵션 ${row.row}행`;
    const id = row.values.fieldId.trim().toLowerCase();
    const name = row.values.name.trim();
    const action = row.values.action.trim();
    if (!['사용', '중지', '삭제'].includes(action)) errors.push(`${label}: 항목 처리는 사용·중지·삭제 중 하나입니다.`);
    if (id) {
      if (!isUuid(id) || !existing.fields.some(field => field.id === id)) errors.push(`${label}: 이 상품의 기존 항목 ID가 아닙니다. 새 항목의 ID는 비워주세요.`);
      if (seenIds.has(id)) errors.push(`${label}: 항목 ID가 중복됩니다.`);
      seenIds.add(id);
    } else if (action === '삭제') errors.push(`${label}: 삭제할 기존 항목 ID가 필요합니다.`);
    if (action === '삭제') continue;
    if ([...name].length < 1 || [...name].length > GOODS_CUSTOM_INPUT_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name))
      errors.push(`${label}: 항목명은 ${GOODS_CUSTOM_INPUT_NAME_LIMIT}자 이하이며 줄바꿈·제어문자를 사용할 수 없습니다.`);
    if (seenNames.has(name)) errors.push(`${label}: 항목명이 중복됩니다.`);
    seenNames.add(name);
    fields.push({ id, name, active: action === '사용' });
  }
  if (existing.fields.some(field => !seenIds.has(field.id)))
    errors.push('기존 직접입력형 항목 ID를 모두 포함해주세요. 행을 지우지 말고 항목 처리를 중지 또는 삭제로 지정합니다.');
  if (!fields.length) errors.push('모든 직접입력형 항목을 지우려면 변경 방식을 전체 해제로 입력해주세요.');
  if (fields.length > GOODS_CUSTOM_INPUT_LIMIT) errors.push(`직접입력형 옵션은 삭제 후 최대 ${GOODS_CUSTOM_INPUT_LIMIT}개까지 설정할 수 있습니다.`);
  const enabled = enabledText === '예';
  if (enabled && !fields.some(field => field.active)) errors.push('전체 사용이 예이면 사용 중인 직접입력형 항목이 하나 이상 필요합니다.');
  if (fields.some(field => !field.id) && !context.newFieldId) errors.push('새 직접입력형 항목을 준비하지 못했습니다. 다시 검증해주세요.');
  if (errors.length) return fail();
  const nextFields = fields.map(field => ({ ...field, id: field.id || context.newFieldId!() }));
  const config = parseGoodsCustomInputConfig({ enabled, fields: nextFields, revision: existing.revision });
  if (!config) throw new Error('새 직접입력형 항목 ID를 준비하지 못했습니다. 다시 검증해주세요.');
  if (canonical(config) === canonical(existing)) return { kind: 'keep', warnings: [] };
  const added = nextFields.filter(field => !existing.fields.some(previous => previous.id === field.id)).length;
  const removed = existing.fields.filter(field => !nextFields.some(next => next.id === field.id)).length;
  const renamed = nextFields.filter(field => existing.fields.some(previous => previous.id === field.id && previous.name !== field.name)).length;
  const stopped = nextFields.filter(field => !field.active && existing.fields.some(previous => previous.id === field.id && previous.active)).length;
  const warnings = [
    ...(added ? [`직접입력형 항목 ${added}개를 추가합니다.`] : []),
    ...(renamed ? [`직접입력형 항목 ${renamed}개의 이름을 변경합니다.`] : []),
    ...(stopped ? [`직접입력형 항목 ${stopped}개를 중지합니다.`] : []),
    ...(removed ? [`직접입력형 항목 ${removed}개를 삭제합니다.`] : []),
    ...(enabled !== existing.enabled ? [enabled ? '직접입력형 옵션을 사용합니다.' : '항목을 보존하고 직접입력형 옵션의 전체 사용을 중지합니다.'] : []),
  ];
  if (!warnings.length) warnings.push('직접입력형 항목의 사용 상태 또는 순서를 변경합니다.');
  warnings.push('기존 주문 문구는 유지되며 장바구니 입력은 다시 확인해야 합니다.');
  return { kind: 'save', config: { enabled, fields: nextFields }, expectedRevision: existing.revision, warnings };
}

export function goodsCustomInputWorkbookOrphanErrors(rows: readonly GoodsCustomInputWorkbookInputRow[], goodCodes: readonly string[]): string[] {
  const codes = new Set(goodCodes.map(code));
  return rows.flatMap(row => !code(row.values.goodCode) || !codes.has(code(row.values.goodCode))
    ? [`직접입력형 옵션 ${row.row}행: 상품 시트에 같은 상품코드가 필요합니다. 자동코드는 초안 저장 후 다시 내려받아 연결해주세요.`] : []);
}

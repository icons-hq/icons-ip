import { GOODS_NOTICE_FIELDS } from '../goods-notice';

/**
 * 고시정보 프리셋 — 같은 제조사·원산지·A/S 정보를 굿즈마다 다시 치지 않게 한다.
 *
 * 저장소는 운영자의 브라우저다(서버 스키마 없음). 그래서 여기는 저장값을 믿을 수 있는
 * 모양으로 좁히는 순수 함수만 둔다 — 화면은 문자열을 읽고 쓰기만 한다. 서버 프리셋
 * (팀 공유)이 필요해지면 같은 모양을 RPC 로 옮긴다.
 */

export const GOODS_NOTICE_PRESETS_STORAGE_KEY = 'icons-admin.goods.notice-presets';
export const GOODS_NOTICE_PRESET_NAME_MAX = 40;
export const GOODS_NOTICE_PRESETS_MAX = 20;

export interface GoodsNoticePreset {
  name: string;
  /** FormData 키(noticeMaker …) 기준 값. 7칸 전부 있다(빈 문자열 허용). */
  values: Record<string, string>;
}

const FORM_NAMES: readonly string[] = GOODS_NOTICE_FIELDS.map((field) => field.formName);

function cleanName(input: unknown) {
  return typeof input === 'string' ? input.trim().slice(0, GOODS_NOTICE_PRESET_NAME_MAX) : '';
}

function cleanValues(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const name of FORM_NAMES) {
    const value = source[name];
    values[name] = typeof value === 'string' ? value.trim() : '';
  }
  return values;
}

export function parseGoodsNoticePresets(raw: string | null | undefined): GoodsNoticePreset[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const presets: GoodsNoticePreset[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const name = cleanName((entry as { name?: unknown }).name);
      const values = cleanValues((entry as { values?: unknown }).values);
      if (!name || !values || presets.some((preset) => preset.name === name)) continue;
      presets.push({ name, values });
    }
    return presets.slice(0, GOODS_NOTICE_PRESETS_MAX);
  } catch {
    return [];
  }
}

export function serializeGoodsNoticePresets(presets: readonly GoodsNoticePreset[]) {
  return JSON.stringify(presets);
}

/** 같은 이름이면 새 값으로 덮어쓰고 맨 뒤로 보낸다. 상한을 넘으면 가장 오래된 것부터 민다. */
export function upsertGoodsNoticePreset(
  presets: readonly GoodsNoticePreset[],
  name: string,
  values: Record<string, string>,
): GoodsNoticePreset[] {
  const cleaned = cleanName(name);
  if (!cleaned) return [...presets];
  const rest = presets.filter((preset) => preset.name !== cleaned);
  return [...rest, { name: cleaned, values: cleanValues(values) ?? {} }].slice(-GOODS_NOTICE_PRESETS_MAX);
}

export function removeGoodsNoticePreset(presets: readonly GoodsNoticePreset[], name: string) {
  return presets.filter((preset) => preset.name !== name);
}

/** 폼에서 고시정보 7칸만 뽑는다. 다른 입력은 프리셋에 섞이지 않는다. */
export function goodsNoticeValuesFromForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of FORM_NAMES) {
    const value = formData.get(name);
    values[name] = typeof value === 'string' ? value.trim() : '';
  }
  return values;
}

export function isGoodsNoticeComplete(values: Record<string, string>) {
  return FORM_NAMES.every((name) => Boolean(values[name]?.trim()));
}

import { GOODS_NOTICE_FIELDS } from '../goods-notice';

/**
 * 굿즈 신규 등록 임시 저장 — 운영자 브라우저에만 남는다.
 *
 * 긴 등록 폼(고시정보 7칸·설명·가격)을 채우다 탭을 닫거나 다른 화면으로 나가면 전부
 * 사라진다. 문자열 입력만 브라우저에 자동 저장하고 다음 등록 화면에서 되살린다.
 * 이미지 경로는 넣지 않는다 — 업로드 검증(artwork claim)에 묶인 값이라 낡은 경로를
 * 되살리면 저장이 막힌다. 파일은 다시 올린다.
 */

export const GOODS_DRAFT_STORAGE_KEY = 'icons-admin.goods.draft';

/** 임시 저장 대상 필드(FormData 키). 숨은 제어 필드·이미지 경로는 뺀다. */
export const GOODS_DRAFT_FIELDS: readonly string[] = [
  'id',
  'ipId',
  'name',
  'type',
  'price',
  'compareAtPrice',
  'badge',
  'stock',
  'initialStockQty',
  'description',
  ...GOODS_NOTICE_FIELDS.map((field) => field.formName),
];

/** 이 값들만 있으면 "아직 아무것도 안 쓴" 폼이다 — 저장하지 않는다. */
const BLANK_DEFAULTS: Record<string, string> = { price: '0', stock: 'ok' };

export interface GoodsDraft {
  /** ISO 시각. 배너에 "언제 저장됐는지"로 보여준다. */
  savedAt: string;
  values: Record<string, string>;
}

function pickDraftValues(source: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of GOODS_DRAFT_FIELDS) {
    const value = source[name];
    values[name] = typeof value === 'string' ? value : '';
  }
  return values;
}

/** 폼에서 읽은 값 중 임시 저장 대상만 남긴다. */
export function goodsDraftValues(values: Record<string, string>): Record<string, string> {
  return pickDraftValues(values);
}

export function isGoodsDraftBlank(values: Record<string, string>) {
  return GOODS_DRAFT_FIELDS.every((name) => {
    const value = (values[name] ?? '').trim();
    return value === '' || value === BLANK_DEFAULTS[name];
  });
}

export function serializeGoodsDraft(values: Record<string, string>, now = new Date()) {
  return JSON.stringify({ savedAt: now.toISOString(), values: pickDraftValues(values) });
}

export function parseGoodsDraft(raw: string | null | undefined): GoodsDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { savedAt, values } = parsed as { savedAt?: unknown; values?: unknown };
    if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return null;
    if (!values || typeof values !== 'object') return null;
    const picked = pickDraftValues(values as Record<string, unknown>);
    return isGoodsDraftBlank(picked) ? null : { savedAt, values: picked };
  } catch {
    return null;
  }
}

/** 배너 한 줄 — "g100 · 화산강림 아크릴 스탠드" 처럼 무엇의 임시본인지. */
export function describeGoodsDraft(draft: GoodsDraft) {
  const parts = [draft.values.id, draft.values.name].map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts.join(' · ') : '(ID·이름 미입력)';
}

export function formatGoodsDraftSavedAt(savedAt: string) {
  return new Date(savedAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

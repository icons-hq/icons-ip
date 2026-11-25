import { parseGoodsPricePeriodInput, toKstDateTimeInput } from './goods-price-periods';
import { goodsSalePeriodState, type GoodsSalePeriod } from '@/lib/goods-sale-period';

export const GOODS_SALE_PERIOD_FIELDS = ['salePeriodEnabled', 'saleStartsAt', 'saleEndsAt', 'salePeriodRevision'] as const;
export const GOODS_SALE_PERIOD_PRESETS = [3, 5, 7, 15, 30, 60, 90, 120] as const;

export function readGoodsSalePeriod(form: FormData):
  { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  if (!form.has('salePeriodEnabled')) return { ok: true, fields: {} };
  const enabled = form.get('salePeriodEnabled');
  const revision = String(form.get('salePeriodRevision') ?? '0');
  if (!['true', 'false'].includes(String(enabled)) || !/^(0|[1-9]\d*)$/.test(revision) || Number(revision) > 2147483647) {
    return { ok: false, error: '판매 시기 값을 읽지 못했습니다. 화면을 새로고침한 뒤 다시 저장해주세요.' };
  }
  const parsed = parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null,
    startsAt: enabled === 'true' ? form.get('saleStartsAt') : null,
    endsAt: enabled === 'true' ? form.get('saleEndsAt') : null });
  if (!parsed || enabled === 'true' && (!parsed.startsAt || !parsed.endsAt)) return {
    ok: false, error: '판매 시작·종료 시각을 모두 입력해주세요. 종료 시각은 시작 시각보다 늦어야 합니다.',
  };
  return { ok: true, fields: { sale_period: { startsAt: parsed.startsAt, endsAt: parsed.endsAt, expectedRevision: Number(revision) } } };
}

/** Include today in day presets, ending at the next KST midnight after the last sale day. */
export function goodsSalePeriodPreset(days: number, now = new Date()) {
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = Date.parse(`${today}T00:00:00+09:00`);
  return { saleStartsAt: toKstDateTimeInput(new Date(start).toISOString()),
    saleEndsAt: toKstDateTimeInput(new Date(start + days * 24 * 60 * 60 * 1000).toISOString()) };
}

/*
 * 입력을 한 줄로 되읽는 요약(docs/admin-screen-rules.md '글보다 화면' 3). 입력 방법을 글로 설명하는 대신 지금 값이 무슨 뜻인지 보여 준다.
 * 판매기간과 예약판매(lib/admin/goods-preorders.ts)가 같은 날짜 표기를 쓴다.
 */
interface KstInputParts { year: number; month: number; day: number; time: string | null; at: number }
/** `datetime-local`('YYYY-MM-DDTHH:mm')·`date`('YYYY-MM-DD') 입력값(KST)을 읽는다. 덜 채워졌거나 없는 날짜면 null. */
function kstInputParts(value: string | null | undefined): KstInputParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value ?? '');
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const at = Date.parse(`${year}-${month}-${day}T${hour ?? '00'}:${minute ?? '00'}:00+09:00`);
  if (!Number.isFinite(at) || new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null;
  return { year: Number(year), month: Number(month), day: Number(day), time: hour === undefined ? null : `${hour}:${minute}`, at };
}
function kstYear(now: Date | number): number {
  return Number(new Date(new Date(now).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 4));
}
/** '12월 1일 10:00'. 올해가 아니면 연도를 붙이고, `after`와 같은 해·같은 달이면 달을 줄인다('7일 23:59'). */
function kstPartsLabel(parts: KstInputParts, now: Date | number, after?: KstInputParts | null): string {
  const sameMonth = after && after.year === parts.year && after.month === parts.month;
  const year = parts.year !== kstYear(now) && !(after && after.year === parts.year) ? `${parts.year}년 ` : '';
  return `${year}${sameMonth ? '' : `${parts.month}월 `}${parts.day}일${parts.time ? ` ${parts.time}` : ''}`;
}
/** 입력값 하나를 '12월 1일 10:00'(날짜 칸은 '12월 20일')로. 읽을 수 없으면 null. */
export function kstInputLabel(value: string | null | undefined, now: Date | number = new Date()): string | null {
  const parts = kstInputParts(value);
  return parts ? kstPartsLabel(parts, now) : null;
}
/** 시작·끝 두 입력값을 '12월 1일 10:00부터 7일 23:59까지'로. 채워진 쪽만 읽고, 둘 다 없으면 null. `reversed`는 끝이 시작보다 앞이거나 같을 때. */
export function kstInputRangeLabel(startsAt: string | null | undefined, endsAt: string | null | undefined, now: Date | number = new Date()):
  { text: string; reversed: boolean } | null {
  const starts = kstInputParts(startsAt), ends = kstInputParts(endsAt);
  if (!starts && !ends) return null;
  const text = [starts ? `${kstPartsLabel(starts, now)}부터` : '', ends ? `${kstPartsLabel(ends, now, starts)}까지` : ''].filter(Boolean).join(' ');
  return { text, reversed: Boolean(starts && ends && ends.at <= starts.at) };
}

export interface GoodsReadback { text: string; problem: boolean }
/** 판매기간 되읽기: "12월 1일 10:00부터 7일 23:59까지 팝니다." 끝이 시작보다 앞이면 그 자리에서 알린다. 입력이 없으면 null. */
export function goodsSalePeriodReadback(values: { saleStartsAt?: string; saleEndsAt?: string }, now: Date | number = new Date()): GoodsReadback | null {
  const range = kstInputRangeLabel(values.saleStartsAt, values.saleEndsAt, now);
  if (!range) return null;
  return range.reversed ? { text: '판매 종료가 판매 시작보다 앞입니다. 날짜를 다시 확인해주세요.', problem: true } : { text: `${range.text} 팝니다.`, problem: false };
}

/*
 * 판매 시기(규칙 5 — 함께 쓸 수 없는 설정은 고를 때 막는다). 판매기간과 예약판매는 DB가 양방향으로 거절하므로
 * (20261020085302 goods_sale_period_preorder_conflict) 화면은 셋 중 하나만 고르게 하고 고른 것의 입력만 연다.
 */
export type GoodSaleTimingMode = 'now' | 'period' | 'preorder';
/** 저장된 상품의 예약판매 패널이 판매 시기 선택에 알리는 지금 상태. */
export interface SavedPreorderTimingStatus {
  state: 'loading' | 'error' | 'ready';
  /** 예약 연결이 남은 사용 중 옵션 수(접수 예정·접수 중·접수 종료·중지 모두 — [일반 재고 판매로 전환] 전까지 남는다). */
  linked: number;
  /** 지난 회차까지 모두 합한 예약 조건 수. */
  total: number;
  /** 지금 저장돼 있는 판매기간이 있는가. 있으면 상품을 저장해 끄기 전에는 예약판매를 저장할 수 없다. */
  salePeriodSaved: boolean;
  /** 운영자가 이 화면에서 예약판매를 골랐는가(아직 저장한 예약 조건이 없을 때의 선택). */
  wanted: boolean;
  /** 예약 연결을 푸는 버튼 이름(랜덤 판매는 모든 옵션 묶음 버튼). */
  stockSwitchLabel: string;
}
/**
 * 지금 고른 판매 시기. 판매기간을 켰으면 기간, 등록 화면은 예약 입력이 있으면 예약, 저장된 상품은 예약 연결이 남았거나 예약판매를 골랐으면 예약이다.
 * 저장된 상품의 예약 조건을 아직 읽지 못했으면(판매기간도 꺼져 있으면) 알 수 없어 null — 그동안은 고르지 못하게 잠근다.
 */
export function goodSaleTimingMode({ salePeriodEnabled, draftPreorder, saved }: {
  salePeriodEnabled: boolean; draftPreorder: boolean;
  /** 저장된 상품이 아니면 undefined, 저장된 상품인데 패널이 아직 알리지 않았으면 null. */
  saved?: Pick<SavedPreorderTimingStatus, 'state' | 'linked' | 'wanted'> | null;
}): GoodSaleTimingMode | null {
  if (salePeriodEnabled) return 'period';
  if (saved === undefined) return draftPreorder ? 'preorder' : 'now';
  if (!saved || saved.state !== 'ready') return null;
  return saved.linked > 0 || saved.wanted ? 'preorder' : 'now';
}

export function goodsSalePeriodPreview(values: Record<string, string>, now = new Date()): GoodsSalePeriod | undefined {
  const form = new FormData(); Object.entries(values).forEach(([key, value]) => form.set(key, value));
  const result = readGoodsSalePeriod(form);
  if (!result.ok || !result.fields.sale_period) return undefined;
  const { startsAt, endsAt } = result.fields.sale_period as { startsAt: string | null; endsAt: string | null };
  const state = goodsSalePeriodState(startsAt, endsAt, now.getTime());
  return { startsAt, endsAt, state, calculatedAt: now.toISOString(), nextChangeAt: state === 'scheduled' ? startsAt : state === 'open' ? endsAt : null };
}

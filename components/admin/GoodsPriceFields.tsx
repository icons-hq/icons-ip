'use client';

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { INSTANT_DISCOUNT_PERIOD_FIELD, formatWon, goodsDiscountRate, instantDiscountPeriodRequest, type GoodsInstantDiscountState, type GoodsPriceDraft, type GoodsPriceResolution } from '@/lib/admin/goods-price-editor';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { AdminField, AdminNotice } from './console/AdminKit';
import { AdminSelect } from './console/AdminSelect';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { GOOD_INPUT_CLASS, GOOD_NUMBER_INPUT_CLASS, GOOD_SUBPANEL_CLASS, GoodAmountField, GoodChoiceGroup, GoodChoiceOption } from './GoodEditorParts';

const RATE_HINT = '즉시할인(기간 포함)과 기간 할인·할인 프로모션에 모두 적용됩니다. 숨김이면 취소선·할인율 없이 결제 금액만 보이며, 결제 금액은 바뀌지 않습니다.';
/* ADM-004 #74: 두 문장. 서버는 판매가·할인가만 저장해 할인 단위가 남지 않으므로 다시 열면 원으로 보인다. */
const DISCOUNT_HINT = '판매가에서 뺄 금액(원) 또는 비율(%)이며, 저장 후 다시 열면 원 단위로 표시됩니다. 판매가를 바꿀 때는 할인도 다시 확인해주세요.';
const PERIOD_HINT = '기간 전·후에는 판매가로, 기간 중에는 할인가로 팝니다. 옵션마다 같은 할인 금액을 뺍니다.';

const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const at = (value: string) => KST.format(new Date(value));

/** 상품 편집이 다루지 않는 할인(managed)·불러오지 못한 할인 상태의 이유와 관리할 곳. */
function managedNotice(instant: GoodsInstantDiscountState | null) {
  if (!instant) return { title: '할인 정보를 불러오지 못했습니다', body: '즉시할인은 지금 바꿀 수 없습니다. 새로고침한 뒤 다시 확인해주세요. 다른 입력은 그대로 저장됩니다.' };
  const summary = instant.summary;
  const range = summary ? `${summary.minPrice === summary.maxPrice ? formatWon(summary.minPrice) : `${formatWon(summary.minPrice)} ~ ${formatWon(summary.maxPrice)}`} · ${at(summary.startsAt)} ~ ${at(summary.endsAt)}` : '';
  const source = instant.reason === 'promotion'
    ? `할인 프로모션 ${instant.promotions.map((promotion) => `‘${promotion.name}’`).join(', ') || ''}이 건 할인입니다. 할인 프로모션 화면에서 관리합니다.`
    : instant.reason === 'instant'
      ? '기간 없는 즉시할인과 기간 할인이 함께 걸려 있습니다. 아래 이어서 설정의 기간 할인에서 기간 할인을 먼저 중지해주세요.'
      : '옵션마다 금액이나 기간이 다른 기간 할인입니다. 아래 이어서 설정의 기간 할인에서 관리합니다.';
  const uncovered = instant.uncovered ? `할인이 걸리지 않은 옵션이 있습니다(${instant.uncovered.toLocaleString('ko-KR')}개). 그 옵션은 기간 중에도 판매가로 팔립니다. ` : '';
  return { title: `진행 중이거나 예정된 기간 할인 ${summary?.count.toLocaleString('ko-KR') ?? ''}건이 있습니다`, body: `${range ? `${range}. ` : ''}${uncovered}${source} 그 할인이 끝나거나 중지되기 전에는 즉시할인을 바꿀 수 없습니다.` };
}

/**
 * 스마트스토어식 판매가 → 즉시할인(+ 특정기간만 할인) → 할인율 표시(TKT-033·ADR-0040). 화면 입력은 이름을 가진 보조 값이고,
 * 서버로 가는 `price`·`compareAtPrice`와 즉시할인 기간 지시(`instantDiscountPeriod`)는 아래 hidden 입력이 한 곳에서 만든다.
 * `instant`는 저장된 상품의 진행·예정 기간 할인 상태(새 상품은 NEW_GOOD_INSTANT_DISCOUNT, 불러오지 못했으면 null)다.
 */
export function GoodsPriceFields({ draft, onDraftChange, result, errors, instant, showDiscountRate = 'true' }: {
  draft: GoodsPriceDraft;
  onDraftChange: Dispatch<SetStateAction<GoodsPriceDraft>>;
  result: GoodsPriceResolution;
  errors: Record<string, string | undefined>;
  instant?: GoodsInstantDiscountState | null;
  showDiscountRate?: string;
}) {
  const regularRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  /* 서버 검증(소비자가 > 기준 판매가·기간)을 어기는 값은 브라우저 검증에서 먼저 막는다. */
  useEffect(() => { regularRef.current?.setCustomValidity(result.regularPriceError ?? ''); }, [result.regularPriceError]);
  useEffect(() => { discountRef.current?.setCustomValidity(result.discountError ?? ''); }, [result.discountError]);
  useEffect(() => { startRef.current?.setCustomValidity(result.periodError ?? ''); }, [result.periodError]);
  const change = (changes: Partial<GoodsPriceDraft>) => onDraftChange((current) => ({ ...current, ...changes }));
  /* 상태를 모르거나(null) 다른 곳에서 관리하는 할인(managed)이 있으면 즉시할인을 바꾸지 않는다. 새 상품·저장 전은 늘 바꿀 수 있다. */
  const locked = instant === null || instant?.state === 'managed';
  const notice = locked ? managedNotice(instant ?? null) : null;
  const discountOff = !draft.discountEnabled;
  const periodOn = Boolean(draft.periodEnabled);
  const periodOff = discountOff || !periodOn;
  const regularError = result.regularPriceError ?? errors.regularPrice ?? errors.price ?? (draft.discountEnabled ? undefined : errors.compareAtPrice);
  const discountError = result.discountError ?? errors.discountValue ?? (draft.discountEnabled ? errors.compareAtPrice : undefined);
  const periodError = result.periodError ?? errors.discountPeriod;
  const request = instantDiscountPeriodRequest(result, instant === undefined ? undefined : instant);

  return <div className="flex min-w-0 flex-col gap-5" data-good-price-editor="">
    <AdminField inputId="goods-regular-price" label={`${ADMIN_VOCABULARY.salePrice} (필수)`} hint="할인 전 가격입니다. 옵션가는 이 금액(기간 없이 할인하면 할인가)에 더합니다." error={regularError}>
      <GoodAmountField unit="원">
        <input ref={regularRef} className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" id="goods-regular-price" name="regularPrice" type="number" min={0} max={2147483647} step={1} inputMode="numeric" placeholder="0"
          aria-describedby={`goods-regular-price-hint${regularError ? ' goods-regular-price-error' : ''}`} aria-invalid={regularError ? 'true' : undefined}
          value={draft.regularPrice} onChange={(event) => change({ regularPrice: event.target.value })} />
      </GoodAmountField>
    </AdminField>

    <div className="flex min-w-0 flex-col gap-4" data-good-instant-discount="">
      <GoodChoiceGroup legend={ADMIN_VOCABULARY.instantDiscount} disabled={locked}>
        <GoodChoiceOption name="discountEnabled" value="true" checked={draft.discountEnabled} onChange={() => change({ discountEnabled: true })}>설정함</GoodChoiceOption>
        <GoodChoiceOption name="discountEnabled" value="false" checked={!draft.discountEnabled} onChange={() => change({ discountEnabled: false })}>설정안함</GoodChoiceOption>
      </GoodChoiceGroup>
      {/* 잠긴 라디오는 제출되지 않는다. 복구용 값만 남긴다. */}
      {locked ? <input type="hidden" name="discountEnabled" value={String(draft.discountEnabled)} /> : null}
      {notice ? <div data-good-instant-discount-managed={instant?.reason ?? 'unknown'}><AdminNotice tone="info" title={notice.title}>
        <p>{notice.body}</p>
        {instant && instant.reason !== 'promotion' ? <a className="mt-1 inline-block underline underline-offset-4" href="#good-operation-prices">기간 할인으로 이동</a> : null}
        {instant?.reason === 'promotion' ? <a className="mt-1 inline-block underline underline-offset-4" href="/admin/sales/discount-promotions" target="_blank" rel="noreferrer">할인 프로모션 열기 (새 탭)</a> : null}
      </AdminNotice></div> : null}

      {/*
        설정안함이어도 입력은 지우지 않는다. 다시 켜면 이전 값을 이어 쓴다.
        숨긴 입력도 브라우저 검증 대상이라 disabled로 검증·제출에서 빼고, 복구용 값만 hidden으로 보낸다.
      */}
      <div className={GOOD_SUBPANEL_CLASS} data-good-price-discount="" hidden={discountOff}>
        <AdminField inputId="goods-discount-value" label="할인 금액 또는 할인율" hint={DISCOUNT_HINT} error={discountError}>
          <GoodAmountField>
            <input ref={discountRef} className={GOOD_NUMBER_INPUT_CLASS} data-slot="input" id="goods-discount-value" name="discountValue" type="number" step="any" min={0} inputMode="decimal" disabled={discountOff || locked}
              aria-describedby={`goods-discount-value-hint${discountError ? ' goods-discount-value-error' : ''}`} aria-invalid={discountError ? 'true' : undefined}
              value={draft.discountValue} onChange={(event) => change({ discountValue: event.target.value })} />
            <NativeSelect aria-label="할인 단위" className="w-20 shrink-0" name="discountUnit" disabled={discountOff || locked} value={draft.discountUnit} onChange={(event) => change({ discountUnit: event.target.value === 'percent' ? 'percent' : 'won' })}>
              <option value="won">원</option><option value="percent">%</option>
            </NativeSelect>
          </GoodAmountField>
        </AdminField>
        <p className="text-sm text-muted-foreground tabular-nums" data-good-price-result="" role="status">
          {result.discountAmount > 0 && result.salePrice !== null
            ? <>{periodOn ? '기간 중 ' : ''}할인가 <strong className="text-base font-semibold text-foreground">{formatWon(result.salePrice)}</strong> ({formatWon(result.discountAmount)}, {goodsDiscountRate(result.regularPrice ?? 0, result.salePrice)}% 할인)</>
            : '할인 금액을 입력하면 할인가를 계산합니다.'}
        </p>
        {/* 기간 지시를 서버로 보낼 수 없는 곳(상태를 넘기지 않는 화면)에는 특정기간만 할인을 두지 않는다. */}
        {instant !== undefined ? <><label className="inline-flex min-h-8 w-fit cursor-pointer items-center gap-2 text-sm font-medium text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <input type="checkbox" name="discountPeriodEnabled" value="true" checked={periodOn} disabled={discountOff || locked}
            onChange={(event) => change({ periodEnabled: event.target.checked })} />특정기간만 할인
        </label>
        <div className="flex min-w-0 flex-col gap-3" data-good-price-period="" hidden={periodOff}>
          <div className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
            <AdminField inputId="goods-discount-start" label="할인 시작 · 한국시간" hint={PERIOD_HINT} error={periodError}>
              <input ref={startRef} className={GOOD_INPUT_CLASS} data-slot="input" id="goods-discount-start" name="discountStartsAt" type="datetime-local" disabled={periodOff || locked} required
                aria-describedby={`goods-discount-start-hint${periodError ? ' goods-discount-start-error' : ''}`} aria-invalid={periodError ? 'true' : undefined}
                value={draft.periodStartsAt ?? ''} onChange={(event) => change({ periodStartsAt: event.target.value })} />
            </AdminField>
            <AdminField inputId="goods-discount-end" label="할인 종료 · 한국시간">
              <input className={GOOD_INPUT_CLASS} data-slot="input" id="goods-discount-end" name="discountEndsAt" type="datetime-local" disabled={periodOff || locked} required
                aria-invalid={periodError ? 'true' : undefined} value={draft.periodEndsAt ?? ''} onChange={(event) => change({ periodEndsAt: event.target.value })} />
            </AdminField>
          </div>
          {result.period && result.regularPrice !== null
            ? <p className="text-sm text-muted-foreground tabular-nums" data-good-price-period-result="">{at(result.period.startsAt)} ~ {at(result.period.endsAt)} 할인가 {formatWon(result.regularPrice - result.period.amount)}, 그 밖에는 판매가 {formatWon(result.regularPrice)}입니다. 종료 시각부터 판매가로 돌아갑니다.</p>
            : null}
        </div></> : null}
      </div>
      {discountOff || locked ? <>
        <input type="hidden" name="discountValue" value={draft.discountValue} />
        <input type="hidden" name="discountUnit" value={draft.discountUnit} />
      </> : null}
      {periodOff || locked ? <>
        {periodOn ? <input type="hidden" name="discountPeriodEnabled" value="true" /> : null}
        <input type="hidden" name="discountStartsAt" value={draft.periodStartsAt ?? ''} />
        <input type="hidden" name="discountEndsAt" value={draft.periodEndsAt ?? ''} />
      </> : null}
      <GoodsDiscountRateField value={showDiscountRate} error={errors.showDiscountRate} />
    </div>
    <input type="hidden" name="price" value={result.price} />
    <input type="hidden" name="compareAtPrice" value={result.compareAtPrice} />
    {request ? <input type="hidden" name={INSTANT_DISCOUNT_PERIOD_FIELD} value={request} /> : null}
  </div>;
}

/**
 * 고객 화면 할인율 표시(기본 표시). 원래 요청 '할인율 노출 여부·할인 기간'을 한 자리에서 다루도록 즉시할인 블록 안에 둔다(TKT-033).
 * 기간 할인·할인 프로모션에도 쓰이므로 즉시할인 설정과 상관없이 늘 보이고 같은 값을 제출한다.
 */
export function GoodsDiscountRateField({ value, error }: { value: string; error?: string }) {
  return <AdminField inputId="goods-show-discount-rate" label="고객 화면에 할인율 표시" hint={RATE_HINT} error={error}>
    <AdminSelect id="goods-show-discount-rate" name="showDiscountRate" className="w-full" wrapperClassName="w-full max-w-xs" defaultValue={value}
      aria-describedby={`goods-show-discount-rate-hint${error ? ' goods-show-discount-rate-error' : ''}`} aria-invalid={error ? 'true' : undefined}>
      <option value="true">표시</option><option value="false">숨김 · 할인가만 표시</option>
    </AdminSelect>
  </AdminField>;
}

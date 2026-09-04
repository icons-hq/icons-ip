'use client';

import { useActionState, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  adjustVariantStockAction,
  saveGoodVariantsAction,
  setVariantSafetyAction,
  transferVariantStockAction,
} from '@/app/admin/variant-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import {
  STOCK_MOVEMENT_REASONS,
  STOCK_SOURCE_LABELS,
  VARIANT_OPTION_LIMIT,
  effectiveVariantLocationId,
  generateVariantCombinations,
  variantAvailable,
  variantOptionSummary,
  variantSignature,
  type AdminGoodVariant,
  type AdminGoodVariantEditorData,
  type AdminVariantBatchPayload,
} from '@/lib/admin/variants';
import { Icon } from '@/components/ui/Icon';
import { Field, InlineNotice, SelectField, TextArea } from '../fields';

/*
 * 품목 표 (설계서 v2 §1-1 · 등록 탭 ③).
 *
 * 옵션 마스터에서 옵션(≤3)과 값을 고르면 조합이 곧 품목 행이다. 옵션이 없으면 기본 품목 1행이 곧 상품.
 * 수량은 두 입구뿐이다 — 새 품목의 초기 재고(이 표) · 기존 품목의 재고 조정(아래 카드). 이 표의 저장은
 * `admin_upsert_variants` 한 번(배치 멱등 키)으로 간다. 폼 안에 폼을 둘 수 없어 굿즈 저장 폼 밖에 산다.
 */

const emptyState: AdminCatalogActionState = {};

interface VariantRow {
  key: string;
  id: string | null;
  code: string | null;
  values: Record<string, string>;
  customCode: string;
  additionalPrice: string;
  display: boolean;
  sellable: boolean;
  locationId: string;
  archived: boolean;
  isDefault: boolean;
  stocks: AdminGoodVariant['stocks'];
  /** 새 품목: 출고지별 초기 재고 입력. */
  initial: Record<string, string>;
}

interface OptionChoice {
  optionId: string;
  valueIds: string[];
}

function rowFromVariant(variant: AdminGoodVariant): VariantRow {
  return {
    key: variant.id,
    id: variant.id,
    code: variant.code,
    values: variant.values,
    customCode: variant.customCode ?? '',
    additionalPrice: String(variant.additionalPrice),
    display: variant.display,
    sellable: variant.sellable,
    locationId: variant.locationId ?? '',
    archived: variant.archivedAt !== null,
    isDefault: variant.isDefault,
    stocks: variant.stocks,
    initial: {},
  };
}

function initialChoices(editor: AdminGoodVariantEditorData): OptionChoice[] {
  return [...editor.options]
    .sort((a, b) => a.position - b.position)
    .map((option) => ({
      optionId: option.optionId,
      valueIds: Array.from(new Set(
        editor.variants
          .filter((variant) => variant.archivedAt === null)
          .map((variant) => variant.values[option.optionId])
          .filter((valueId): valueId is string => Boolean(valueId)),
      )),
    }));
}

/*
 * 옵션 모드에서는 기본 품목을 보내지 않는다 — RPC 가 옵션 도입 시 기본 품목을 스스로 보관한다.
 * 옵션이 없으면 기본 품목 1행만 보낸다(다른 행은 RPC 가 variant_options_required 로 거부한다).
 */
function buildPayload(choices: OptionChoice[], rows: VariantRow[]): AdminVariantBatchPayload {
  const options = choices.map((choice, index) => ({ optionId: choice.optionId, position: index + 1 }));
  const optionMode = options.length > 0;
  return {
    options,
    variants: rows
      .filter((row) => (optionMode ? !row.isDefault : row.isDefault))
      .filter((row) => row.id !== null || !row.archived)
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        customCode: row.customCode.trim() || null,
        ...(options.length > 0 ? { values: row.values } : {}),
        additionalPrice: Number.parseInt(row.additionalPrice || '0', 10) || 0,
        display: row.display,
        sellable: row.sellable,
        locationId: row.locationId || null,
        ...(row.id ? { archived: row.archived } : {}),
        ...(row.id
          ? {}
          : {
            initialStocks: Object.entries(row.initial)
              .filter(([, qty]) => /^\d+$/.test(qty.trim()) && Number(qty) > 0)
              .map(([locationId, qty]) => ({ locationId, onHandQty: Number(qty) })),
          }),
      })),
  };
}

export function GoodVariantsPanel({
  batchId,
  editor,
  goodName,
}: {
  /** `admin_upsert_variants` 의 배치 멱등 키. 서버 컴포넌트가 요청당 하나 만든다. */
  batchId: string;
  editor: AdminGoodVariantEditorData;
  goodName: string;
}) {
  const [state, action, pending] = useActionState(saveGoodVariantsAction, emptyState);
  const [choices, setChoices] = useState<OptionChoice[]>(() => initialChoices(editor));
  const [rows, setRows] = useState<VariantRow[]>(() => editor.variants.map(rowFromVariant));
  const activeLocations = editor.locations.filter((location) => location.active);
  const activeMasters = editor.masters.filter((master) => master.archivedAt === null);
  const options = choices.map((choice, index) => ({ optionId: choice.optionId, position: index + 1 }));
  const optionMode = choices.length > 0;

  const payload = useMemo(() => JSON.stringify(buildPayload(choices, rows)), [choices, rows]);
  const liveVariants = editor.variants.filter((variant) => variant.archivedAt === null);
  const archivedWithStock = editor.variants.filter(
    (variant) => variant.archivedAt !== null && variant.stocks.some((stock) => stock.onHand > 0),
  );

  function updateRow(key: string, patch: Partial<VariantRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function setChoiceOption(index: number, optionId: string) {
    setChoices((current) => {
      const next = current.slice();
      if (!optionId) {
        next.splice(index, 1);
      } else {
        next[index] = { optionId, valueIds: [] };
      }
      return next;
    });
  }

  function toggleValue(optionId: string, valueId: string, checked: boolean) {
    setChoices((current) => current.map((choice) => (
      choice.optionId === optionId
        ? { ...choice, valueIds: checked ? [...choice.valueIds, valueId] : choice.valueIds.filter((id) => id !== valueId) }
        : choice
    )));
  }

  /* 조합 생성: 서명이 같은 기존 행은 그대로, 없는 조합만 새 행으로 붙인다. 목록에서 빠진 기존 행은 건드리지 않는다. */
  function generateRows() {
    const combos = generateVariantCombinations(choices);
    setRows((current) => {
      const bySignature = new Map(current.map((row) => [variantSignature(row.values, options), row]));
      const next = current.filter((row) => row.isDefault === false || row.id !== null);
      for (const values of combos) {
        const signature = variantSignature(values, options);
        if (bySignature.has(signature)) continue;
        next.push({
          key: `new:${signature}`,
          id: null,
          code: null,
          values,
          customCode: '',
          additionalPrice: '0',
          display: true,
          sellable: true,
          locationId: '',
          archived: false,
          isDefault: false,
          stocks: [],
          initial: {},
        });
        bySignature.set(signature, next[next.length - 1]);
      }
      return next;
    });
  }

  function removeNewRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  const visibleRows = rows.filter((row) => (optionMode ? !row.isDefault || row.id === null : true));

  return (
    <section aria-labelledby={`variants-${editor.goodId}`} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <span className="eyebrow">VARIANTS</span>
          <h2 id={`variants-${editor.goodId}`} style={{ fontSize: 18, margin: '6px 0 0' }}>품목 · 재고</h2>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {goodName} · 판매 가능 {liveVariants.reduce((sum, variant) => sum + Math.max(0, variant.stocks.reduce((acc, stock) => acc + variantAvailable(stock), 0)), 0).toLocaleString('ko-KR')}개
        </span>
      </div>

      <form action={action} className="col" style={{ gap: 12 }}>
        <input name="goodId" type="hidden" value={editor.goodId} />
        <input name="batchId" type="hidden" value={batchId} />
        <input name="payload" type="hidden" value={payload} />

        <fieldset className="admin-variant-options">
          <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>옵션 (최대 {VARIANT_OPTION_LIMIT})</legend>
          <div className="col" style={{ gap: 10 }}>
            {Array.from({ length: Math.min(VARIANT_OPTION_LIMIT, choices.length + 1) }).map((_, index) => {
              const choice = choices[index];
              const master = choice ? activeMasters.find((entry) => entry.id === choice.optionId) : null;
              return (
                <div className="admin-variant-option-row" key={choice?.optionId ?? `slot-${index}`}>
                  <select
                    aria-label={`옵션 ${index + 1}`}
                    className="admin-field-control"
                    onChange={(event) => setChoiceOption(index, event.target.value)}
                    value={choice?.optionId ?? ''}
                  >
                    <option value="">{choice ? '옵션 제거' : '옵션 추가'}</option>
                    {activeMasters
                      .filter((entry) => !choices.some((other, otherIndex) => other.optionId === entry.id && otherIndex !== index))
                      .map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.code})</option>)}
                  </select>
                  {master ? (
                    <div className="admin-variant-values" role="group" aria-label={`${master.name} 값`}>
                      {master.values.filter((value) => value.archivedAt === null).map((value) => (
                        <label className="admin-variant-value" key={value.id}>
                          <input
                            checked={choice?.valueIds.includes(value.id) ?? false}
                            onChange={(event) => toggleValue(master.id, value.id, event.target.checked)}
                            type="checkbox"
                          />
                          {value.value}
                        </label>
                      ))}
                      {master.values.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>옵션 마스터에 값을 먼저 등록하세요.</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {activeMasters.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>옵션 마스터가 없습니다. 상품 › 옵션 마스터에서 먼저 만드세요.</p>
            ) : null}
            {optionMode ? (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm btn-ghost" disabled={choices.some((choice) => choice.valueIds.length === 0)} onClick={generateRows} type="button">
                  <Icon name="plus" size={14} /> 조합으로 품목 생성
                </button>
                <span className="muted" style={{ fontSize: 12 }}>고른 값의 조합마다 품목 1행. 이미 있는 조합은 그대로 둔다.</span>
              </div>
            ) : null}
          </div>
        </fieldset>

        {optionMode && liveVariants.some((variant) => variant.isDefault) ? (
          <p className="muted" role="note" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
            옵션을 처음 붙이면 기본 품목은 보관되고, 그 재고는 「재고 이동」으로 새 품목에 옮겨야 판매 수량에 잡힙니다.
          </p>
        ) : null}

        <div className="admin-console-grid-scroll">
          <table className="admin-console-grid-table admin-variants-table">
            <thead>
              <tr>
                <th scope="col">품목</th>
                <th scope="col">코드</th>
                <th scope="col">자체 품목코드</th>
                <th data-align="end" scope="col">추가금액</th>
                <th scope="col">출고지</th>
                {activeLocations.map((location) => (
                  <th data-align="end" key={location.id} scope="col">{location.name}<br /><span className="muted" style={{ fontWeight: 400 }}>보유 / 예약 / 안전</span></th>
                ))}
                <th scope="col">진열</th>
                <th scope="col">판매</th>
                <th scope="col">보관</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const summary = optionMode
                  ? (variantOptionSummary(row.values, editor.masters, options) || (row.id ? '기본 품목' : ''))
                  : '기본 품목 (옵션 없음)';
                return (
                  <tr data-variant-row={row.id ?? 'new'} key={row.key}>
                    <td>
                      {summary || <span className="muted">(옵션값 없음)</span>}
                      {row.archived && row.id ? <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>보관</span> : null}
                    </td>
                    <td className="mono">{row.code ?? <span className="muted">저장 시 부여</span>}</td>
                    <td>
                      <input
                        aria-label="자체 품목코드"
                        className="admin-field-control"
                        maxLength={60}
                        onChange={(event) => updateRow(row.key, { customCode: event.target.value })}
                        placeholder="ERP 품목코드"
                        value={row.customCode}
                      />
                    </td>
                    <td data-align="end">
                      <input
                        aria-label="추가금액"
                        className="admin-field-control"
                        disabled={!optionMode}
                        inputMode="numeric"
                        onChange={(event) => updateRow(row.key, { additionalPrice: event.target.value })}
                        style={{ textAlign: 'right', width: 96 }}
                        value={optionMode ? row.additionalPrice : '0'}
                      />
                    </td>
                    <td>
                      <select
                        aria-label="출고지"
                        className="admin-field-control"
                        onChange={(event) => updateRow(row.key, { locationId: event.target.value })}
                        value={row.locationId}
                      >
                        <option value="">상품 기본값 상속</option>
                        {activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                      </select>
                    </td>
                    {activeLocations.map((location) => {
                      const stock = row.stocks.find((entry) => entry.locationId === location.id);
                      if (row.id) {
                        return (
                          <td className="mono" data-align="end" key={location.id}>
                            {stock ? `${stock.onHand.toLocaleString('ko-KR')} / ${stock.reserved.toLocaleString('ko-KR')} / ${stock.safety.toLocaleString('ko-KR')}` : '-'}
                          </td>
                        );
                      }
                      return (
                        <td data-align="end" key={location.id}>
                          <input
                            aria-label={`${location.name} 초기 재고`}
                            className="admin-field-control"
                            inputMode="numeric"
                            onChange={(event) => updateRow(row.key, { initial: { ...row.initial, [location.id]: event.target.value } })}
                            placeholder="0"
                            style={{ textAlign: 'right', width: 80 }}
                            value={row.initial[location.id] ?? ''}
                          />
                        </td>
                      );
                    })}
                    <td><input aria-label="진열" checked={row.display} onChange={(event) => updateRow(row.key, { display: event.target.checked })} type="checkbox" /></td>
                    <td><input aria-label="판매" checked={row.sellable} onChange={(event) => updateRow(row.key, { sellable: event.target.checked })} type="checkbox" /></td>
                    <td>
                      {row.id ? (
                        <input aria-label="보관" checked={row.archived} onChange={(event) => updateRow(row.key, { archived: event.target.checked })} type="checkbox" />
                      ) : (
                        <button aria-label="행 제거" className="btn btn-sm btn-ghost" onClick={() => removeNewRow(row.key)} type="button">제거</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 ? (
                <tr><td className="muted" colSpan={8 + activeLocations.length}>품목이 없습니다. 옵션 값을 고르고 「조합으로 품목 생성」을 누르세요.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <InlineNotice state={state} />
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <button className="btn btn-holo" disabled={pending} style={{ minWidth: 150 }}>
            <Icon name="check" size={15} /> {pending ? '저장 중' : '품목 저장'}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>기존 품목의 수량은 아래 재고 조정으로만 바뀝니다.</span>
        </div>
      </form>

      {archivedWithStock.length > 0 ? (
        <p className="muted" role="note" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          보관된 품목에 재고가 남아 있습니다: {archivedWithStock.map((variant) => `${variant.code} ${variant.stocks.reduce((sum, stock) => sum + stock.onHand, 0)}개`).join(', ')}. 재고 이동으로 옮기세요.
        </p>
      ) : null}

      <div className="admin-variant-stock-forms">
        <VariantStockAdjustForm editor={editor} />
        <VariantTransferForm editor={editor} />
        <VariantSafetyForm editor={editor} />
      </div>
    </section>
  );
}

function variantLabel(variant: AdminGoodVariant, editor: AdminGoodVariantEditorData) {
  const summary = variantOptionSummary(variant.values, editor.masters, editor.options);
  const name = summary || (variant.isDefault ? '기본 품목' : variant.code);
  return `${variant.code}${summary ? ` · ${name}` : variant.isDefault ? ' · 기본 품목' : ''}${variant.archivedAt ? ' [보관]' : ''}`;
}

/** 제출 직전에 새 멱등 키를 만든다 — 같은 폼을 다시 보내도 서버가 이전 요청과 섞지 않는다. */
function stampMovementId(event: FormEvent<HTMLFormElement>, name: string) {
  const input = event.currentTarget.elements.namedItem(name);
  if (input instanceof HTMLInputElement) input.value = crypto.randomUUID();
}

function VariantStockAdjustForm({ editor }: { editor: AdminGoodVariantEditorData }) {
  const [state, action, pending] = useActionState(adjustVariantStockAction, emptyState);
  const formRef = useRef<HTMLFormElement>(null);
  const variants = editor.variants;
  const [variantId, setVariantId] = useState(variants.find((variant) => variant.archivedAt === null)?.id ?? variants[0]?.id ?? '');
  const variant = variants.find((entry) => entry.id === variantId) ?? null;
  const [locationId, setLocationId] = useState(variant ? effectiveVariantLocationId(variant, editor.defaultLocationId) : editor.defaultLocationId);
  const stock = variant?.stocks.find((entry) => entry.locationId === locationId) ?? null;
  const [reason, setReason] = useState<string>('receive');

  if (variants.length === 0) return null;

  return (
    <form
      action={action}
      className="card col admin-variant-stock-form"
      onSubmit={(event) => stampMovementId(event, 'movementId')}
      ref={formRef}
      style={{ borderRadius: 8, gap: 10, padding: 14 }}
    >
      <h3 style={{ fontSize: 15, margin: 0 }}>재고 조정</h3>
      <input name="goodId" type="hidden" value={editor.goodId} />
      <input name="movementId" type="hidden" value="" />
      <input name="expectedOnHand" type="hidden" value={stock?.onHand ?? 0} />
      <div className="admin-form-grid">
        <SelectField label="품목" name="variantId" onChange={(event) => setVariantId(event.target.value)} value={variantId}>
          {variants.map((entry) => <option key={entry.id} value={entry.id}>{variantLabel(entry, editor)}</option>)}
        </SelectField>
        <SelectField label="출고지" name="locationId" onChange={(event) => setLocationId(event.target.value)} value={locationId}>
          {editor.locations.filter((location) => location.active).map((location) => (
            <option key={location.id} value={location.id}>{location.name}</option>
          ))}
        </SelectField>
      </div>
      <p className="mono muted" style={{ fontSize: 12, margin: 0 }}>
        현재 보유 {stock?.onHand.toLocaleString('ko-KR') ?? 0}개 · 예약 {stock?.reserved.toLocaleString('ko-KR') ?? 0}개 · 가용 {(stock ? variantAvailable(stock) : 0).toLocaleString('ko-KR')}개
        {stock?.lastSource ? ` · 마지막 반영 ${STOCK_SOURCE_LABELS[stock.lastSource] ?? stock.lastSource}` : ''}
      </p>
      <div className="admin-form-grid">
        <Field error={state.errors?.delta} label="조정 수량 (+입고 / -차감)" name="delta" placeholder="10 또는 -3" required step={1} type="number" />
        <SelectField error={state.errors?.reasonCode} label="조정 사유" name="reasonCode" onChange={(event) => setReason(event.target.value)} value={reason}>
          {STOCK_MOVEMENT_REASONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </SelectField>
        <TextArea error={state.errors?.note} label={reason === 'correction' ? '사유 (필수)' : '메모'} maxLength={200} name="note" placeholder="입고 전표 번호, 실사 결과 등" required={reason === 'correction'} />
      </div>
      <InlineNotice state={state} />
      <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 140 }}>
        <Icon name="plus" size={15} /> {pending ? '조정 중' : '재고 조정'}
      </button>
    </form>
  );
}

function VariantTransferForm({ editor }: { editor: AdminGoodVariantEditorData }) {
  const [state, action, pending] = useActionState(transferVariantStockAction, emptyState);
  const variants = editor.variants;
  const locations = editor.locations.filter((location) => location.active);
  if (variants.length === 0 || (variants.length < 2 && locations.length < 2)) return null;

  return (
    <form action={action} className="card col admin-variant-stock-form" onSubmit={(event) => stampMovementId(event, 'movementId')} style={{ borderRadius: 8, gap: 10, padding: 14 }}>
      <h3 style={{ fontSize: 15, margin: 0 }}>재고 이동</h3>
      <input name="goodId" type="hidden" value={editor.goodId} />
      <input name="movementId" type="hidden" value="" />
      <div className="admin-form-grid">
        <SelectField label="출발 품목" name="fromVariantId">
          {variants.map((entry) => <option key={entry.id} value={entry.id}>{variantLabel(entry, editor)}</option>)}
        </SelectField>
        <SelectField label="출발 출고지" name="fromLocationId">
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </SelectField>
        <SelectField error={state.errors?.toVariantId} label="도착 품목" name="toVariantId">
          {variants.filter((entry) => entry.archivedAt === null).map((entry) => <option key={entry.id} value={entry.id}>{variantLabel(entry, editor)}</option>)}
        </SelectField>
        <SelectField error={state.errors?.toLocationId} label="도착 출고지" name="toLocationId">
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </SelectField>
        <Field error={state.errors?.qty} label="이동 수량" min={1} name="qty" placeholder="0" required step={1} type="number" />
        <Field label="메모" name="note" placeholder="옵션 도입 이관, 창고 이동 등" />
      </div>
      <InlineNotice state={state} />
      <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 140 }}>
        <Icon name="check" size={15} /> {pending ? '이동 중' : '재고 이동'}
      </button>
    </form>
  );
}

function VariantSafetyForm({ editor }: { editor: AdminGoodVariantEditorData }) {
  const [state, action, pending] = useActionState(setVariantSafetyAction, emptyState);
  const variants = editor.variants.filter((variant) => variant.archivedAt === null);
  if (variants.length === 0) return null;

  return (
    <form action={action} className="card col admin-variant-stock-form" style={{ borderRadius: 8, gap: 10, padding: 14 }}>
      <h3 style={{ fontSize: 15, margin: 0 }}>안전재고</h3>
      <input name="goodId" type="hidden" value={editor.goodId} />
      <div className="admin-form-grid">
        <SelectField label="품목" name="variantId">
          {variants.map((entry) => <option key={entry.id} value={entry.id}>{variantLabel(entry, editor)}</option>)}
        </SelectField>
        <SelectField label="출고지" name="locationId">
          {editor.locations.filter((location) => location.active).map((location) => (
            <option key={location.id} value={location.id}>{location.name}</option>
          ))}
        </SelectField>
        <Field error={state.errors?.safetyQty} label="안전재고 (이하이면 부족 표시)" min={0} name="safetyQty" placeholder="0" required step={1} type="number" />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>안전재고는 판매를 막지 않습니다. 가용이 이 수 이하로 내려가면 목록에 「재고 부족」으로 표시됩니다.</p>
      <InlineNotice state={state} />
      <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 140 }}>
        <Icon name="check" size={15} /> {pending ? '저장 중' : '안전재고 저장'}
      </button>
    </form>
  );
}

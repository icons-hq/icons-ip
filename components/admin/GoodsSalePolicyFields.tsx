'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { goodsOptionRowKey, isSingleGoodsOption, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { GOOD_OPTION_LIMIT_ERROR_FIELD } from '@/lib/admin/good-workspace';
import { AdminField, AdminFormGrid } from './console/AdminKit';
import { GoodEditorSection } from './GoodWorkspace';
import { ErrorText, SelectField } from './fields';

const QUANTITY_FIELDS = ['orderQuantityLimitEnabled', 'minOrderQty', 'maxOrderQty', 'memberPurchaseLimitEnabled', 'memberLifetimeQtyLimit'] as const;
/** 구매 제한 카드의 오류 개수에 세는 칸(상품 단위 수량 + 옵션별 제한 표). */
const LIMIT_ERROR_FIELDS: readonly string[] = [...QUANTITY_FIELDS, GOOD_OPTION_LIMIT_ERROR_FIELD];
const PAYMENT_FIELDS = ['allowCardPayment', 'allowBankTransfer', 'saleRestriction'] as const;
export const GOODS_RANDOM_OPTION_LIMIT_BLOCKED = '랜덤 판매 상품은 옵션별 구매 제한을 쓸 수 없습니다.';

function QuantityInput({ name, label, value, error, hint }: { name: string; label: string; value: string; error?: string; hint?: string }) {
  const id = `goods-${name}`;
  return <AdminField inputId={id} label={label} hint={hint} error={error}>
    <span className="goods-amount-input">
      <input id={id} name={name} type="number" min={1} max={2147483647} step={1} inputMode="numeric" defaultValue={value}
        aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} aria-invalid={error ? 'true' : undefined} />
      <span aria-hidden="true">개</span>
    </span>
  </AdminField>;
}

function LimitChoice({ name, legend, enabled, onChange }: { name: string; legend: string; enabled: boolean; onChange: (enabled: boolean) => void }) {
  return <fieldset className="goods-choice">
    <legend>{legend}</legend>
    <label><input type="radio" name={name} value="true" checked={enabled} onChange={() => onChange(true)} />설정함</label>
    <label><input type="radio" name={name} value="false" checked={!enabled} onChange={() => onChange(false)} />설정안함</label>
  </fieldset>;
}

function optionLimitValue(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  /* 잘못된 값도 그대로 보존해 저장 검증이 옵션 칸 오류로 알린다. */
  return Number.isFinite(value) ? value : null;
}

/** 옵션마다 주문 1건·회원 1명의 최대 수량. 행 JSON(`variants`)의 orderMaxQty·memberMaxQty로 저장된다(D7②). */
function GoodsOptionLimitTable({ rows, onRowsChange, randomSale, error }: {
  rows: GoodsOptionRow[]; onRowsChange: Dispatch<SetStateAction<GoodsOptionRow[]>>; randomSale: boolean; error?: string;
}) {
  const single = isSingleGoodsOption(rows);
  function update(key: string, field: 'orderMaxQty' | 'memberMaxQty', raw: string) {
    onRowsChange((current) => current.map((row) => goodsOptionRowKey(row) === key ? { ...row, [field]: optionLimitValue(raw) } : row));
  }
  return <fieldset className="goods-option-limits" disabled={randomSale} aria-describedby="goods-option-limits-guidance">
    <legend>옵션별 구매 제한 (선택)</legend>
    <p id="goods-option-limits-guidance" className="wc-admin-option-artwork__secondary-hint">
      옵션마다 주문 1건의 최대 구매수량과 1인 최대 구매수량을 따로 정합니다. 비워 두면 그 옵션은 제한하지 않으며, 위 상품 전체 제한과 함께 적용됩니다.
    </p>
    {randomSale ? <p className="goods-option-limits__blocked" role="note">{GOODS_RANDOM_OPTION_LIMIT_BLOCKED}</p> : null}
    <div className="goods-option-limits__table" role="region" aria-label="옵션별 구매 제한 표" tabIndex={0}>
      <table className="wc-admin-table">
        <caption className="sr-only">옵션별 최대 구매수량(주문당)·1인 최대 구매수량</caption>
        <thead><tr><th scope="col">옵션</th><th scope="col">최대 구매수량(주문당)</th><th scope="col">1인 최대 구매수량</th></tr></thead>
        <tbody>{rows.map((row, index) => {
          const key = goodsOptionRowKey(row);
          const name = single ? '기본 옵션' : row.name.trim() || `옵션 ${index + 1}`;
          return <tr key={key} data-variant-id={row.id ?? undefined}>
            <td>{name}{row.isActive === false ? <small className="goods-option-row-status"> · 사용 중지</small> : null}</td>
            {/* 옵션 행 JSON으로 제출하므로 name이 없다. 브라우저 검증 오류는 data-error-field로 구매 제한 카드에 붙인다(GoodEditor). */}
            <td><input aria-label={`${name} 최대 구매수량(주문당)`} data-error-field={GOOD_OPTION_LIMIT_ERROR_FIELD} type="number" min={1} max={2147483647} step={1} inputMode="numeric" placeholder="제한 없음"
              value={row.orderMaxQty ?? ''} onChange={(event) => update(key, 'orderMaxQty', event.target.value)} /></td>
            <td><input aria-label={`${name} 1인 최대 구매수량`} data-error-field={GOOD_OPTION_LIMIT_ERROR_FIELD} type="number" min={1} max={2147483647} step={1} inputMode="numeric" placeholder="제한 없음"
              value={row.memberMaxQty ?? ''} onChange={(event) => update(key, 'memberMaxQty', event.target.value)} /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <ErrorText>{error}</ErrorText>
  </fieldset>;
}

/**
 * 구매 제한(10/27 회의 R12·D7②). 판매가·판매기간 바로 아래에 펼친 채 둔다.
 * 스마트스토어 어휘(최소/최대 구매수량·1인 최대 구매수량)를 쓰되, DB는 주문당 제한을 켜면 최소·최대를 함께 요구한다
 * (goods_order_quantity_activation). 저장 계약(폼 이름)은 그대로다.
 */
export function GoodsPurchaseLimitFields({ values, current, errors, quantityReadOnly = false, rows, onRowsChange, randomSale = false }: {
  /** 마운트 때 값(비제어 입력의 기본값). */
  values: Record<string, string>;
  /** 편집 중인 현재 입력값(편집기 폼 캡처). 섹션 요약의 수량은 이 값으로 보인다. 없으면 values를 쓴다. */
  current?: Record<string, string>;
  errors?: Record<string, string | undefined>;
  quantityReadOnly?: boolean;
  rows: GoodsOptionRow[];
  onRowsChange: Dispatch<SetStateAction<GoodsOptionRow[]>>;
  /** goods.option_sale_mode='random'이면 옵션별 제한을 쓸 수 없다(DB가 거절한다). */
  randomSale?: boolean;
}) {
  const [orderLimit, setOrderLimit] = useState(values.orderQuantityLimitEnabled === 'true');
  const [memberLimit, setMemberLimit] = useState(values.memberPurchaseLimitEnabled === 'true');
  const errorCount = Object.keys(errors ?? {}).filter((key) => errors?.[key] && LIMIT_ERROR_FIELDS.includes(key)).length;
  const optionLimited = rows.filter((row) => row.orderMaxQty != null || row.memberMaxQty != null).length;
  const live = current ?? values;
  const summary = [
    orderLimit ? `최소 ${live.minOrderQty?.trim() || '?'}·최대 ${live.maxOrderQty?.trim() || '?'}개` : '최소/최대 구매수량 설정안함',
    memberLimit ? `1인 최대 ${live.memberLifetimeQtyLimit?.trim() || '?'}개` : '1인 최대 구매수량 설정안함',
    ...(optionLimited ? [`옵션별 제한 ${optionLimited}개`] : []),
  ].join(' · ');
  return <GoodEditorSection title="구매 제한" id="good-section-limits" requirement="선택 · 설정하면 수량 입력 필요" errorCount={errorCount} summary={summary}>
    <div className="goods-price-editor goods-purchase-limits">
      <fieldset disabled={quantityReadOnly} className="goods-purchase-limits__group">
        <LimitChoice name="orderQuantityLimitEnabled" legend="최소/최대 구매수량" enabled={orderLimit} onChange={setOrderLimit} />
        <div hidden={!orderLimit && !errors?.minOrderQty && !errors?.maxOrderQty} className="admin-good-workspace__conditional">
          <QuantityInput name="minOrderQty" label="최소 구매수량" value={values.minOrderQty} error={errors?.minOrderQty} />
          <QuantityInput name="maxOrderQty" label="최대 구매수량" value={values.maxOrderQty} error={errors?.maxOrderQty} />
        </div>
        <p className="muted">주문 1건에 담을 수 있는 수량입니다. 설정하면 최소·최대 구매수량을 모두 입력해야 저장됩니다(한쪽만 설정할 수 없어 최소 1개부터 입력합니다).{orderLimit ? '' : ' 설정안함이어도 입력한 수량은 보존됩니다.'}</p>
        <LimitChoice name="memberPurchaseLimitEnabled" legend="1인 최대 구매수량" enabled={memberLimit} onChange={setMemberLimit} />
        <div hidden={!memberLimit && !errors?.memberLifetimeQtyLimit} className="admin-good-workspace__conditional">
          <QuantityInput name="memberLifetimeQtyLimit" label="1인 최대 구매수량" value={values.memberLifetimeQtyLimit} error={errors?.memberLifetimeQtyLimit} />
        </div>
        <p className="muted">회원 1명이 이 상품을 누적으로 살 수 있는 수량입니다. 과거 구매와 결제 대기 주문을 포함하고, 전액 취소·환불이 끝난 주문은 빼고 셉니다.{memberLimit ? '' : ' 설정안함이어도 입력한 한도는 보존됩니다.'}</p>
      </fieldset>
      {quantityReadOnly ? QUANTITY_FIELDS.map((name) => <input key={name} type="hidden" name={name} value={values[name] ?? ''} />) : null}
      <p className="muted">수량은 같은 상품의 모든 옵션을 합산합니다.</p>
      <GoodsOptionLimitTable rows={rows} onRowsChange={onRowsChange} randomSale={randomSale} error={errors?.[GOOD_OPTION_LIMIT_ERROR_FIELD]} />
    </div>
  </GoodEditorSection>;
}

/** 결제수단·판매 제한(19금) — 상단 내비의 "판매 조건". 구매 제한은 GoodsPurchaseLimitFields가 따로 그린다. */
export function GoodsSalePolicyFields({ values, errors }: {
  values: Record<string, string>;
  errors?: Record<string, string | undefined>;
}) {
  function choice(name: string, label: string, enabled: string, disabled: string) {
    return <SelectField name={name} label={label} defaultValue={values[name]} error={errors?.[name]}>
      <option value="true">{enabled}</option><option value="false">{disabled}</option>
    </SelectField>;
  }
  const errorCount = Object.keys(errors ?? {}).filter((key) => errors?.[key] && (PAYMENT_FIELDS as readonly string[]).includes(key)).length;
  return <GoodEditorSection defaultOpen={false} errorCount={errorCount} title="결제·판매 제한" id="good-section-sale" requirement="선택 · 결제수단과 판매 제한"
    summary={`카드 ${values.allowCardPayment === 'false' ? '받지 않음' : '허용'} · 무통장 ${values.allowBankTransfer === 'false' ? '받지 않음' : '허용'} · 판매 제한 ${values.saleRestriction === 'adult' ? '성인(19금)' : '없음'}`}>
    <AdminFormGrid>
      {choice('allowCardPayment', '카드 결제', '허용', '받지 않음')}
      {choice('allowBankTransfer', '무통장 입금', '허용', '받지 않음')}
      <SelectField name="saleRestriction" label="판매 제한" defaultValue={values.saleRestriction} error={errors?.saleRestriction}>
        <option value="none">없음</option><option value="adult">성인(19금)</option>
      </SelectField>
    </AdminFormGrid>
    <p>함께 주문한 모든 상품이 허용하는 결제수단만 사용할 수 있습니다. 두 수단을 모두 닫으면 새 주문을 받지 않습니다. 실제 결제는 결제사·계좌 준비 상태도 확인합니다.</p>
    <p>성인(19금) 상품은 성인인증을 도입하기 전까지 공개되지 않고 구매가 차단됩니다.</p>
  </GoodEditorSection>;
}

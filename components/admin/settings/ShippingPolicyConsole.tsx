'use client';

import { useActionState, useState } from 'react';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import {
  archiveShippingPolicyAction,
  upsertShippingPolicyAction,
} from '@/app/admin/shipping-policy-actions';
import { SeededForm } from '@/components/admin/form-seed';
import { Icon } from '@/components/ui/Icon';
import type { AdminStockLocation } from '@/lib/admin/variants';
import {
  SHIPPING_FEE_KINDS,
  SHIPPING_METHODS,
  shippingPolicySummary,
  type AdminShippingPolicy,
} from '@/lib/admin/shipping-policies';
import { Field, InlineNotice, SelectField, TextArea } from '../fields';

const emptyState: AdminCatalogActionState = {};

/*
 * 배송·교환반품 정책 (현업 슬라이스 2).
 *
 * 정책은 템플릿이다 — 상품은 이걸 가리키고, 비우면 기본 정책을 쓴다. 배송비가 바뀌면
 * 여기 한 곳만 고친다.
 */
export function ShippingPolicyConsole({
  locations,
  policies,
}: {
  locations: AdminStockLocation[];
  policies: AdminShippingPolicy[];
}) {
  const [state, action, pending] = useActionState(upsertShippingPolicyAction, emptyState);
  const [archiveState, archiveAction, archivePending] = useActionState(archiveShippingPolicyAction, emptyState);
  const [selectedId, setSelectedId] = useState<string>('');
  const selected = policies.find((policy) => policy.id === selectedId) ?? null;
  const [feeKind, setFeeKind] = useState(selected?.feeKind ?? 'conditional');

  return (
    <section aria-labelledby="shipping-policies" className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div>
        <span className="eyebrow">SHIPPING POLICY</span>
        <h2 id="shipping-policies" style={{ fontSize: 18, margin: '6px 0 0' }}>배송·교환반품 정책</h2>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '6px 0 0' }}>
          상품은 정책을 가리킵니다. 비워 두면 기본 정책을 씁니다 — 배송비가 바뀌면 여기 한 곳만 고칩니다.
        </p>
      </div>

      <div className="admin-console-chips">
        <button
          className={selectedId === '' ? 'admin-console-chip on' : 'admin-console-chip'}
          onClick={() => { setSelectedId(''); setFeeKind('conditional'); }}
          type="button"
        >
          <span className="admin-console-chip-label">＋ 새 정책</span>
        </button>
        {policies.map((policy) => (
          <button
            className={selectedId === policy.id ? 'admin-console-chip on' : 'admin-console-chip'}
            key={policy.id}
            onClick={() => { setSelectedId(policy.id); setFeeKind(policy.feeKind); }}
            type="button"
          >
            <span className="admin-console-chip-label">
              {policy.name}{policy.isDefault ? ' · 기본' : ''}
            </span>
          </button>
        ))}
      </div>

      {policies.length > 0 ? (
        <ul className="col" style={{ gap: 4, listStyle: 'none', margin: 0, padding: 0 }}>
          {policies.map((policy) => (
            <li className="muted" key={policy.id} style={{ fontSize: 12 }}>
              <strong>{policy.name}</strong> — {shippingPolicySummary(policy)}
              {policy.bundling ? ' · 묶음배송' : ' · 상품별 배송'}
            </li>
          ))}
        </ul>
      ) : null}

      <SeededForm
        values={state.values}
        action={action}
        className="col"
        key={`policy:${selected?.id ?? 'new'}`}
        style={{ gap: 10 }}
      >
        <div className="admin-form-grid">
          <Field
            defaultValue={selected?.id ?? ''}
            error={state.errors?.id}
            label="정책 ID"
            name="id"
            placeholder="bulky"
            readOnly={Boolean(selected)}
          />
          <Field defaultValue={selected?.name ?? ''} error={state.errors?.name} label="정책 이름" name="name" placeholder="부피 큰 상품" />
          <SelectField defaultValue={selected?.method ?? 'parcel'} error={state.errors?.method} label="배송 방법" name="method">
            {SHIPPING_METHODS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </SelectField>
          <SelectField
            defaultValue={selected?.feeKind ?? 'conditional'}
            error={state.errors?.feeKind}
            label="배송비 유형"
            name="feeKind"
            onChange={(event) => setFeeKind(event.target.value)}
          >
            {SHIPPING_FEE_KINDS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </SelectField>
          {feeKind !== 'free' ? (
            <Field
              defaultValue={selected?.feeAmount ?? 3000}
              error={state.errors?.feeAmount}
              label="배송비 (원)"
              min={0}
              name="feeAmount"
              step={1}
              type="number"
            />
          ) : null}
          {feeKind === 'conditional' ? (
            <Field
              defaultValue={selected?.freeThreshold ?? 50000}
              error={state.errors?.freeThreshold}
              label="무료 기준 금액 (원 이상)"
              min={1}
              name="freeThreshold"
              step={1}
              type="number"
            />
          ) : null}
          <Field
            defaultValue={selected?.remoteSurcharge ?? 0}
            error={state.errors?.remoteSurcharge}
            label="도서산간 추가비 (원)"
            min={0}
            name="remoteSurcharge"
            step={1}
            type="number"
          />
        </div>

        <div className="admin-form-grid">
          <SelectField defaultValue={selected?.shipFromLocationId ?? ''} label="출고지" name="shipFromLocationId">
            <option value="">기본 출고지</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </SelectField>
          <SelectField defaultValue={selected?.exchangeLocationId ?? ''} label="교환지" name="exchangeLocationId">
            <option value="">출고지와 같음</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </SelectField>
          <SelectField defaultValue={selected?.returnLocationId ?? ''} label="반품지" name="returnLocationId">
            <option value="">출고지와 같음</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </SelectField>
          <Field defaultValue={selected?.exchangeFee ?? 0} error={state.errors?.exchangeFee} label="교환 배송비 (원)" min={0} name="exchangeFee" step={1} type="number" />
          <Field defaultValue={selected?.returnFee ?? 0} error={state.errors?.returnFee} label="반품 배송비 (원)" min={0} name="returnFee" step={1} type="number" />
        </div>

        <TextArea
          defaultValue={selected?.returnRestrictions ?? ''}
          label="반품 제한 사유 (소비자 화면에 그대로 나갑니다)"
          maxLength={500}
          name="returnRestrictions"
          placeholder="개봉 후 반품 불가 · 주문 제작 상품 반품 불가"
        />
        <Field defaultValue={selected?.supportNote ?? ''} label="고객센터 표기" name="supportNote" placeholder="고객센터 010-0000-0000" />

        <label className="row" style={{ gap: 8 }}>
          <input defaultChecked={selected?.bundling ?? true} name="bundling" type="checkbox" />
          <span style={{ fontSize: 13 }}>묶음배송 — 이 정책을 쓰는 상품끼리는 배송비를 한 번만 받습니다</span>
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input defaultChecked={selected?.allowBankTransfer ?? true} name="allowBankTransfer" type="checkbox" />
          <span style={{ fontSize: 13 }}>무통장 입금 허용</span>
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input defaultChecked={selected?.isDefault ?? false} name="isDefault" type="checkbox" />
          <span style={{ fontSize: 13 }}>기본 정책 — 상품이 정책을 비워 두면 이걸 씁니다 (하나만 지정됩니다)</span>
        </label>

        <InlineNotice state={state} />
        <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
          <Icon name="check" size={15} /> {pending ? '저장 중' : selected ? '정책 저장' : '정책 만들기'}
        </button>
      </SeededForm>

      {selected && !selected.isDefault ? (
        <SeededForm values={archiveState.values} action={archiveAction} className="col" style={{ gap: 8 }}>
          <input name="id" type="hidden" value={selected.id} />
          <InlineNotice state={archiveState} />
          <button className="btn btn-ghost" disabled={archivePending} style={{ justifySelf: 'start' }}>
            {archivePending ? '보관 중' : '이 정책 보관'}
          </button>
        </SeededForm>
      ) : null}
    </section>
  );
}

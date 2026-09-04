'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { upsertStockLocationAction } from '@/app/admin/variant-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminStockLocation } from '@/lib/admin/variants';
import { Icon } from '@/components/ui/Icon';
import { CatalogEditorHeader } from './CatalogEditorHeader';
import { Field, FormShell, SelectField } from '../fields';

/*
 * 출고지(창고) 설정(설계서 v2 §1-9). 기본 출고지 1행이 상품의 기본값이고 품목이 덮어쓴다(ADR-0036).
 * 배송 정책 객체(무료 기준·구간·도서산간)는 D-2 에서 이 화면에 합류한다 — 지금은 코드 상수다.
 */

const emptyState: AdminCatalogActionState = {};
export const ADMIN_SHIPPING_SETTINGS_PATH = '/admin/settings/shipping';

function StockLocationForm({
  carriers,
  selected,
}: {
  carriers: { code: string; label: string }[];
  selected: AdminStockLocation | null;
}) {
  const [state, action, pending] = useActionState(upsertStockLocationAction, emptyState);
  return (
    <form action={action} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <div className="admin-form-grid">
        <Field defaultValue={selected?.id ?? ''} error={state.errors?.id} label="코드 (영문 소문자·숫자·하이픈)" name="id" placeholder="busan" readOnly={Boolean(selected)} required />
        <Field defaultValue={selected?.name ?? ''} error={state.errors?.name} label="이름" name="name" placeholder="부산" required />
        <Field defaultValue={selected?.contact ?? ''} label="연락처" name="contact" placeholder="02-000-0000" />
        <Field defaultValue={selected?.erpWarehouseCode ?? ''} label="ERP 창고 코드" name="erpWarehouseCode" placeholder="W01" />
        <SelectField defaultValue={selected?.defaultCarrierCode ?? ''} label="기본 택배사" name="defaultCarrierCode">
          <option value="">지정 안 함</option>
          {carriers.map((carrier) => <option key={carrier.code} value={carrier.code}>{carrier.label}</option>)}
        </SelectField>
        <Field defaultValue={selected?.sortOrder ?? 0} error={state.errors?.sortOrder} label="정렬 순서" name="sortOrder" step={1} type="number" />
      </div>
      <div className="row" style={{ gap: 16 }}>
        <label className="admin-variant-value">
          <input defaultChecked={selected?.isDefault ?? false} name="isDefault" type="checkbox" /> 기본 출고지
        </label>
        <label className="admin-variant-value">
          <input defaultChecked={selected?.active ?? true} name="active" type="checkbox" /> 사용 중
        </label>
      </div>
      {state.errors?.active ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{state.errors.active}</span> : null}
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        기본 출고지는 하나뿐이다. 재고가 남은 출고지는 비활성화할 수 없고, 새 출고지를 켜면 모든 품목에 0개 재고 행이 생긴다.
      </p>
      <FormShell pending={pending} state={state} />
    </form>
  );
}

export function StockLocationConsole({
  carriers,
  locations,
  selected,
}: {
  carriers: { code: string; label: string }[];
  locations: AdminStockLocation[];
  selected: AdminStockLocation | 'new' | null;
}) {
  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      {selected ? (
        <>
          <CatalogEditorHeader
            eyebrow="SHIPPING"
            listHref={ADMIN_SHIPPING_SETTINGS_PATH}
            title={selected === 'new' ? '새 출고지' : `${selected.id} · ${selected.name}`}
          />
          <StockLocationForm carriers={carriers} key={selected === 'new' ? 'new' : selected.id} selected={selected === 'new' ? null : selected} />
        </>
      ) : (
        <>
          <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <span className="eyebrow">SHIPPING</span>
              <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>출고지 · 배송 정책</h1>
            </div>
            <Link className="btn btn-sm btn-holo" href={`${ADMIN_SHIPPING_SETTINGS_PATH}?selected=new`}>
              <Icon name="plus" size={14} /> 새 출고지
            </Link>
          </div>
          <div className="admin-console-grid-scroll card" style={{ borderRadius: 10 }}>
            <table className="admin-console-grid-table">
              <thead>
                <tr>
                  <th scope="col">코드</th>
                  <th scope="col">이름</th>
                  <th scope="col">ERP 창고</th>
                  <th scope="col">기본 택배사</th>
                  <th scope="col">기본</th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr key={location.id}>
                    <td className="mono">{location.id}</td>
                    <td><Link className="admin-console-grid-link" href={`${ADMIN_SHIPPING_SETTINGS_PATH}?selected=${location.id}`}>{location.name}</Link></td>
                    <td className="mono">{location.erpWarehouseCode ?? <span className="muted">-</span>}</td>
                    <td>{carriers.find((carrier) => carrier.code === location.defaultCarrierCode)?.label ?? <span className="muted">-</span>}</td>
                    <td>{location.isDefault ? <span className="admin-badge">기본</span> : <span className="muted">-</span>}</td>
                    <td>{location.active ? <span className="admin-badge">사용 중</span> : <span className="admin-badge admin-badge--muted">비활성</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="card col" style={{ borderRadius: 10, gap: 8, padding: 16 }}>
            <span className="eyebrow">SHIPPING POLICY</span>
            <h2 style={{ fontSize: 16, margin: 0 }}>배송 정책 · 준비 중</h2>
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
              무료 배송 기준·기본 배송비·도서산간 추가비는 아직 코드 상수(5만 원 이상 무료, 미만 3,000원)다. 정책 객체가 생기면 여기서 상품별 상속/개별 정책을 고른다.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

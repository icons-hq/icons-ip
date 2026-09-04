'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { upsertOptionMasterAction } from '@/app/admin/variant-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { OPTION_DISPLAY_STYLES, type AdminOptionMaster } from '@/lib/admin/variants';
import { Icon } from '@/components/ui/Icon';
import { CatalogEditorHeader } from './CatalogEditorHeader';
import { Field, FormShell, SelectField, TextArea } from '../fields';

/*
 * 옵션 마스터(설계서 v2 §1-1). 옵션(색상·사이즈…)과 값은 상품이 아니라 마스터가 소유한다 — 품목 표는
 * 마스터를 참조만 한다. 값을 바꾸면 그 값을 쓰는 모든 품목의 표기가 함께 바뀐다.
 */

const emptyState: AdminCatalogActionState = {};
export const ADMIN_OPTION_MASTERS_PATH = '/admin/catalog/options';

function OptionMasterForm({ selected }: { selected: AdminOptionMaster | null }) {
  const [state, action, pending] = useActionState(upsertOptionMasterAction, emptyState);
  return (
    <form action={action} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      {selected ? <input name="id" type="hidden" value={selected.id} /> : null}
      <div className="admin-form-grid">
        <Field defaultValue={selected?.name ?? ''} error={state.errors?.name} label="옵션 이름" name="name" placeholder="색상" required />
        <SelectField defaultValue={selected?.displayStyle ?? 'select'} error={state.errors?.displayStyle} label="표시 방식" name="displayStyle">
          {OPTION_DISPLAY_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
        </SelectField>
        <Field defaultValue={selected?.sortOrder ?? 0} error={state.errors?.sortOrder} label="정렬 순서" name="sortOrder" step={1} type="number" />
      </div>
      {selected ? (
        <fieldset className="admin-variant-options">
          <legend className="mono" style={{ color: 'var(--dim)', fontSize: 11, padding: '0 6px' }}>옵션값 {selected.values.length}개</legend>
          <div className="col" style={{ gap: 8 }}>
            {selected.values.map((value) => (
              <div className="row" key={value.id} style={{ alignItems: 'center', gap: 12 }}>
                <input aria-label={`옵션값 ${value.value}`} className="admin-field-control" defaultValue={value.value} maxLength={40} name={`value:${value.id}`} style={{ maxWidth: 240 }} />
                <label className="admin-variant-value">
                  <input defaultChecked={value.archivedAt !== null} name={`archive:${value.id}`} type="checkbox" /> 보관
                </label>
                {value.archivedAt ? <span className="admin-badge admin-badge--muted">보관</span> : null}
              </div>
            ))}
            {selected.values.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>값이 없습니다.</span> : null}
          </div>
        </fieldset>
      ) : null}
      <TextArea error={state.errors?.newValues} label="새 옵션값 (줄마다 하나)" name="newValues" placeholder={'빨강\n파랑'} />
      {selected ? (
        <label className="admin-variant-value">
          <input defaultChecked={selected.archivedAt !== null} name="archived" type="checkbox" /> 옵션 보관 (상품이 쓰는 옵션은 보관할 수 없다)
        </label>
      ) : null}
      <FormShell pending={pending} state={state} />
    </form>
  );
}

export function OptionMasterConsole({
  masters,
  selected,
}: {
  masters: AdminOptionMaster[];
  /** `?selected=<id>` 편집 대상. `'new'` 면 빈 폼, null 이면 목록만. */
  selected: AdminOptionMaster | 'new' | null;
}) {
  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      {selected ? (
        <>
          <CatalogEditorHeader
            eyebrow="OPTIONS"
            listHref={ADMIN_OPTION_MASTERS_PATH}
            title={selected === 'new' ? '새 옵션' : `${selected.code} · ${selected.name}`}
          />
          <OptionMasterForm key={selected === 'new' ? 'new' : selected.id} selected={selected === 'new' ? null : selected} />
        </>
      ) : (
        <>
          <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <span className="eyebrow">OPTIONS</span>
              <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>옵션 마스터</h1>
            </div>
            <Link className="btn btn-sm btn-holo" href={`${ADMIN_OPTION_MASTERS_PATH}?selected=new`}>
              <Icon name="plus" size={14} /> 새 옵션
            </Link>
          </div>
          <div className="admin-console-grid-scroll card" style={{ borderRadius: 10 }}>
            <table className="admin-console-grid-table">
              <thead>
                <tr>
                  <th scope="col">코드</th>
                  <th scope="col">옵션</th>
                  <th scope="col">표시</th>
                  <th scope="col">값</th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {masters.map((master) => (
                  <tr key={master.id}>
                    <td className="mono">{master.code}</td>
                    <td><Link className="admin-console-grid-link" href={`${ADMIN_OPTION_MASTERS_PATH}?selected=${master.id}`}>{master.name}</Link></td>
                    <td>{OPTION_DISPLAY_STYLES.find((style) => style.value === master.displayStyle)?.label ?? master.displayStyle}</td>
                    <td>{master.values.filter((value) => value.archivedAt === null).map((value) => value.value).join(', ') || <span className="muted">-</span>}</td>
                    <td>{master.archivedAt ? <span className="admin-badge admin-badge--muted">보관</span> : <span className="admin-badge">사용 중</span>}</td>
                  </tr>
                ))}
                {masters.length === 0 ? <tr><td className="muted" colSpan={5}>옵션이 없습니다. 「새 옵션」으로 색상·사이즈 같은 옵션을 만드세요.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

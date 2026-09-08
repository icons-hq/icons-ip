'use client';

import { useActionState, useId } from 'react';
import { saveIpDirectoryAction, type IpDirectoryActionState } from '@/app/admin/ip-directory-actions';
import { AdminField, AdminSectionCard } from './console/AdminKit';
import { IP_FEATURED_LIMIT, type AdminIpSummary } from '@/lib/admin/ip-workspace';

const EMPTY: IpDirectoryActionState = {};
export function IpDirectoryControls({ id, directory }: { id: string; directory: AdminIpSummary[] }) {
  const [state, action, pending] = useActionState(saveIpDirectoryAction, EMPTY);
  const inputId = useId();
  const index = directory.findIndex((ip) => ip.id === id);
  const selected = directory[index];
  if (!selected) return null;
  const currentOrder = directory.map((ip) => ip.id);
  const position = state.values?.position ?? String(index + 1);
  const featured = state.values ? state.values.featured === 'on' : selected.featured;
  return <AdminSectionCard title="디렉토리 노출">
    <p className="wc-admin-kit__description">피처드 IP {directory.filter((ip) => ip.featured).length}/{IP_FEATURED_LIMIT}개 · 최대 {IP_FEATURED_LIMIT}개를 지정할 수 있습니다.</p>
    <p className="wc-admin-kit__description">순번은 모든 IP 기준입니다. 초안·보관 IP는 공개 디렉토리에 표시되지 않습니다.</p>
    <form action={action}>
      <fieldset key={`${state.attempt ?? 0}:${JSON.stringify(currentOrder)}:${selected.featured}`} disabled={pending} style={{ border: 0, margin: 0, padding: '20px 0 0', display: 'grid', gap: 16 }}>
        <input name="id" type="hidden" value={id} />
        <input name="expectedOrder" type="hidden" value={state.values?.expectedOrder ?? JSON.stringify(currentOrder)} />
        <input name="expectedFeatured" type="hidden" value={state.values?.expectedFeatured ?? String(selected.featured)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40 }}>
          <input name="featured" type="checkbox" defaultChecked={featured} disabled={Boolean(selected.archivedAt && !selected.featured)} /> 피처드 IP로 노출
        </label>
        <AdminField label="디렉토리 순번" inputId={inputId} hint={`1~${directory.length} 사이의 순번을 입력해주세요.`}>
          <input id={inputId} name="position" type="number" min={1} max={directory.length} step={1} defaultValue={position} required aria-describedby={`${inputId}-hint`} />
        </AdminField>
        <div className="wc-admin-kit__actions">
          <button className="wc-admin-kit__button" name="move" value="up" disabled={index === 0} type="submit">↑ 위로</button>
          <button className="wc-admin-kit__button" name="move" value="down" disabled={index === directory.length - 1} type="submit">↓ 아래로</button>
          <button className="wc-admin-kit__button" type="submit">{pending ? '저장 중…' : '노출 설정 저장'}</button>
        </div>
      </fieldset>
      {state.errors?.form ? <p className="wc-admin-kit__error" role="alert">{state.errors.form}</p> : null}
      {state.message ? <p role="status">{state.message}</p> : null}
    </form>
  </AdminSectionCard>;
}

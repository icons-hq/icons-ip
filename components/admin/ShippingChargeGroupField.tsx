'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getShippingChargeGroupAction, listShippingChargeGroupsAction } from '@/app/admin/shipping-charge-group-actions';
import type { ShippingChargeGroup, ShippingChargeGroupIdentity, ShippingChargeGroupListData } from '@/lib/admin/shipping-charge-groups';

export type ShippingChargeGroupSummaryValue = Pick<ShippingChargeGroup,
  'id' | 'originId' | 'revision' | 'name' | 'enabled' | 'archived' | 'calculationMode'> & {
  regionalMode?: 'inherit' | 'override'; regional?: ShippingChargeGroup['regional'];
};

export function ShippingChargeGroupSummary({ group, originName, ownerGoodId, inherited = false, manageLink = false }: {
  group: ShippingChargeGroupSummaryValue | null | undefined; originName?: string; ownerGoodId?: string; inherited?: boolean; manageLink?: boolean;
}) {
  if (group === undefined) return <div className="admin-shipping-charge-group-summary"><p>배송비 묶음그룹을 확인하고 있습니다. 미확인 상태를 미지정이나 무료배송으로 처리하지 않습니다.</p></div>;
  if (group === null) return <div className="admin-shipping-charge-group-summary"><strong>배송비 묶음그룹 미지정</strong><p>기존 상품·출고지의 배송비 규칙을 유지합니다. 기본 그룹을 바꾸어도 이 상품을 자동으로 배정하지 않습니다.</p>
    {inherited && ownerGoodId ? <p>묶음그룹 배정은 <Link href={`/admin/catalog/goods?goodId=${encodeURIComponent(ownerGoodId)}`}>원상품에서 관리</Link>합니다.</p> : null}
  </div>;
  const regionMode = group.regional?.mode ?? group.regionalMode;
  return <div className="admin-shipping-charge-group-summary">
    <strong>{group.name} <span className="admin-shipping-charge-groups__badge">{group.archived ? '보관' : group.enabled ? '사용' : '사용 안 함'}</span></strong>
    <dl><dt>배송비 계산</dt><dd>{group.calculationMode === 'min' ? '최소 부과' : '최대 부과'} · 유효 무료 조건 우선</dd>
      <dt>지역 추가료</dt><dd>{regionMode === 'inherit' ? '출고지 지역 정책 상속' : regionMode === 'override' ? '그룹 지역표로 그룹당 한 번' : '지역 정책 확인 필요'}</dd>
      {originName ? <><dt>출고지</dt><dd>{originName}</dd></> : null}<dt>저장 버전</dt><dd>{group.revision}</dd></dl>
    <p>같은 주문·출고지에서 실제 구매한 상품만 함께 계산합니다. 기본 배송비가 무료여도 지역 추가료는 별도 조건을 따릅니다.</p>
    {inherited && ownerGoodId ? <p>이 상품은 <Link href={`/admin/catalog/goods?goodId=${encodeURIComponent(ownerGoodId)}`}>원상품의 묶음그룹 배정</Link>을 공유합니다.</p> : null}
    {manageLink ? <Link href="/admin/settings/origins#shipping-charge-groups">배송비 묶음그룹 관리</Link> : null}
  </div>;
}

export interface ShippingChargeGroupFieldProps {
  identity: ShippingChargeGroupIdentity | null;
  originId: string | null | undefined;
  value: string | null;
  onChange: (value: string | null, group: ShippingChargeGroup | null) => void;
  selectedGroup?: ShippingChargeGroupSummaryValue | null;
  disabled?: boolean;
  readOnly?: boolean;
  ownerGoodId?: string;
  error?: string;
  allowClear?: boolean;
  name?: string;
}
function createReadLane(owner: string) {
  let alive = true;
  return { owner, isAlive: () => alive, activate: () => { alive = true; }, dispose: () => { alive = false; } };
}

/** Read-only lookup and explicit local selection; the enclosing workflow owns saving. */
export function ShippingChargeGroupField({ identity, originId, value, onChange, selectedGroup, disabled = false,
  readOnly = false, ownerGoodId, error, allowClear = true, name }: ShippingChargeGroupFieldProps) {
  const id = useId(), actorId = identity?.expectedActorId ?? '', sessionId = identity?.expectedSessionId ?? '';
  const owner = `${actorId}:${sessionId}:${originId ?? ''}`;
  const lane = useMemo(() => createReadLane(owner), [owner]);
  const sequence = useRef(0);
  const [storedPicker, setPicker] = useState<{ owner: string; open: boolean; query: string }>({ owner, open: false, query: '' });
  const picker = storedPicker.owner === owner ? storedPicker : { owner, open: false, query: '' };
  const [storedList, setList] = useState<{ owner: string; data: ShippingChargeGroupListData | null; busy: boolean; error: string } | null>(null);
  const list = storedList?.owner === owner ? storedList : { data: null, busy: false, error: '' };
  const [storedGroup, setGroup] = useState<{ owner: string; id: string; group: ShippingChargeGroup | null; error: string } | null>(null);
  const loadedGroup = storedGroup?.owner === owner && storedGroup.id === value ? storedGroup : null;
  const selected = value === null ? null : selectedGroup?.id === value ? selectedGroup : loadedGroup?.group ?? undefined;
  const mismatch = selected && selected.originId !== originId;
  const locked = disabled || readOnly || !identity || !originId || list.busy;
  useEffect(() => { lane.activate(); return () => lane.dispose(); }, [lane]);
  useEffect(() => {
    if (!actorId || !sessionId || !value || selectedGroup?.id === value) return;
    let current = true;
    void getShippingChargeGroupAction(value, { expectedActorId: actorId, expectedSessionId: sessionId }).then(result => {
      if (!current || !lane.isAlive()) return;
      setGroup({ owner, id: value, group: 'data' in result ? result.data.group : null,
        error: 'error' in result ? result.error : '' });
    }).catch(() => { if (current && lane.isAlive()) setGroup({ owner, id: value, group: null, error: '선택한 묶음그룹 정보를 읽지 못했습니다. 기존 선택은 유지됩니다.' }); });
    return () => { current = false; };
  }, [actorId, sessionId, value, selectedGroup?.id, owner, lane]);
  async function search(page: number, query = picker.query) {
    if (!identity || !originId || disabled || readOnly || list.busy) return;
    const request = ++sequence.current;
    setList({ owner, data: list.data, busy: true, error: '' });
    try {
      const result = await listShippingChargeGroupsAction({ originId, query: query.trim(), status: 'active', page }, identity);
      if (!lane.isAlive() || request !== sequence.current) return;
      setList({ owner, data: 'data' in result ? result.data : null, busy: false, error: 'error' in result ? result.error : '' });
    } catch { if (lane.isAlive() && request === sequence.current) setList({ owner, data: null, busy: false, error: '묶음그룹을 불러오지 못했습니다. 같은 출고지로 다시 조회해주세요.' }); }
  }
  const options = list.data?.groups.filter(group => group.originId === originId && group.enabled && !group.archived) ?? [];
  return <div className="admin-shipping-charge-group-field">
    {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
    <ShippingChargeGroupSummary group={selected} ownerGoodId={ownerGoodId} inherited={readOnly} manageLink />
    {!originId ? <p>출고지를 먼저 선택해주세요. 같은 출고지의 사용 중인 그룹만 선택할 수 있습니다.</p> : null}
    {mismatch ? <p className="admin-shipping-charge-groups__error" role="alert">현재 선택한 그룹과 출고지가 다릅니다. 같은 출고지의 그룹을 다시 선택하거나 배정을 명시적으로 해제해주세요.</p> : null}
    {error || loadedGroup?.error ? <p className="admin-shipping-charge-groups__error" role="alert">{error || loadedGroup?.error}</p> : null}
    {!readOnly ? <div className="admin-shipping-charge-group-field__actions">
      <button className="btn btn-sm btn-ghost" type="button" disabled={locked} aria-expanded={picker.open} aria-controls={`${id}-picker`}
        onClick={() => { if (locked) return; setPicker({ owner, open: !picker.open, query: picker.query }); if (!picker.open) void search(1); }}>배송비 묶음그룹 선택</button>
      {allowClear && value !== null ? <button className="btn btn-sm btn-ghost" type="button" disabled={locked} onClick={() => { if (!locked) { onChange(null, null); setPicker({ owner, open: false, query: '' }); } }}>묶음그룹 배정 해제</button> : null}
    </div> : null}
    {picker.open && !readOnly ? <div id={`${id}-picker`} className="admin-shipping-charge-groups__notice">
      <div className="admin-shipping-charge-group-field__search"><label htmlFor={`${id}-query`}>배송비 묶음그룹명<input id={`${id}-query`} value={picker.query} maxLength={100} disabled={locked}
        onChange={event => setPicker({ owner, open: true, query: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(1); } }} /></label>
        <button className="btn btn-sm" type="button" disabled={locked} onClick={() => { void search(1); }}>검색</button></div>
      <p>조회 {list.data?.total.toLocaleString('ko-KR') ?? '—'}개 · 현재 출고지의 사용 중인 그룹</p>
      {list.busy ? <p role="status">묶음그룹을 불러오고 있습니다.</p> : null}
      {list.error ? <p className="admin-shipping-charge-groups__error" role="alert">{list.error}</p> : null}
      <ul className="admin-shipping-charge-group-field__choices">{options.map(group => <li key={group.id} className="admin-shipping-charge-group-field__choice">
        <div><strong>{group.name} {group.isDefault ? <span className="admin-shipping-charge-groups__badge">기본</span> : null}</strong>
          <small>{group.calculationMode === 'min' ? '최소 부과' : '최대 부과'} · 무료 우선 · {group.regional.mode === 'inherit' ? '출고지 지역 정책 상속' : '그룹 지역표 1회'} · 버전 {group.revision}</small></div>
        <button className="btn btn-sm btn-ghost" type="button" disabled={locked || value === group.id} onClick={() => { if (!locked && group.originId === originId && group.enabled && !group.archived) { onChange(group.id, group); setPicker({ owner, open: false, query: '' }); } }}>{value === group.id ? '선택됨' : '선택'}</button>
      </li>)}</ul>
      {!list.busy && list.data && !options.length ? <p>선택할 수 있는 그룹이 없습니다. 기존 선택이나 미지정 상태는 자동으로 바뀌지 않습니다.</p> : null}
      <div className="admin-shipping-charge-groups__pagination"><button className="btn btn-sm btn-ghost" type="button" disabled={locked || !list.data || list.data.page <= 1} onClick={() => { void search((list.data?.page ?? 1) - 1); }}>이전</button>
        <span>{list.data?.page ?? 1} / {list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1}</span>
        <button className="btn btn-sm btn-ghost" type="button" disabled={locked || !list.data || list.data.page * list.data.pageSize >= list.data.total} onClick={() => { void search((list.data?.page ?? 1) + 1); }}>다음</button></div>
      <p>기본 그룹 표시는 선택을 돕기 위한 정보입니다. 새 상품이나 기존 상품을 자동으로 배정하지 않습니다.</p>
    </div> : null}
  </div>;
}

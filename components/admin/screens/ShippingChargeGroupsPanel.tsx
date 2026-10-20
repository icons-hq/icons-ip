'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { getShippingChargeGroupAction, listShippingChargeGroupsAction } from '@/app/admin/shipping-charge-group-actions';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import {
  emptyShippingChargeGroupRegionPolicy, emptyShippingChargeGroupValues, parseShippingChargeGroupSaveRequest,
  shippingChargeGroupRegionalProblems, type ShippingChargeGroup, type ShippingChargeGroupData,
  type ShippingChargeGroupFilters, type ShippingChargeGroupIdentity, type ShippingChargeGroupListData,
  type ShippingChargeGroupOperationContext, type ShippingChargeGroupOperationReceipt, type ShippingChargeGroupOriginGuard,
  type ShippingChargeGroupRegionPolicy, type ShippingChargeGroupValues,
} from '@/lib/admin/shipping-charge-groups';
import { parseShippingRegionRulesTsv, REGION_DISPOSITION_LABELS, shippingRegionRulesTsv } from '@/lib/admin/shipping-regions';
import { formatOrderDateTime } from '@/lib/orders';
import { ShippingChargeGroupSummary } from '../ShippingChargeGroupField';
import {
  useShippingChargeGroupOperation, useShippingChargeGroupPending, useShippingChargeGroupSession, type ShippingChargeGroupScope,
} from '../shipping-charge-groups/useShippingChargeGroupOperation';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ShippingChargeGroupAssignmentDialog } from '../shipping-charge-groups/ShippingChargeGroupAssignmentDialog';

const emptyFilters = (): ShippingChargeGroupFilters => ({ originId: null, query: '', status: 'all', page: 1 });
function groupValues(group: ShippingChargeGroup): ShippingChargeGroupValues {
  return { name: group.name, enabled: group.enabled, archived: group.archived, isDefault: group.isDefault,
    calculationMode: group.calculationMode, regional: structuredClone(group.regional) };
}
function regionalKey(value: ShippingChargeGroupValues['regional']) {
  if (value.mode === 'inherit') return 'inherit';
  const p = value.policy;
  return JSON.stringify([p.carrierCode, p.startsAt, p.endsAt, p.openEnded, p.sourceEvidence, p.unlistedDisposition, p.noRulesConfirmed,
    p.rules.map(row => [row.id, row.postalFrom, row.postalTo, row.addressPrefix, row.regionLabel, row.disposition, row.amount])]);
}
function localDate(value: string | null) {
  return value ? new Date(Date.parse(value) + 9 * 3_600_000).toISOString().slice(0, 23) : '';
}
function serverDate(value: string) {
  if (!value) return null;
  const milliseconds = Date.parse(`${value}+09:00`);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function RegionFields({ policy, onChange, tsv, onTsvChange, disabled, carriers, originCarrier }: {
  policy: ShippingChargeGroupRegionPolicy; onChange: (value: ShippingChargeGroupRegionPolicy) => void;
  tsv: string; onTsvChange: (value: string) => void; disabled: boolean; carriers: EditableCarrier[]; originCarrier: string | null;
}) {
  const patch = (value: Partial<ShippingChargeGroupRegionPolicy>) => onChange({ ...policy, ...value });
  const parsed = parseShippingRegionRulesTsv(tsv, policy.rules);
  const rules = parsed.rules ?? [];
  return <fieldset disabled={disabled} className="admin-shipping-charge-group-editor__region">
    <legend>그룹 지역 추가료 · 그룹당 한 번</legend>
    <p>실제 계약의 우편번호·주소 구간과 요금을 입력합니다. 이 그룹의 상품은 출고지 지역료와 중복 부과하지 않으며, 기본 배송비 반복 횟수로 지역료를 곱하지 않습니다.</p>
    <div className="admin-shipping-charge-group-editor__grid">
      <label>계약 택배사<select value={policy.carrierCode} onChange={event => patch({ carrierCode: event.target.value })}>
        <option value="">택배사를 선택해주세요</option>{carriers.map(carrier => <option key={carrier.code} value={carrier.code} disabled={!carrier.active && carrier.code !== policy.carrierCode}>{carrier.label}{carrier.active ? '' : ' · 사용 안 함'}</option>)}
        {policy.carrierCode && !carriers.some(carrier => carrier.code === policy.carrierCode) ? <option value={policy.carrierCode}>{policy.carrierCode} · 현재 목록 확인 필요</option> : null}
      </select></label>
      <p>출고지 기본 택배사: {carriers.find(carrier => carrier.code === originCarrier)?.label ?? originCarrier ?? '미설정'}. 실제 계약 택배사와 일치하는지 확인해주세요.</p>
      <label>적용 시작 · 한국 시각<input type="datetime-local" step="any" value={localDate(policy.startsAt)} onChange={event => patch({ startsAt: serverDate(event.target.value) })} /></label>
      <label>적용 종료 방식<select value={policy.openEnded === null ? '' : String(policy.openEnded)} onChange={event => {
        const openEnded = event.target.value === '' ? null : event.target.value === 'true'; patch({ openEnded, ...(openEnded ? { endsAt: null } : {}) });
      }}><option value="">미확인</option><option value="true">무기한</option><option value="false">종료 일시 지정</option></select></label>
      <label>적용 종료 · 한국 시각<input type="datetime-local" step="any" value={localDate(policy.endsAt)} disabled={policy.openEnded === true} onChange={event => patch({ endsAt: serverDate(event.target.value) })} /></label>
      <label>표에 없는 지역<select value={policy.unlistedDisposition ?? ''} onChange={event => patch({ unlistedDisposition: event.target.value === '' ? null : event.target.value as 'standard' | 'manual_review' })}>
        <option value="">미확인</option><option value="standard">추가료 없음</option><option value="manual_review">개별 확인 필요</option></select></label>
    </div>
    <label>물류사 회신·계약 근거<textarea rows={3} value={policy.sourceEvidence} maxLength={2000} onChange={event => patch({ sourceEvidence: event.target.value })} /></label>
    <p>실제 조건을 확인할 수 있는 내부 문서번호나 접근 제한 문서 주소를 입력하세요. 이 근거와 지역표 원문은 고객에게 공개하지 않습니다.</p>
    <label>지역표 · 스프레드시트의 6개 열 붙여넣기<textarea className="admin-shipping-charge-group-editor__tsv" rows={7} spellCheck={false} value={tsv} maxLength={500000} onChange={event => onTsvChange(event.target.value)} /></label>
    <p>우편번호 시작·끝 / 기본주소 시작문구 / 지역명 / 처리 / 추가료 순서입니다. 처리는 ‘추가료 없음’, ‘추가료 부과’, ‘배송 불가’, ‘개별 확인 필요’ 중 하나이며 추가료 부과 행의 0원은 명시해야 합니다. 최대 1,000행입니다.</p>
    <p>2권역·3권역 이름만으로 주소를 임의 분류하지 않습니다. 제주·도서산간도 실제 물류사 분류 근거에 있는 주소 구간을 입력해주세요.</p>
    <label className="admin-shipping-charge-group-editor__check"><input type="checkbox" checked={policy.noRulesConfirmed} onChange={event => patch({ noRulesConfirmed: event.target.checked })} /><span>실제 회신에 예외 지역이 없으며 지역표가 비어 있음을 확인했습니다.</span></label>
    {parsed.error ? <p className="admin-shipping-charge-groups__error" role="alert">{parsed.error}</p> : <details><summary>지역표 미리보기 · {rules.length}행</summary>
      {rules.length ? <div className="admin-shipping-charge-groups__table"><table><caption>그룹 지역 추가료 주소표</caption><thead><tr><th>우편번호</th><th>주소 시작문구</th><th>지역명</th><th>처리</th><th>추가료</th></tr></thead>
        <tbody>{rules.slice(0, 50).map((row, index) => <tr key={row.id ?? index}><td>{row.postalFrom || '미입력'}~{row.postalTo || '미입력'}</td><td>{row.addressPrefix || '우편번호로 판정'}</td><td>{row.regionLabel || '미입력'}</td><td>{row.disposition ? REGION_DISPOSITION_LABELS[row.disposition] : '미입력'}</td><td>{row.amount === null ? row.disposition === 'surcharge' ? '미입력' : '해당 없음' : `${row.amount.toLocaleString('ko-KR')}원`}</td></tr>)}</tbody></table>
        {rules.length > 50 ? <p>앞의 50행을 표시합니다. 저장 시 전체 {rules.length}행을 검증합니다.</p> : null}</div> : <p>입력된 지역표가 없습니다. 미입력과 확인된 예외 지역 없음을 구분합니다.</p>}
    </details>}
  </fieldset>;
}

function OperationRecovery({ context, identity, scope, canEdit, onReceipt }: {
  context: ShippingChargeGroupOperationContext; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope;
  canEdit: boolean; onReceipt: (receipt: ShippingChargeGroupOperationReceipt) => void;
}) {
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: context.groupId, command: context.command, onReceipt });
  return <div className="admin-shipping-charge-groups__recovery">
    <strong>미확정 {context.command === 'save' ? '묶음그룹 저장' : '상품 배정'} 요청</strong>
    <p>요청번호 {context.operationId} · 기준 버전 {context.expectedRevision}</p>
    <p>원래 입력을 다시 보내지 않습니다. 결과를 확인하거나 미처리 요청을 종료한 뒤 최신 내용으로 진행해주세요.</p>
    <div className="admin-shipping-charge-groups__actions"><button className="btn btn-sm" type="button" disabled={operation.busy} onClick={() => { void operation.recover(); }}>저장 결과 확인</button>
      <button className="btn btn-sm btn-ghost" type="button" disabled={operation.busy || !canEdit} onClick={() => { void operation.recover(true); }}>미처리 요청 종료</button></div>
    {operation.error ? <p className="admin-shipping-charge-groups__error" role="alert">{operation.error}</p> : null}
    {operation.message ? <p role="status">{operation.message}</p> : null}
  </div>;
}

type EditorStart = { id: string; data: ShippingChargeGroupData | null; originId: string };
export function ShippingChargeGroupEditor({ start, identity, scope, origins, carriers, canEdit, canManageRegional, initialList, otherPending, onClose, onSaved }: {
  start: EditorStart; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope; origins: GoodsFulfillmentOrigin[];
  carriers: EditableCarrier[]; canEdit: boolean; canManageRegional: boolean; initialList: ShippingChargeGroupListData;
  otherPending: boolean; onClose: () => void; onSaved: (receipt: ShippingChargeGroupOperationReceipt) => void;
}) {
  const [base, setBase] = useState(start.data?.group ?? null);
  const [values, setValues] = useState(() => start.data ? groupValues(start.data.group) : emptyShippingChargeGroupValues());
  const [originId, setOriginId] = useState(start.data?.origin.id ?? start.originId);
  const [origin, setOrigin] = useState<ShippingChargeGroupOriginGuard | null>(start.data?.origin ?? initialList.origins.find(item => item.id === start.originId) ?? null);
  const [capabilities, setCapabilities] = useState({ runtimeEnabled: start.data?.runtimeEnabled ?? initialList.runtimeEnabled, canManageRegional: start.data?.canManageRegional ?? initialList.canManageRegional });
  const firstRegion = start.data?.group.regional.mode === 'override' ? start.data.group.regional.policy : emptyShippingChargeGroupRegionPolicy(origin?.defaultCarrier ?? '');
  const [regional, setRegional] = useState(() => structuredClone(firstRegion)), [tsv, setTsv] = useState(() => shippingRegionRulesTsv(firstRegion.rules));
  const [attested, setAttested] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [reading, setReading] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false), [latest, setLatest] = useState<ShippingChargeGroupData | null>(null);
  const readLane = useRef(false), alive = useRef(true);
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: start.id, command: 'save', onReceipt: receipt => {
    if (receipt.state === 'saved') onSaved(receipt);
    else if (receipt.state === 'sealed') { setNeedsRefresh(true); setAttested(false); setMessage('미처리 요청을 종료했습니다. 입력은 유지됩니다. 최신 저장 기준을 확인한 뒤 다시 저장해주세요.'); }
  } });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const parsed = parseShippingRegionRulesTsv(tsv, regional.rules);
  const currentRegional: ShippingChargeGroupValues['regional'] = values.regional.mode === 'inherit' ? { mode: 'inherit', policy: null }
    : { mode: 'override', policy: { ...regional, sourceEvidence: regional.sourceEvidence.trim(), rules: parsed.rules ?? regional.rules } };
  const current: ShippingChargeGroupValues = { ...values, name: values.name.trim(), regional: currentRegional };
  const regionalChange = regionalKey(currentRegional) !== regionalKey(base?.regional ?? { mode: 'inherit', policy: null });
  const regionalActivation = currentRegional.mode === 'override' && current.enabled && !current.archived && !(base?.enabled && !base.archived);
  const regionalReview = regionalChange || regionalActivation;
  const regionalAllowed = canManageRegional && capabilities.canManageRegional;
  const locked = operation.busy || Boolean(operation.context) || reading || otherPending;
  const regionProblems = currentRegional.mode === 'override' ? shippingChargeGroupRegionalProblems(currentRegional.policy) : [];
  const inUse = (base?.assignedCount ?? 0) > 0;
  function change(patch: Partial<ShippingChargeGroupValues>) { setValues(previous => ({ ...previous, ...patch })); setAttested(false); setError(''); }
  function changeRegion(value: ShippingChargeGroupRegionPolicy) { setRegional(value); setAttested(false); setError(''); }
  async function readOrigin(id: string) {
    if (readLane.current || locked || !id) return;
    const ticket = scope.capture(); if (!ticket) return;
    readLane.current = true; setReading(true); setError('');
    try {
      const result = await listShippingChargeGroupsAction({ originId: id, query: '', status: 'all', page: 1 }, identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return; }
      setOrigin(result.data.origins.find(item => item.id === id) ?? null);
      setCapabilities({ runtimeEnabled: result.data.runtimeEnabled, canManageRegional: result.data.canManageRegional });
      setNeedsRefresh(false); setMessage('출고지와 기본 그룹의 현재 저장 기준을 확인했습니다.');
    } catch { if (alive.current && scope.canApply(ticket)) setError('출고지의 저장 기준을 읽지 못했습니다. 입력은 유지됩니다.'); }
    finally { readLane.current = false; if (alive.current && scope.canApply(ticket)) setReading(false); }
  }
  async function readLatest() {
    if (locked || readLane.current) return;
    if (!base) { await readOrigin(originId); return; }
    const ticket = scope.capture(); if (!ticket) return;
    readLane.current = true; setReading(true); setError('');
    try {
      const result = await getShippingChargeGroupAction(start.id, identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
      else { setLatest(result.data); setMessage('현재 입력과 최신 저장본을 비교한 뒤 저장 기준을 선택해주세요.'); }
    } catch { if (alive.current && scope.canApply(ticket)) setError('최신 저장본을 읽지 못했습니다. 현재 입력은 유지됩니다.'); }
    finally { readLane.current = false; if (alive.current && scope.canApply(ticket)) setReading(false); }
  }
  function acceptLatest(keepInput: boolean) {
    if (!latest || locked) return;
    setBase(latest.group); setOrigin(latest.origin); setOriginId(latest.origin.id);
    setCapabilities({ runtimeEnabled: latest.runtimeEnabled, canManageRegional: latest.canManageRegional });
    if (!keepInput) {
      setValues(groupValues(latest.group));
      const policy = latest.group.regional.mode === 'override' ? latest.group.regional.policy : emptyShippingChargeGroupRegionPolicy(latest.origin.defaultCarrier ?? '');
      setRegional(structuredClone(policy)); setTsv(shippingRegionRulesTsv(policy.rules));
    }
    setLatest(null); setNeedsRefresh(false); setAttested(false); setMessage(keepInput ? '내 입력을 유지하고 최신 저장 기준을 선택했습니다.' : '최신 저장본을 불러왔습니다.');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || needsRefresh || !canEdit) return;
    if (!origin || origin.id !== originId) { setError('출고지의 최신 저장 기준을 먼저 확인해주세요.'); return; }
    if (!current.name || [...current.name].length > 80) { setError('그룹 이름을 1~80자로 입력해주세요.'); return; }
    if (inUse && (!current.enabled || current.archived)) { setError('배정된 상품을 먼저 해제하거나 다른 그룹으로 옮긴 뒤 사용 중지·보관할 수 있습니다.'); return; }
    if (current.enabled && (!capabilities.runtimeEnabled || !origin.isActive)) { setError('현재 출고지·상품 거래 조건에서는 그룹을 사용할 수 없습니다. 사용 안 함 상태로 저장해주세요.'); return; }
    if (currentRegional.mode === 'override' && parsed.error) { setError(parsed.error); return; }
    if (regionalReview && (!regionalAllowed || !attested)) { setError('지역 설정 변경 또는 재활성화에는 별도 관리 권한과 명시적인 확인이 필요합니다.'); return; }
    if (current.enabled && !current.archived && regionProblems.length) { setError('사용 전에 지역표·계약·기간의 확인 항목을 모두 해결해주세요.'); return; }
    const request = parseShippingChargeGroupSaveRequest({ operationId: crypto.randomUUID(), command: 'save', groupId: start.id,
      expectedRevision: base?.revision ?? 0, ...identity, originId, originUpdatedAt: origin.updatedAt,
      expectedDefaultGroupId: origin.defaultGroupId, expectedDefaultGroupRevision: origin.defaultGroupRevision,
      values: current, attestRegional: regionalReview && attested });
    if (!request) { setError('그룹·지역 설정의 입력 형식을 확인해주세요. 현재 입력은 유지됩니다.'); return; }
    setError(''); setMessage(''); await operation.send(request);
  }
  return <CustomerServiceDialog title={base ? '배송비 묶음그룹 수정' : '배송비 묶음그룹 추가'} onClose={() => { if (!locked) onClose(); }} busy={locked} wide>
    <form className="wc-admin-kit admin-shipping-charge-group-editor" onSubmit={submit}>
      <fieldset disabled={locked || !canEdit}>
        <div className="admin-shipping-charge-group-editor__grid">
          <label>출고지<select value={originId} disabled={Boolean(base)} onChange={event => { const id = event.target.value; setOriginId(id); setOrigin(null); setAttested(false); if (id) void readOrigin(id); }}>
            <option value="">출고지를 선택해주세요</option>{origins.map(item => <option key={item.id} value={item.id} disabled={!item.active && item.id !== originId}>{item.name}{item.active ? '' : ' · 비활성'}</option>)}
          </select></label>
          <label>묶음그룹 이름<input value={values.name} maxLength={80} required onChange={event => change({ name: event.target.value })} /></label>
          <label>사용 여부<select value={String(values.enabled)} disabled={inUse || values.archived || (!regionalAllowed && base?.regional.mode === 'override' && !base.enabled)} onChange={event => {
            const enabled = event.target.value === 'true'; change({ enabled, ...(!enabled ? { isDefault: false } : {}) });
          }}><option value="false">사용 안 함</option><option value="true" disabled={!capabilities.runtimeEnabled || !origin?.isActive}>사용</option></select></label>
          <label>계산 방식<select value={values.calculationMode} onChange={event => change({ calculationMode: event.target.value as 'min' | 'max' })}><option value="min">그룹에서 가장 작은 배송비 부과</option><option value="max">그룹에서 가장 큰 배송비 부과</option></select></label>
        </div>
        <p>유효한 무료배송 조건을 충족한 상품이 있으면 최소·최대 방식 모두 그룹 기본 배송비가 0원입니다. 활성 수량 정책과 그룹 전체 구매 수량을 먼저 반영하며 지역 추가료는 별도로 판단합니다.</p>
        <label className="admin-shipping-charge-group-editor__check"><input type="checkbox" checked={values.isDefault} disabled={!values.enabled || values.archived} onChange={event => change({ isDefault: event.target.checked })} /><span>이 출고지의 기본 그룹으로 표시</span></label>
        <p>기본 그룹은 선택을 돕는 표시입니다. 신규 상품은 기본 상품 저장 후 직접 배정하며, 이미 저장된 상품의 그룹은 자동으로 바꾸지 않습니다.</p>
        {base ? <label className="admin-shipping-charge-group-editor__check"><input type="checkbox" checked={values.archived} disabled={inUse} onChange={event => change({ archived: event.target.checked, ...(event.target.checked ? { enabled: false, isDefault: false } : {}) })} /><span>그룹 보관 · 기존 정책 이력은 유지</span></label> : null}
        {inUse ? <p>현재 원상품 {base?.assignedCount.toLocaleString('ko-KR')}개에 배정되어 사용 중지·보관할 수 없습니다. 상품의 배정을 먼저 명시적으로 변경해주세요.</p> : null}
        {!capabilities.runtimeEnabled ? <p>현재 상품 거래 경로에서 그룹을 사용할 수 없습니다. 사용 안 함 상태의 설정만 저장할 수 있습니다.</p> : null}
        <label>지역 추가료 적용 방식<select value={values.regional.mode} disabled={!regionalAllowed} onChange={event => change({ regional: event.target.value === 'inherit' ? { mode: 'inherit', policy: null } : { mode: 'override', policy: regional } })}>
          <option value="inherit">출고지 지역 정책 상속</option><option value="override">이 그룹의 지역표로 지정 · 그룹당 한 번</option>
        </select></label>
        {values.regional.mode === 'inherit' ? <p>같은 출고지에서 정책을 상속하는 상품과 함께 지역료를 계산합니다. 배송 건당 지역료를 그룹 수만큼 반복 부과하지 않습니다.</p>
          : <RegionFields policy={regional} onChange={changeRegion} tsv={tsv} onTsvChange={value => { setTsv(value); setAttested(false); setError(''); }} disabled={!regionalAllowed} carriers={carriers} originCarrier={origin?.defaultCarrier ?? null} />}
        {!regionalAllowed ? <p>지역 설정 변경과 비활성 그룹 지역 정책의 재활성화는 별도 관리 권한이 필요합니다. 기존 지역 설정을 유지한 이름·계산 방식 수정은 가능합니다.</p> : null}
        {values.regional.mode === 'override' && regionProblems.length ? <div><strong>지역 정책 사용 전 확인</strong><ul className="admin-shipping-charge-group-editor__problems">{regionProblems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div> : null}
        {regionalReview ? <label className="admin-shipping-charge-group-editor__check"><input type="checkbox" checked={attested} disabled={!regionalAllowed} onChange={event => setAttested(event.target.checked)} /><span>지역 추가료 설정을 변경하는 내용과 적용 범위를 확인했습니다.</span></label> : null}
      </fieldset>
      {latest ? <div className="admin-shipping-charge-groups__notice"><strong>최신 저장본과 비교</strong><ShippingChargeGroupSummary group={latest.group} originName={latest.origin.name} />
        <p>현재 입력: {values.name || '이름 미입력'} · {values.enabled ? '사용' : '사용 안 함'} · {values.isDefault ? '기본 그룹' : '일반 그룹'} · {values.calculationMode === 'min' ? '최소 부과' : '최대 부과'} · {values.regional.mode === 'inherit' ? '출고지 지역 정책 상속' : '그룹 지역표 지정'}</p>
        <p>최신 저장본: {latest.group.isDefault ? '기본 그룹' : '일반 그룹'} · 배정 원상품 {latest.group.assignedCount}개</p>
        {latest.group.regional.mode === 'override' ? <details><summary>최신 저장본의 지역표·계약 근거</summary><p>택배사 {latest.group.regional.policy.carrierCode} · 시작 {latest.group.regional.policy.startsAt ?? '미확인'} · 종료 {latest.group.regional.policy.openEnded ? '무기한' : latest.group.regional.policy.endsAt ?? '미확인'}</p>
          <p>표에 없는 지역: {latest.group.regional.policy.unlistedDisposition === 'standard' ? '추가료 없음' : latest.group.regional.policy.unlistedDisposition === 'manual_review' ? '개별 확인 필요' : '미확인'} · 예외 지역 없음 확인: {latest.group.regional.policy.noRulesConfirmed ? '확인함' : '확인하지 않음'}</p>
          <p>{latest.group.regional.policy.sourceEvidence || '근거 미입력'}</p><pre className="admin-shipping-charge-group-editor__tsv">{shippingRegionRulesTsv(latest.group.regional.policy.rules)}</pre></details> : null}
        <div className="admin-shipping-charge-groups__actions"><button className="btn btn-sm" type="button" disabled={locked} onClick={() => acceptLatest(true)}>내 입력 유지 · 최신 버전을 저장 기준으로</button><button className="btn btn-sm btn-ghost" type="button" disabled={locked} onClick={() => acceptLatest(false)}>최신 저장본 불러오기</button></div>
      </div> : null}
      {otherPending ? <p role="status">다른 묶음그룹 요청의 결과를 먼저 확인해주세요.</p> : null}
      {error || operation.error ? <p className="admin-shipping-charge-groups__error" role="alert">{error || operation.error}</p> : null}
      {message || operation.message ? <p role="status">{message || operation.message}</p> : null}
      {operation.context ? <div className="admin-shipping-charge-groups__recovery"><strong>같은 요청의 결과를 확인해주세요.</strong><p>새로고침 후에도 요청번호와 저장 기준만 남습니다. 입력 원문은 저장하지 않으며 원래 요청을 자동 재전송하지 않습니다.</p>
        <div className="admin-shipping-charge-groups__actions"><button className="btn" type="button" disabled={operation.busy || reading} onClick={() => { void operation.recover(); }}>저장 결과 확인</button><button className="btn btn-ghost" type="button" disabled={operation.busy || reading || !canEdit} onClick={() => { void operation.recover(true); }}>미처리 요청 종료</button></div>
      </div> : null}
      <div className="admin-shipping-charge-groups__actions"><button className="btn" type="submit" disabled={locked || needsRefresh || !canEdit}>{operation.busy ? '처리 중…' : base ? '새 버전 저장' : '묶음그룹 추가'}</button>
        <button className="btn btn-ghost" type="button" disabled={locked} onClick={() => { void readLatest(); }}>최신 저장 기준 확인</button><button className="btn btn-ghost" type="button" disabled={locked} onClick={onClose}>취소</button></div>
    </form>
  </CustomerServiceDialog>;
}

function GroupsWorkspace({ identity, scope, origins, carriers, canEdit, canManageRegional }: {
  identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope; origins: GoodsFulfillmentOrigin[]; carriers: EditableCarrier[];
  canEdit: boolean; canManageRegional: boolean;
}) {
  const [filters, setFilters] = useState(emptyFilters), [applied, setApplied] = useState(emptyFilters);
  const [data, setData] = useState<ShippingChargeGroupListData | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [editor, setEditor] = useState<EditorStart | null>(null);
  const [assignment, setAssignment] = useState<ShippingChargeGroup | null>(null);
  const pending = useShippingChargeGroupPending(identity), lane = useRef(false), alive = useRef(true);
  const { expectedActorId, expectedSessionId } = identity;
  const load = useCallback(async (next: ShippingChargeGroupFilters) => {
    const ticket = scope.capture(); if (!ticket || lane.current) return;
    lane.current = true; setBusy(true); setError('');
    try {
      const result = await listShippingChargeGroupsAction(next, { expectedActorId, expectedSessionId });
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setData(null); setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
      else { setData(result.data); setApplied(next); }
    } catch { if (alive.current && scope.canApply(ticket)) { setData(null); setError('배송비 묶음그룹을 불러오지 못했습니다. 조회 조건은 유지됩니다.'); } }
    finally { lane.current = false; if (alive.current && scope.canApply(ticket)) setBusy(false); }
  }, [scope, expectedActorId, expectedSessionId]);
  useEffect(() => { alive.current = true; const task = setTimeout(() => { void load(emptyFilters()); }, 0); return () => { clearTimeout(task); alive.current = false; }; }, [load]);
  async function edit(group: ShippingChargeGroup) {
    const ticket = scope.capture(); if (!ticket || busy || lane.current || pending.length) return;
    lane.current = true; setBusy(true); setError('');
    try {
      const result = await getShippingChargeGroupAction(group.id, identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
      else setEditor({ id: group.id, data: result.data, originId: result.data.origin.id });
    } catch { if (alive.current && scope.canApply(ticket)) setError('묶음그룹의 최신 내용을 읽지 못했습니다. 다시 조회해주세요.'); }
    finally { lane.current = false; if (alive.current && scope.canApply(ticket)) setBusy(false); }
  }
  function receiptReceived(receipt: ShippingChargeGroupOperationReceipt) {
    setEditor(null); setAssignment(null); setMessage(receipt.state === 'sealed' ? '미처리 요청을 종료했습니다. 최신 내용을 확인하고 다시 진행해주세요.'
      : receipt.state === 'saved' ? `‘${receipt.group?.name}’ 버전 ${receipt.group?.revision} 저장을 확인했습니다.` : `${receipt.appliedCount}개 원상품의 묶음그룹 배정 결과를 확인했습니다.`);
    void load(applied);
  }
  const locked = busy || Boolean(pending.length);
  return <>
    <form className="admin-shipping-charge-groups__filters" onSubmit={event => { event.preventDefault(); if (!busy) void load({ ...filters, query: filters.query.trim(), page: 1 }); }}>
      <label>출고지<select value={filters.originId ?? ''} disabled={busy} onChange={event => setFilters({ ...filters, originId: event.target.value || null })}><option value="">전체 출고지</option>{origins.map(origin => <option key={origin.id} value={origin.id}>{origin.name}{origin.active ? '' : ' · 비활성'}</option>)}</select></label>
      <label>사용 상태<select value={filters.status} disabled={busy} onChange={event => setFilters({ ...filters, status: event.target.value as ShippingChargeGroupFilters['status'] })}><option value="all">전체</option><option value="active">사용</option><option value="inactive">사용 안 함</option><option value="archived">보관</option></select></label>
      <label className="admin-shipping-charge-groups__filter-query">배송비 묶음그룹명<input value={filters.query} maxLength={100} disabled={busy} onChange={event => setFilters({ ...filters, query: event.target.value })} placeholder="묶음그룹 이름을 입력해주세요" /></label>
      <div className="admin-shipping-charge-groups__filter-actions"><button className="btn" type="submit" disabled={busy}>조회</button><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { const next = emptyFilters(); setFilters(next); void load(next); }}>초기화</button></div>
    </form>
    {message ? <p className="admin-shipping-charge-groups__notice" role="status">{message}</p> : null}
    {error ? <p className="admin-shipping-charge-groups__error" role="alert">{error}</p> : null}
    {!editor && !assignment ? pending.map(context => <OperationRecovery key={context.operationId} context={context} identity={identity} scope={scope} canEdit={canEdit} onReceipt={receiptReceived} />) : null}
    <div className="admin-shipping-charge-groups__results" aria-busy={busy}>
      <div className="admin-shipping-charge-groups__result-heading"><h3>조회 결과 <span>총 {data?.total.toLocaleString('ko-KR') ?? '—'}개</span></h3>
        {canEdit ? <button className="btn btn-sm" type="button" disabled={locked || !data} onClick={() => { if (!locked && data) { setMessage(''); setEditor({ id: crypto.randomUUID(), data: null, originId: applied.originId ?? '' }); } }}>묶음그룹 추가</button> : <span className="admin-shipping-charge-groups__muted">읽기 전용</span>}
      </div>
      {busy ? <p className="admin-shipping-charge-groups__hint" role="status">묶음그룹을 불러오고 있습니다.</p> : null}
      <div className="admin-shipping-charge-groups__table"><table><caption>배송비 묶음그룹 목록</caption><thead><tr><th>그룹명</th><th>출고지</th><th>계산 방식</th><th>지역 추가료</th><th>배정 원상품</th><th>사용 상태</th><th>버전·수정일</th><th>관리</th></tr></thead>
        <tbody>{data?.groups.map(group => <tr key={group.id}><th scope="row">{group.name}{group.isDefault ? <small><span className="admin-shipping-charge-groups__badge">기본 그룹</span></small> : null}<small>그룹번호 {group.id}</small></th>
          <td>{origins.find(origin => origin.id === group.originId)?.name ?? '출고지 확인 필요'}</td><td>{group.calculationMode === 'min' ? '최소 부과' : '최대 부과'}<small>유효 무료 조건 우선</small></td>
          <td>{group.regional.mode === 'inherit' ? '출고지 정책 상속' : '그룹 지역표 1회'}{group.regional.mode === 'override' ? <small>{group.regional.policy.rules.length.toLocaleString('ko-KR')}개 주소 구간</small> : null}</td>
          <td><button className="btn btn-sm btn-ghost" type="button" disabled={locked} aria-label={`${group.name} 연결 원상품 ${group.assignedCount}개 조회`} onClick={() => { if (!locked) setAssignment(group); }}>{group.assignedCount.toLocaleString('ko-KR')}개</button></td><td>{group.archived ? '보관' : group.enabled ? '사용' : '사용 안 함'}</td><td>버전 {group.revision}<small>{formatOrderDateTime(group.updatedAt)}</small></td>
          <td><div className="admin-shipping-charge-groups__actions"><button className="btn btn-sm btn-ghost" type="button" disabled={locked} onClick={() => { void edit(group); }}>{canEdit ? '조회/수정' : '조회'}</button>
            {canEdit ? <button className="btn btn-sm btn-ghost" type="button" disabled={locked} onClick={() => { if (!locked) setAssignment(group); }}>상품 배정</button> : null}</div></td></tr>)}</tbody></table></div>
      {!busy && data && !data.groups.length ? <p className="admin-shipping-charge-groups__empty">{applied.query || applied.originId || applied.status !== 'all' ? '조회 조건에 맞는 묶음그룹이 없습니다.' : '등록한 배송비 묶음그룹이 없습니다. 기존 상품은 현재 배송비 규칙을 유지합니다.'}</p> : null}
      <div className="admin-shipping-charge-groups__pagination"><button className="btn btn-sm btn-ghost" type="button" disabled={busy || !data || data.page <= 1} onClick={() => { void load({ ...applied, page: (data?.page ?? 1) - 1 }); }}>이전</button>
        <span>{data?.page ?? 1} / {data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1}</span><button className="btn btn-sm btn-ghost" type="button" disabled={busy || !data || data.page * data.pageSize >= data.total} onClick={() => { void load({ ...applied, page: (data?.page ?? 1) + 1 }); }}>다음</button></div>
    </div>
    <p className="admin-shipping-charge-groups__hint">같은 주문·출고지의 배송비만 묶습니다. 전시 그룹상품·구매 합산군과 구분하며, 기본 그룹 변경으로 기존 상품을 자동 재배정하지 않습니다.</p>
    {editor && data ? <ShippingChargeGroupEditor key={`${identity.expectedActorId}:${identity.expectedSessionId}:${editor.id}`} start={editor} identity={identity} scope={scope} origins={origins} carriers={carriers}
      canEdit={canEdit} canManageRegional={canManageRegional} initialList={data} otherPending={pending.some(context => context.groupId !== editor.id || context.command !== 'save')} onClose={() => setEditor(null)} onSaved={receiptReceived} /> : null}
    {assignment ? <ShippingChargeGroupAssignmentDialog key={`${identity.expectedActorId}:${identity.expectedSessionId}:${assignment.id}`} group={assignment}
      identity={identity} scope={scope} canEdit={canEdit} onClose={() => setAssignment(null)} onApplied={receiptReceived} /> : null}
  </>;
}

export function ShippingChargeGroupsPanel({ accountId, origins, carriers, canEdit, canManageRegional }: {
  accountId: string; origins: GoodsFulfillmentOrigin[]; carriers: EditableCarrier[]; canEdit: boolean; canManageRegional: boolean;
}) {
  const { identity, scope, blocked } = useShippingChargeGroupSession(accountId);
  return <section id="shipping-charge-groups" className="wc-admin-kit admin-shipping-charge-groups" aria-labelledby="shipping-charge-groups-title">
    <header className="admin-shipping-charge-groups__heading"><h2 id="shipping-charge-groups-title">배송비 묶음그룹 관리</h2><p>배송비를 함께 계산할 그룹과 최소·최대 부과, 무료 우선, 지역 추가료를 관리합니다.</p></header>
    {identity ? <GroupsWorkspace key={`${identity.expectedActorId}:${identity.expectedSessionId}`} identity={identity} scope={scope} origins={origins} carriers={carriers} canEdit={canEdit} canManageRegional={canManageRegional} />
      : <p role={blocked ? 'alert' : 'status'}>{blocked ? '로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.' : '현재 로그인과 묶음그룹 관리 권한을 확인하고 있습니다.'}</p>}
  </section>;
}

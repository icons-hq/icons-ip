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
import { Plus, Search } from 'lucide-react';
import { CONSOLE_LIST_EMPTY_CLASS, CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableHeader } from '@/components/admin/console/ConsoleListCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { statusTone } from '@/lib/admin/status-tone';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, CHECK_LABEL, CHECK_LABEL_TOP, FIELD_HINT, FIELD_LABEL, INFO_PANEL, NOTE, TABLE_BOX, TSV_TEXTAREA } from '@/components/admin/settings-kit';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';

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
  return <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border p-3 sm:p-4">
    <legend className="float-left w-full p-0 text-sm font-medium">그룹 지역 추가료 · 그룹당 한 번</legend>
    <p className={NOTE}>실제 계약의 우편번호·주소 구간과 요금을 입력합니다. 이 그룹의 상품은 출고지 지역료와 중복 부과하지 않으며, 기본 배송비 반복 횟수로 지역료를 곱하지 않습니다.</p>
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={FIELD_LABEL}>계약 택배사<NativeSelect className="w-full" value={policy.carrierCode} onChange={event => patch({ carrierCode: event.target.value })}>
        <option value="">택배사를 선택해주세요</option>{carriers.map(carrier => <option key={carrier.code} value={carrier.code} disabled={!carrier.active && carrier.code !== policy.carrierCode}>{carrier.label}{carrier.active ? '' : ' · 사용 안 함'}</option>)}
        {policy.carrierCode && !carriers.some(carrier => carrier.code === policy.carrierCode) ? <option value={policy.carrierCode}>{policy.carrierCode} · 현재 목록 확인 필요</option> : null}
      </NativeSelect></label>
      <p className={`${NOTE} self-end`}>출고지 기본 택배사: {carriers.find(carrier => carrier.code === originCarrier)?.label ?? originCarrier ?? '미설정'}. 실제 계약 택배사와 일치하는지 확인해주세요.</p>
      <label className={FIELD_LABEL}>적용 시작 · KST<Input type="datetime-local" step="any" value={localDate(policy.startsAt)} onChange={event => patch({ startsAt: serverDate(event.target.value) })} /></label>
      <label className={FIELD_LABEL}>적용 종료 방식<NativeSelect className="w-full" value={policy.openEnded === null ? '' : String(policy.openEnded)} onChange={event => {
        const openEnded = event.target.value === '' ? null : event.target.value === 'true'; patch({ openEnded, ...(openEnded ? { endsAt: null } : {}) });
      }}><option value="">미확인</option><option value="true">무기한</option><option value="false">종료 일시 지정</option></NativeSelect></label>
      <label className={FIELD_LABEL}>적용 종료 · KST<Input type="datetime-local" step="any" value={localDate(policy.endsAt)} disabled={policy.openEnded === true} onChange={event => patch({ endsAt: serverDate(event.target.value) })} /></label>
      <label className={FIELD_LABEL}>표에 없는 지역<NativeSelect className="w-full" value={policy.unlistedDisposition ?? ''} onChange={event => patch({ unlistedDisposition: event.target.value === '' ? null : event.target.value as 'standard' | 'manual_review' })}>
        <option value="">미확인</option><option value="standard">추가료 없음</option><option value="manual_review">개별 확인 필요</option></NativeSelect></label>
    </div>
    <label className={FIELD_LABEL}>물류사 회신·계약 근거<Textarea rows={3} value={policy.sourceEvidence} maxLength={2000} onChange={event => patch({ sourceEvidence: event.target.value })} /></label>
    <p className={NOTE}>실제 조건을 확인할 수 있는 내부 문서번호나 접근 제한 문서 주소를 입력하세요. 이 근거와 지역표 원문은 고객에게 공개하지 않습니다.</p>
    <label className={FIELD_LABEL}>지역표 · 스프레드시트의 6개 열 붙여넣기<Textarea className={TSV_TEXTAREA} rows={7} spellCheck={false} value={tsv} maxLength={500000} onChange={event => onTsvChange(event.target.value)} /></label>
    <p className={NOTE}>우편번호 시작·끝 / 기본주소 시작문구 / 지역명 / 처리 / 추가료 순서입니다. 처리는 ‘추가료 없음’, ‘추가료 부과’, ‘배송 불가’, ‘개별 확인 필요’ 중 하나이며 추가료 부과 행의 0원은 명시해야 합니다. 최대 1,000행입니다.</p>
    <p className={NOTE}>2권역·3권역 이름만으로 주소를 임의 분류하지 않습니다. 제주·도서산간도 실제 물류사 분류 근거에 있는 주소 구간을 입력해주세요.</p>
    <label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={policy.noRulesConfirmed} onChange={event => patch({ noRulesConfirmed: event.target.checked })} /><span>실제 회신에 예외 지역이 없으며 지역표가 비어 있음을 확인했습니다.</span></label>
    {parsed.error ? <AdminNotice role="alert" tone="danger">{parsed.error}</AdminNotice> : <details className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm"><summary className="cursor-pointer font-medium">지역표 미리보기 · {rules.length}행</summary>
      {rules.length ? <div className={`mt-2 ${TABLE_BOX}`}><Table className="min-w-[40rem]"><caption className="sr-only">그룹 지역 추가료 주소표</caption><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>우편번호</TableHead><TableHead>주소 시작문구</TableHead><TableHead>지역명</TableHead><TableHead>처리</TableHead><TableHead className="text-right">추가료</TableHead></TableRow></TableHeader>
        <TableBody>{rules.slice(0, 50).map((row, index) => <TableRow key={row.id ?? index}><TableCell className="tabular-nums">{row.postalFrom || '미입력'}~{row.postalTo || '미입력'}</TableCell><TableCell className="whitespace-normal">{row.addressPrefix || '우편번호로 판정'}</TableCell><TableCell>{row.regionLabel || '미입력'}</TableCell><TableCell>{row.disposition ? REGION_DISPOSITION_LABELS[row.disposition] : '미입력'}</TableCell><TableCell className="text-right tabular-nums">{row.amount === null ? row.disposition === 'surcharge' ? '미입력' : '해당 없음' : `${row.amount.toLocaleString('ko-KR')}원`}</TableCell></TableRow>)}</TableBody></Table>
        {rules.length > 50 ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">앞의 50행을 표시합니다. 저장 시 전체 {rules.length}행을 검증합니다.</p> : null}</div> : <p className={`mt-2 ${NOTE}`}>입력된 지역표가 없습니다. 미입력과 확인된 예외 지역 없음을 구분합니다.</p>}
    </details>}
  </fieldset>;
}

function OperationRecovery({ context, identity, scope, canEdit, onReceipt }: {
  context: ShippingChargeGroupOperationContext; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope;
  canEdit: boolean; onReceipt: (receipt: ShippingChargeGroupOperationReceipt) => void;
}) {
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: context.groupId, command: context.command, onReceipt });
  return <div className={INFO_PANEL}>
    <strong className="font-medium">미확정 {context.command === 'save' ? '묶음그룹 저장' : '상품 배정'} 요청</strong>
    <p className="text-muted-foreground tabular-nums">요청번호 {context.operationId} · 기준 버전 {context.expectedRevision}</p>
    <p className="text-muted-foreground">원래 입력을 다시 보내지 않습니다. 결과를 확인하거나 미처리 요청을 종료한 뒤 최신 내용으로 진행해주세요.</p>
    <div className={ACTIONS}><Button disabled={operation.busy} onClick={() => { void operation.recover(); }} size="sm" type="button">저장 결과 확인</Button>
      <Button disabled={operation.busy || !canEdit} onClick={() => { void operation.recover(true); }} size="sm" type="button" variant="outline">미처리 요청 종료</Button></div>
    {operation.error ? <AdminNotice role="alert" tone="danger">{operation.error}</AdminNotice> : null}
    {operation.message ? <AdminNotice role="status" tone="neutral">{operation.message}</AdminNotice> : null}
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
    <form className="flex min-w-0 flex-col gap-4" data-charge-group-editor="" onSubmit={submit}>
      <fieldset disabled={locked || !canEdit} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={FIELD_LABEL}>출고지<NativeSelect className="w-full" value={originId} disabled={Boolean(base)} onChange={event => { const id = event.target.value; setOriginId(id); setOrigin(null); setAttested(false); if (id) void readOrigin(id); }}>
            <option value="">출고지를 선택해주세요</option>{origins.map(item => <option key={item.id} value={item.id} disabled={!item.active && item.id !== originId}>{item.name}{item.active ? '' : ' · 비활성'}</option>)}
          </NativeSelect></label>
          <label className={FIELD_LABEL}>묶음그룹 이름<Input value={values.name} maxLength={80} required onChange={event => change({ name: event.target.value })} /></label>
          <label className={FIELD_LABEL}>사용 여부<NativeSelect className="w-full" value={String(values.enabled)} disabled={inUse || values.archived || (!regionalAllowed && base?.regional.mode === 'override' && !base.enabled)} onChange={event => {
            const enabled = event.target.value === 'true'; change({ enabled, ...(!enabled ? { isDefault: false } : {}) });
          }}><option value="false">사용 안 함</option><option value="true" disabled={!capabilities.runtimeEnabled || !origin?.isActive}>사용</option></NativeSelect></label>
          <label className={FIELD_LABEL}>계산 방식<NativeSelect className="w-full" value={values.calculationMode} onChange={event => change({ calculationMode: event.target.value as 'min' | 'max' })}><option value="min">그룹에서 가장 작은 배송비 부과</option><option value="max">그룹에서 가장 큰 배송비 부과</option></NativeSelect></label>
        </div>
        <p className={NOTE}>유효한 무료배송 조건을 충족한 상품이 있으면 최소·최대 방식 모두 그룹 기본 배송비가 0원입니다. 활성 수량 정책과 그룹 전체 구매 수량을 먼저 반영하며 지역 추가료는 별도로 판단합니다.</p>
        <label className={CHECK_LABEL}><input type="checkbox" checked={values.isDefault} disabled={!values.enabled || values.archived} onChange={event => change({ isDefault: event.target.checked })} /><span>이 출고지의 기본 그룹으로 표시</span></label>
        <p className={NOTE}>기본 그룹은 선택을 돕는 표시입니다. 신규 상품은 기본 상품 저장 후 직접 배정하며, 이미 저장된 상품의 그룹은 자동으로 바꾸지 않습니다.</p>
        {base ? <label className={CHECK_LABEL}><input type="checkbox" checked={values.archived} disabled={inUse} onChange={event => change({ archived: event.target.checked, ...(event.target.checked ? { enabled: false, isDefault: false } : {}) })} /><span>그룹 보관 · 기존 정책 이력은 유지</span></label> : null}
        {inUse ? <AdminNotice tone="warning">현재 원상품 {base?.assignedCount.toLocaleString('ko-KR')}개에 배정되어 사용 중지·보관할 수 없습니다. 상품의 배정을 먼저 명시적으로 변경해주세요.</AdminNotice> : null}
        {!capabilities.runtimeEnabled ? <AdminNotice tone="warning">현재 상품 거래 경로에서 그룹을 사용할 수 없습니다. 사용 안 함 상태의 설정만 저장할 수 있습니다.</AdminNotice> : null}
        <label className={FIELD_LABEL}>지역 추가료 적용 방식<NativeSelect className="w-full" value={values.regional.mode} disabled={!regionalAllowed} onChange={event => change({ regional: event.target.value === 'inherit' ? { mode: 'inherit', policy: null } : { mode: 'override', policy: regional } })}>
          <option value="inherit">출고지 지역 정책 상속</option><option value="override">이 그룹의 지역표로 지정 · 그룹당 한 번</option>
        </NativeSelect></label>
        {values.regional.mode === 'inherit' ? <p className={NOTE}>같은 출고지에서 정책을 상속하는 상품과 함께 지역료를 계산합니다. 배송 건당 지역료를 그룹 수만큼 반복 부과하지 않습니다.</p>
          : <RegionFields policy={regional} onChange={changeRegion} tsv={tsv} onTsvChange={value => { setTsv(value); setAttested(false); setError(''); }} disabled={!regionalAllowed} carriers={carriers} originCarrier={origin?.defaultCarrier ?? null} />}
        {!regionalAllowed ? <p className={NOTE}>지역 설정 변경과 비활성 그룹 지역 정책의 재활성화는 별도 관리 권한이 필요합니다. 기존 지역 설정을 유지한 이름·계산 방식 수정은 가능합니다.</p> : null}
        {values.regional.mode === 'override' && regionProblems.length ? <AdminNotice title="지역 정책 사용 전 확인" tone="warning"><ul className="flex list-disc flex-col gap-1 pl-5">{regionProblems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></AdminNotice> : null}
        {regionalReview ? <label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={attested} disabled={!regionalAllowed} onChange={event => setAttested(event.target.checked)} /><span>지역 추가료 설정을 변경하는 내용과 적용 범위를 확인했습니다.</span></label> : null}
      </fieldset>
      {latest ? <div className={INFO_PANEL}><strong className="font-medium">최신 저장본과 비교</strong><ShippingChargeGroupSummary group={latest.group} originName={latest.origin.name} />
        <p className="text-muted-foreground">현재 입력: {values.name || '이름 미입력'} · {values.enabled ? '사용' : '사용 안 함'} · {values.isDefault ? '기본 그룹' : '일반 그룹'} · {values.calculationMode === 'min' ? '최소 부과' : '최대 부과'} · {values.regional.mode === 'inherit' ? '출고지 지역 정책 상속' : '그룹 지역표 지정'}</p>
        <p className="text-muted-foreground">최신 저장본: {latest.group.isDefault ? '기본 그룹' : '일반 그룹'} · 배정 원상품 {latest.group.assignedCount}개</p>
        {latest.group.regional.mode === 'override' ? <details className="rounded-lg border bg-background px-3 py-2"><summary className="cursor-pointer font-medium">최신 저장본의 지역표·계약 근거</summary><p className="mt-2 text-muted-foreground">택배사 {latest.group.regional.policy.carrierCode} · 시작 {latest.group.regional.policy.startsAt ?? '미확인'} · 종료 {latest.group.regional.policy.openEnded ? '무기한' : latest.group.regional.policy.endsAt ?? '미확인'}</p>
          <p className="text-muted-foreground">표에 없는 지역: {latest.group.regional.policy.unlistedDisposition === 'standard' ? '추가료 없음' : latest.group.regional.policy.unlistedDisposition === 'manual_review' ? '개별 확인 필요' : '미확인'} · 예외 지역 없음 확인: {latest.group.regional.policy.noRulesConfirmed ? '확인함' : '확인하지 않음'}</p>
          <p className="text-muted-foreground">{latest.group.regional.policy.sourceEvidence || '근거 미입력'}</p><pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre">{shippingRegionRulesTsv(latest.group.regional.policy.rules)}</pre></details> : null}
        <div className={ACTIONS}><Button disabled={locked} onClick={() => acceptLatest(true)} size="sm" type="button">내 입력 유지 · 최신 버전을 저장 기준으로</Button><Button disabled={locked} onClick={() => acceptLatest(false)} size="sm" type="button" variant="outline">최신 저장본 불러오기</Button></div>
      </div> : null}
      {otherPending ? <AdminNotice role="status" tone="neutral">다른 묶음그룹 요청의 결과를 먼저 확인해주세요.</AdminNotice> : null}
      {error || operation.error ? <AdminNotice role="alert" tone="danger">{error || operation.error}</AdminNotice> : null}
      {message || operation.message ? <AdminNotice role="status" tone="neutral">{message || operation.message}</AdminNotice> : null}
      {operation.context ? <div className={INFO_PANEL}><strong className="font-medium">같은 요청의 결과를 확인해주세요.</strong><p className="text-muted-foreground">새로고침 후에도 요청번호와 저장 기준만 남습니다. 입력 원문은 저장하지 않으며 원래 요청을 자동 재전송하지 않습니다.</p>
        <div className={ACTIONS}><Button disabled={operation.busy || reading} onClick={() => { void operation.recover(); }} type="button">저장 결과 확인</Button><Button disabled={operation.busy || reading || !canEdit} onClick={() => { void operation.recover(true); }} type="button" variant="outline">미처리 요청 종료</Button></div>
      </div> : null}
      <div className={`${ACTIONS} border-t pt-4`}><Button disabled={locked || needsRefresh || !canEdit} type="submit">{operation.busy ? '처리 중…' : base ? '새 버전 저장' : '묶음그룹 추가'}</Button>
        <Button disabled={locked} onClick={() => { void readLatest(); }} type="button" variant="outline">최신 저장 기준 확인</Button><Button disabled={locked} onClick={onClose} type="button" variant="ghost">취소</Button></div>
    </form>
  </CustomerServiceDialog>;
}

/** 묶음그룹 조회·목록·편집 작업 영역. 세션이 확인된 뒤 ShippingChargeGroupsPanel이 그린다(테스트는 직접 그린다). */
export function GroupsWorkspace({ identity, scope, origins, carriers, canEdit, canManageRegional }: {
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
      let request = next, result = await listShippingChargeGroupsAction(request, { expectedActorId, expectedSessionId });
      /* 보관·사용 안 함으로 마지막 페이지가 비면(같은 페이지를 다시 읽을 때) 마지막 유효 페이지를 다시 읽는다 —
         빈 페이지에 남으면 공용 페이지 이동은 범위 안으로 보정해 그리므로 돌아갈 '이전'이 없다. */
      if (!('error' in result) && alive.current && scope.canApply(ticket)) {
        const lastPage = Math.max(1, Math.ceil(result.data.total / result.data.pageSize));
        if (request.page > lastPage) { request = { ...request, page: lastPage }; result = await listShippingChargeGroupsAction(request, { expectedActorId, expectedSessionId }); }
      }
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setData(null); setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
      else { setData(result.data); setApplied(request); }
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
  /* 아직 묶음그룹이 하나도 없으면 조회 조건과 빈 표를 접어 한 줄로 둔다 — 채워야 할 출고지 설정이 첫 화면에서 밀리지 않게. */
  const noGroups = !busy && !error && data !== null && data.total === 0 && !applied.query && !applied.originId && applied.status === 'all';
  return <>
    {noGroups ? null : <form className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 rounded-xl border bg-card p-4 text-card-foreground sm:grid-cols-2 lg:grid-cols-[minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(14rem,2fr)]" onSubmit={event => { event.preventDefault(); if (!busy) void load({ ...filters, query: filters.query.trim(), page: 1 }); }}>
      <label className={FIELD_LABEL}>출고지<NativeSelect className="w-full" value={filters.originId ?? ''} disabled={busy} onChange={event => setFilters({ ...filters, originId: event.target.value || null })}><option value="">전체 출고지</option>{origins.map(origin => <option key={origin.id} value={origin.id}>{origin.name}{origin.active ? '' : ' · 비활성'}</option>)}</NativeSelect></label>
      <label className={FIELD_LABEL}>사용 상태<NativeSelect className="w-full" value={filters.status} disabled={busy} onChange={event => setFilters({ ...filters, status: event.target.value as ShippingChargeGroupFilters['status'] })}><option value="all">전체</option><option value="active">사용</option><option value="inactive">사용 안 함</option><option value="archived">보관</option></NativeSelect></label>
      <label className={`${FIELD_LABEL} sm:col-span-2 lg:col-span-1`}>배송비 묶음그룹명<Input value={filters.query} maxLength={100} disabled={busy} onChange={event => setFilters({ ...filters, query: event.target.value })} placeholder="묶음그룹 이름을 입력해주세요" /></label>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3 sm:col-span-2 lg:col-span-3"><Button disabled={busy} onClick={() => { const next = emptyFilters(); setFilters(next); void load(next); }} type="button" variant="ghost">초기화</Button><Button disabled={busy} type="submit" variant="soft"><Search aria-hidden="true" />검색</Button></div>
    </form>}
    {message ? <AdminNotice role="status" tone="neutral">{message}</AdminNotice> : null}
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
    {!editor && !assignment ? pending.map(context => <OperationRecovery key={context.operationId} context={context} identity={identity} scope={scope} canEdit={canEdit} onReceipt={receiptReceived} />) : null}
    <ConsoleListCard aria-busy={busy} data-charge-groups-results="" headingLevel={3} title="조회 결과" total={data?.total ?? null} unit="개"
      actions={canEdit ? <Button disabled={locked || !data} onClick={() => { if (!locked && data) { setMessage(''); setEditor({ id: crypto.randomUUID(), data: null, originId: applied.originId ?? '' }); } }} type="button"><Plus aria-hidden="true" />묶음그룹 추가</Button> : <span className="text-xs text-muted-foreground">읽기 전용</span>}>
      {busy ? <p className="text-sm text-muted-foreground" role="status">묶음그룹을 불러오고 있습니다.</p> : null}
      {noGroups ? <p className={NOTE}>등록한 배송비 묶음그룹이 없습니다. 기존 상품은 현재 배송비 규칙을 유지합니다.</p> : <><div aria-label="배송비 묶음그룹 목록 가로 스크롤" className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" tabIndex={0}><Table className="min-w-[46.25rem]"><caption className="sr-only">배송비 묶음그룹 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>그룹명</TableHead><TableHead>출고지</TableHead><TableHead>계산 방식</TableHead><TableHead>지역 추가료</TableHead><TableHead>배정 원상품</TableHead><TableHead>사용 상태</TableHead><TableHead>관리</TableHead><TableHead>버전·수정일</TableHead></TableRow></ConsoleTableHeader>
        <TableBody>{data?.groups.map(group => <TableRow key={group.id}><TableHead className="h-auto py-3 align-top whitespace-normal [overflow-wrap:anywhere]" scope="row">{group.name}{group.isDefault ? <small className="mt-1 block"><Badge variant="secondary">기본 그룹</Badge></small> : null}<small className={`mt-1 block ${FIELD_HINT}`}>그룹번호 {group.id}</small></TableHead>
          <TableCell className="align-top whitespace-normal">{origins.find(origin => origin.id === group.originId)?.name ?? '출고지 확인 필요'}</TableCell><TableCell className="align-top">{group.calculationMode === 'min' ? '최소 부과' : '최대 부과'}<small className={`mt-1 block ${FIELD_HINT}`}>유효 무료 조건 우선</small></TableCell>
          <TableCell className="align-top">{group.regional.mode === 'inherit' ? '출고지 정책 상속' : '그룹 지역표 1회'}{group.regional.mode === 'override' ? <small className={`mt-1 block ${FIELD_HINT}`}>{group.regional.policy.rules.length.toLocaleString('ko-KR')}개 주소 구간</small> : null}</TableCell>
          <TableCell className="align-top"><Button aria-label={`${group.name} 연결 원상품 ${group.assignedCount}개 조회`} className="tabular-nums" disabled={locked} onClick={() => { if (!locked) setAssignment(group); }} size="xs" type="button" variant="outline">{group.assignedCount.toLocaleString('ko-KR')}개</Button></TableCell><TableCell className="align-top"><AdminStatusBadge tone={statusTone('setting', group.archived ? 'archived' : group.enabled ? 'active' : 'inactive')}>{group.archived ? '보관' : group.enabled ? '사용' : '사용 안 함'}</AdminStatusBadge></TableCell>
          <TableCell className="align-top"><div className="flex flex-nowrap items-center gap-1.5"><Button disabled={locked} onClick={() => { void edit(group); }} size="xs" type="button" variant="outline">{canEdit ? '수정' : '조회'}</Button>
            {canEdit ? <Button disabled={locked} onClick={() => { if (!locked) setAssignment(group); }} size="xs" type="button" variant="outline">상품 배정</Button> : null}</div></TableCell><TableCell className="align-top tabular-nums">버전 {group.revision}<small className={`mt-1 block ${FIELD_HINT}`}>{formatOrderDateTime(group.updatedAt)}</small></TableCell></TableRow>)}</TableBody></Table>{!busy && data && !data.groups.length ? <p className={CONSOLE_LIST_EMPTY_CLASS}>{applied.query || applied.originId || applied.status !== 'all' ? '조회 조건에 맞는 묶음그룹이 없습니다.' : '등록한 배송비 묶음그룹이 없습니다. 기존 상품은 현재 배송비 규칙을 유지합니다.'}</p> : null}</div>
      <ConsolePagination label="배송비 묶음그룹 목록 페이지" page={data?.page ?? 1} pageSize={data?.pageSize ?? 20} total={data?.total ?? 0} disabled={busy || !data} onPageChange={page => { void load({ ...applied, page }); }} /></>}
    </ConsoleListCard>
    <p className={NOTE}>같은 주문·출고지의 배송비만 묶습니다. 전시 그룹상품·구매 합산군과 구분하며, 기본 그룹 변경으로 기존 상품을 자동 재배정하지 않습니다.</p>
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
  return <section id="shipping-charge-groups" className="flex min-w-0 scroll-mt-16 flex-col gap-4" aria-labelledby="shipping-charge-groups-title">
    <header className="flex flex-col gap-1"><h2 className="text-lg leading-tight font-semibold tracking-tight" id="shipping-charge-groups-title">배송비 묶음그룹 관리</h2><p className="text-sm text-muted-foreground">배송비를 함께 계산할 그룹과 최소·최대 부과, 무료 우선, 지역 추가료를 관리합니다.</p></header>
    {identity ? <GroupsWorkspace key={`${identity.expectedActorId}:${identity.expectedSessionId}`} identity={identity} scope={scope} origins={origins} carriers={carriers} canEdit={canEdit} canManageRegional={canManageRegional} />
      : <AdminNotice role={blocked ? 'alert' : 'status'} tone={blocked ? 'danger' : 'neutral'}>{blocked ? '로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.' : '현재 로그인과 묶음그룹 관리 권한을 확인하고 있습니다.'}</AdminNotice>}
  </section>;
}

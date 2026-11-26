'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getShippingChargeGroupAction, listShippingChargeGroupsAction } from '@/app/admin/shipping-charge-group-actions';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import {
  SHIPPING_CHARGE_GROUP_REGION_BLOCK_LABELS, SHIPPING_CHARGE_GROUP_RUNTIME_OFF, SHIPPING_CHARGE_GROUP_STOP_LABEL,
  shippingChargeGroupRegionBlock, type ShippingChargeGroup, type ShippingChargeGroupFilters, type ShippingChargeGroupIdentity, type ShippingChargeGroupListData,
  type ShippingChargeGroupOperationContext, type ShippingChargeGroupOperationReceipt, type ShippingChargeGroupOriginGuard, type ShippingChargeGroupSkipped,
} from '@/lib/admin/shipping-charge-groups';
import { formatOrderDateTime } from '@/lib/orders';
import { SHIPPING_CHARGE_GROUP_MODE_LABELS, SHIPPING_CHARGE_GROUP_REGION_LABELS } from '../ShippingChargeGroupField';
import {
  useShippingChargeGroupOperation, useShippingChargeGroupPending, useShippingChargeGroupSession, type ShippingChargeGroupFailure, type ShippingChargeGroupScope,
} from '../shipping-charge-groups/useShippingChargeGroupOperation';
import { ShippingChargeGroupAssignmentDialog, type ShippingChargeGroupAssignmentDone, type ShippingChargeGroupAssignmentTask } from '../shipping-charge-groups/ShippingChargeGroupAssignmentDialog';
import { ShippingChargeGroupEditor, shippingChargeGroupValuesOf, type ShippingChargeGroupEditorStart } from '../shipping-charge-groups/ShippingChargeGroupEditor';
import { Plus, Search } from 'lucide-react';
import { CONSOLE_LIST_EMPTY_CLASS, CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableHeader } from '@/components/admin/console/ConsoleListCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { statusTone } from '@/lib/admin/status-tone';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, FIELD_HINT, FIELD_LABEL, NOTE } from '@/components/admin/settings-kit';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';

const emptyFilters = (): ShippingChargeGroupFilters => ({ originId: null, query: '', status: 'all', page: 1 });
/** 저장·넣기·빼기 뒤 목록 위에 보이는 결과. 건너뛴 상품이 있으면 이유와 함께 남긴다. */
type Result = { text: string; skipped?: ShippingChargeGroupSkipped[] };

/** 저장·넣기·빼기를 누른 뒤 결과를 받지 못한 채 화면을 새로 연 경우. 적었던 내용은 남아 있지 않고, 됐는지 확인하거나 그만둘 수만 있다. */
function OperationRecovery({ context, name, identity, scope, canEdit, onReceipt }: {
  context: ShippingChargeGroupOperationContext; name: string | undefined; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope;
  canEdit: boolean; onReceipt: (receipt: ShippingChargeGroupOperationReceipt) => void;
}) {
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: context.groupId, command: context.command, onReceipt });
  const subject = name ? `‘${name}’ 묶음그룹` : '묶음그룹';
  return <AdminNotice role="alert" tone="warning">
    <p><strong className="font-medium">{context.command === 'save' ? `${subject}을 저장하던 중이었습니다.` : context.groupId ? `${subject}에 상품을 넣던 중이었습니다.` : '묶음그룹에서 상품을 빼던 중이었습니다.'}</strong> {SAVE_UNKNOWN_MESSAGE}</p>
    {operation.error ? <p className="mt-1 text-destructive">{operation.error}</p> : null}{operation.message ? <p className="mt-1">{operation.message}</p> : null}
    <div className={`${ACTIONS} mt-2`}><Button disabled={operation.busy} onClick={() => { void operation.recover(); }} size="sm" type="button">{SAVE_CHECK_LABEL}</Button>
      <Button disabled={operation.busy || !canEdit} onClick={() => { void operation.recover(true); }} size="sm" type="button" variant="outline">{SHIPPING_CHARGE_GROUP_STOP_LABEL}</Button></div>
  </AdminNotice>;
}

/**
 * 목록 줄의 [보관]·[복원]. 보관 상태만 바꿔 저장한다(이름·계산 방식·지역표는 그대로). 보관하면 '사용 안 함'이 되고 추천 표시가 빠진다.
 * 상품이 들어 있는 묶음그룹은 보관할 수 없어 버튼을 잠그고 까닭을 줄에 보인다(DB도 거절한다).
 * 서버가 이유를 들어 거절한 저장은 부른 쪽이 목록을 다시 읽고 목록 위에 알린다(`onFailure`). 그 밖에 보내기 전에 멈춘 경우
 * (이 브라우저에 진행 기록을 남길 수 없음·보낼 값의 형식이 맞지 않음)는 이 버튼 아래에 이유를 보인다 — 눌러도 아무 일도 없는 것처럼 보이지 않게 한다.
 * 보낼 값의 형식 검사는 보내는 쪽(`operation.send`)이 하고 같은 이유로 알린다.
 */
export function ShippingChargeGroupArchiveButton({ group, origin, identity, scope, disabled, onReceipt, onFailure }: {
  group: ShippingChargeGroup; origin: ShippingChargeGroupOriginGuard | undefined; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope;
  disabled: boolean; onReceipt: (receipt: ShippingChargeGroupOperationReceipt) => void; onFailure: (failure: ShippingChargeGroupFailure) => void;
}) {
  /* 부른 쪽이 이미 알린 거절 이유는 이 버튼 아래에 한 번 더 말하지 않는다. */
  const [reported, setReported] = useState('');
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: group.id, command: 'save', onReceipt, onFailure: failure => { setReported(failure.error); onFailure(failure); } });
  const blocked = disabled || operation.busy || Boolean(operation.context) || !origin || (!group.archived && group.assignedCount > 0);
  /* 결과를 모르는 경우(진행 기록이 남아 있다)는 목록 위 '저장하던 중이었습니다' 상자가 [저장됐는지 확인]과 함께 말한다. */
  const unsent = !operation.context && operation.error && operation.error !== reported ? operation.error : '';
  function toggle() {
    if (blocked || !origin) return;
    void operation.send({ operationId: crypto.randomUUID(), command: 'save', groupId: group.id, expectedRevision: group.revision, ...identity,
      originId: group.originId, originUpdatedAt: origin.updatedAt, expectedDefaultGroupId: origin.defaultGroupId, expectedDefaultGroupRevision: origin.defaultGroupRevision,
      values: { ...shippingChargeGroupValuesOf(group), archived: !group.archived, enabled: false, isDefault: false }, attestRegional: false });
  }
  return <span className="inline-flex flex-col items-start gap-1">
    <Button disabled={blocked} onClick={toggle} size="xs" type="button" variant="outline">{group.archived ? '복원' : '보관'}</Button>
    {unsent ? <small className="max-w-56 text-xs whitespace-normal text-destructive" data-charge-group-archive-error="" role="alert">{unsent}</small> : null}
  </span>;
}

/** 묶음그룹 조회·목록·편집 작업 영역. 세션이 확인된 뒤 ShippingChargeGroupsPanel이 그린다(테스트는 직접 그린다). */
export function GroupsWorkspace({ identity, scope, origins, carriers, canEdit, canManageRegional, defaultOriginId }: {
  identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope; origins: GoodsFulfillmentOrigin[]; carriers: EditableCarrier[];
  canEdit: boolean; canManageRegional: boolean;
  /** 위에서 열어 둔 출고지 탭의 출고지. [묶음그룹 추가]가 이 출고지로 시작한다(목록에서 출고지를 골라 둔 조건이 있으면 그쪽이 먼저다). */
  defaultOriginId?: string;
}) {
  const [filters, setFilters] = useState(emptyFilters), [applied, setApplied] = useState(emptyFilters);
  /* `readAt`은 목록을 읽은 시각이다. 지역표가 적용 기간 안인지 가리는 데 쓴다. */
  const [data, setData] = useState<ShippingChargeGroupListData | null>(null), [readAt, setReadAt] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [result, setResult] = useState<Result | null>(null);
  const [editor, setEditor] = useState<ShippingChargeGroupEditorStart | null>(null);
  const [assignment, setAssignment] = useState<{ group: ShippingChargeGroup; task: ShippingChargeGroupAssignmentTask } | null>(null);
  const pending = useShippingChargeGroupPending(identity), lane = useRef(false), alive = useRef(true);
  const { expectedActorId, expectedSessionId } = identity;
  const load = useCallback(async (next: ShippingChargeGroupFilters) => {
    const ticket = scope.capture(); if (!ticket || lane.current) return;
    lane.current = true; setBusy(true); setError('');
    try {
      let request = next, loaded = await listShippingChargeGroupsAction(request, { expectedActorId, expectedSessionId });
      /* 보관·사용 안 함으로 마지막 페이지가 비면(같은 페이지를 다시 읽을 때) 마지막 유효 페이지를 다시 읽는다 —
         빈 페이지에 남으면 공용 페이지 이동은 범위 안으로 보정해 그리므로 돌아갈 '이전'이 없다. */
      if (!('error' in loaded) && alive.current && scope.canApply(ticket)) {
        const lastPage = Math.max(1, Math.ceil(loaded.data.total / loaded.data.pageSize));
        if (request.page > lastPage) { request = { ...request, page: lastPage }; loaded = await listShippingChargeGroupsAction(request, { expectedActorId, expectedSessionId }); }
      }
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in loaded) { setData(null); setError(loaded.error); if (loaded.authChanged) scope.authenticate(null, null); }
      else { setData(loaded.data); setReadAt(Date.now()); setApplied(request); }
    } catch { if (alive.current && scope.canApply(ticket)) { setData(null); setError('배송비 묶음그룹을 불러오지 못했습니다. [검색]을 다시 눌러 주세요.'); } }
    finally { lane.current = false; if (alive.current && scope.canApply(ticket)) setBusy(false); }
  }, [scope, expectedActorId, expectedSessionId]);
  useEffect(() => { alive.current = true; const task = setTimeout(() => { void load(emptyFilters()); }, 0); return () => { clearTimeout(task); alive.current = false; }; }, [load]);
  /*
   * 위에서 출고지의 기본 택배사·사용 여부를 저장하면 화면이 새 출고지를 내려 준다. 지역표의 택배사가 출고지의 기본 택배사와 달라진 묶음그룹은
   * 줄에 '새 주문이 막혀 있습니다'가 떠야 하므로 그때 목록을 다시 읽는다(처음 읽을 때는 읽지 않는다).
   */
  const originsKey = origins.map(origin => `${origin.id}:${origin.defaultCarrier ?? ''}:${origin.active ? 1 : 0}`).join('|');
  const seenOrigins = useRef(originsKey);
  useEffect(() => {
    if (seenOrigins.current === originsKey) return;
    seenOrigins.current = originsKey;
    void load(applied);
  }, [originsKey, applied, load]);
  async function edit(group: ShippingChargeGroup) {
    const ticket = scope.capture(); if (!ticket || busy || lane.current || pending.length) return;
    lane.current = true; setBusy(true); setError('');
    try {
      const loaded = await getShippingChargeGroupAction(group.id, identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in loaded) { setError(loaded.error); if (loaded.authChanged) scope.authenticate(null, null); }
      else { setResult(null); setEditor({ id: group.id, data: loaded.data, originId: loaded.data.origin.id }); }
    } catch { if (alive.current && scope.canApply(ticket)) setError('묶음그룹을 불러오지 못했습니다. 잠시 뒤 [수정]을 다시 눌러 주세요.'); }
    finally { lane.current = false; if (alive.current && scope.canApply(ticket)) setBusy(false); }
  }
  /** 저장·보관·복원·넣기·빼기가 끝났다. `done`은 방금 이 화면에서 한 일(없으면 새로고침 뒤 [저장됐는지 확인]으로 알게 된 결과)이다. */
  function receiptReceived(receipt: ShippingChargeGroupOperationReceipt, done?: ShippingChargeGroupAssignmentDone | 'archived' | 'restored') {
    setEditor(null); setAssignment(null);
    const count = receipt.appliedCount.toLocaleString('ko-KR'), name = receipt.group?.name;
    setResult(receipt.state === 'sealed' ? { text: '그만뒀습니다. 아무것도 바뀌지 않았습니다. 지금 저장된 내용을 확인한 뒤 다시 해 주세요.' }
      : receipt.state === 'saved' ? { text: done === 'archived' ? `‘${name}’ 묶음그룹을 보관했습니다. 이제 묶음그룹 고르기 창에 나오지 않습니다. 되살리려면 사용 여부가 ‘보관’인 그 줄의 [복원]을 눌러 주세요.`
        : done === 'restored' ? `‘${name}’ 묶음그룹을 복원했습니다. 지금은 ‘사용 안 함’입니다. 쓰려면 [수정]에서 ‘사용’으로 바꿔 주세요.` : `‘${name}’ 묶음그룹을 저장했습니다.` }
        : typeof done === 'object' ? { skipped: done.skipped, text: done.action === 'remove' ? `상품 ${count}개를 ‘${done.groupName}’ 묶음그룹에서 뺐습니다.`
          : done.action === 'move' ? `상품 ${count}개를 ‘${done.groupName}’ 묶음그룹으로 옮겼습니다.` : `상품 ${count}개를 ‘${done.groupName}’ 묶음그룹에 넣었습니다.` }
          : { text: name ? `상품 ${count}개가 ‘${name}’ 묶음그룹에 들어가 있습니다.` : `상품 ${count}개가 묶음그룹에서 빠져 있습니다.` });
    void load(applied);
  }
  const locked = busy || Boolean(pending.length);
  const runtimeOff = data !== null && !data.runtimeEnabled;
  const originName = (id: string) => origins.find(origin => origin.id === id)?.name;
  /* [상품 넣기]를 누를 수 없는 까닭(없으면 null). 못 누르는 버튼을 까닭 없이 흐리게만 두지 않는다(화면 규칙 5). */
  const addBlocked = (group: ShippingChargeGroup, guard: ShippingChargeGroupOriginGuard | undefined): string | null => group.archived ? null
    : !group.enabled ? "'사용'으로 바꿔야 상품을 넣을 수 있습니다" : guard && !guard.isActive ? "출고지가 '사용 안 함'이라 상품을 넣을 수 없습니다" : null;
  /* 지역표를 쓰는 '사용' 묶음그룹이 지금 주문에 쓰이지 않으면 그 상품의 주문이 막힌다. 문제가 있을 때만 줄에 알린다. */
  const regionWarning = (group: ShippingChargeGroup, guard: ShippingChargeGroupOriginGuard | undefined): string | null => {
    if (group.regional.mode !== 'override' || !group.enabled || group.archived || !readAt) return null;
    const block = shippingChargeGroupRegionBlock(group.regional.policy, guard, carriers.find(carrier => carrier.code === group.regional.policy?.carrierCode)?.active, readAt);
    return block ? `${SHIPPING_CHARGE_GROUP_REGION_BLOCK_LABELS[block]} 이 묶음그룹 상품의 새 주문이 막혀 있습니다. [수정]에서 고쳐 주세요.` : null;
  };
  /* 아직 묶음그룹이 하나도 없으면 조회 조건과 빈 표를 접어 한 줄로 둔다 — 채워야 할 출고지 설정이 첫 화면에서 밀리지 않게. */
  const noGroups = !busy && !error && data !== null && data.total === 0 && !applied.query && !applied.originId && applied.status === 'all';
  return <>
    {noGroups ? null : <form className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 rounded-xl border bg-card p-4 text-card-foreground sm:grid-cols-2 lg:grid-cols-[minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(14rem,2fr)]" onSubmit={event => { event.preventDefault(); if (!busy) void load({ ...filters, query: filters.query.trim(), page: 1 }); }}>
      <label className={FIELD_LABEL}>출고지<NativeSelect className="w-full" value={filters.originId ?? ''} disabled={busy} onChange={event => setFilters({ ...filters, originId: event.target.value || null })}><option value="">전체 출고지</option>{origins.map(origin => <option key={origin.id} value={origin.id}>{origin.name}{origin.active ? '' : ' · 사용 안 함'}</option>)}</NativeSelect></label>
      <label className={FIELD_LABEL}>사용 여부<NativeSelect className="w-full" value={filters.status} disabled={busy} onChange={event => setFilters({ ...filters, status: event.target.value as ShippingChargeGroupFilters['status'] })}><option value="all">전체</option><option value="active">사용</option><option value="inactive">사용 안 함</option><option value="archived">보관</option></NativeSelect></label>
      <label className={`${FIELD_LABEL} sm:col-span-2 lg:col-span-1`}>묶음그룹 이름<Input value={filters.query} maxLength={100} disabled={busy} onChange={event => setFilters({ ...filters, query: event.target.value })} /></label>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3 sm:col-span-2 lg:col-span-3"><Button disabled={busy} onClick={() => { const next = emptyFilters(); setFilters(next); void load(next); }} type="button" variant="ghost">초기화</Button><Button disabled={busy} type="submit" variant="soft"><Search aria-hidden="true" />검색</Button></div>
    </form>}
    {runtimeOff ? <AdminNotice role="status" tone="warning"><p data-charge-groups-runtime-off="">{SHIPPING_CHARGE_GROUP_RUNTIME_OFF}</p></AdminNotice> : null}
    {result ? <div className="flex min-w-0 flex-col gap-1.5 text-sm" data-charge-groups-result="" role="status">
      <p>{result.text}</p>
      {result.skipped?.length ? <div data-charge-groups-skipped=""><p>건너뛴 상품 {result.skipped.length}개</p>
        <ul className="m-0 list-disc pl-5 text-muted-foreground">{result.skipped.map(item => <li key={item.id}>{item.name} — {item.reason}.</li>)}</ul></div> : null}
    </div> : null}
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
    {!editor && !assignment ? pending.map(context => <OperationRecovery key={context.operationId} context={context} name={data?.groups.find(group => group.id === context.groupId)?.name}
      identity={identity} scope={scope} canEdit={canEdit} onReceipt={receiptReceived} />) : null}
    <ConsoleListCard aria-busy={busy} data-charge-groups-results="" headingLevel={3} title="배송비 묶음그룹" total={data?.total ?? null} unit="개"
      actions={canEdit ? <Button disabled={locked || !data} onClick={() => { if (!locked && data) { setResult(null); setEditor({ id: crypto.randomUUID(), data: null, originId: applied.originId ?? (origins.some(origin => origin.id === defaultOriginId && origin.active) ? defaultOriginId! : '') }); } }} type="button"><Plus aria-hidden="true" />묶음그룹 추가</Button>
        : <span className="text-xs text-muted-foreground">상품 관리 권한이 있어야 바꿀 수 있습니다.</span>}>
      {busy ? <p className="text-sm text-muted-foreground" role="status">묶음그룹을 불러오고 있습니다.</p> : null}
      {noGroups ? <p className={NOTE}>만든 묶음그룹이 없습니다.{canEdit ? ' [묶음그룹 추가]로 만들어 주세요.' : ''}</p> : <><div aria-label="배송비 묶음그룹 목록 가로 스크롤" className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" tabIndex={0}><Table className="min-w-[52rem]"><caption className="sr-only">배송비 묶음그룹 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>묶음그룹 이름</TableHead><TableHead>출고지</TableHead><TableHead>배송비 계산</TableHead><TableHead>지역별 추가배송비</TableHead><TableHead>상품</TableHead><TableHead>사용 여부</TableHead><TableHead>수정일</TableHead><TableHead>관리</TableHead></TableRow></ConsoleTableHeader>
        <TableBody>{data?.groups.map(group => {
          const guard = data.origins.find(origin => origin.id === group.originId), reason = addBlocked(group, guard), warning = regionWarning(group, guard);
          return <TableRow key={group.id}><TableHead className="h-auto py-3 align-top whitespace-normal [overflow-wrap:anywhere]" scope="row">{group.name}{group.isDefault ? <small className="mt-1 block"><Badge variant="secondary">추천</Badge></small> : null}</TableHead>
            <TableCell className="align-top whitespace-normal">{originName(group.originId) ?? guard?.name ?? '출고지 확인 필요'}</TableCell><TableCell className="align-top">{SHIPPING_CHARGE_GROUP_MODE_LABELS[group.calculationMode]}</TableCell>
            <TableCell className="align-top whitespace-normal">{SHIPPING_CHARGE_GROUP_REGION_LABELS[group.regional.mode]}{group.regional.mode === 'override' ? <small className={`mt-1 block ${FIELD_HINT}`}>{group.regional.policy.rules.length ? `지역표 ${group.regional.policy.rules.length.toLocaleString('ko-KR')}줄` : '받는 지역 없음'}</small> : null}
              {warning ? <small className="mt-1 block max-w-60 text-xs text-destructive" data-charge-group-region-warning="">{warning}</small> : null}</TableCell>
            <TableCell className="align-top tabular-nums">{group.assignedCount > 0 ? <Button aria-label={`${group.name} 묶음그룹에 넣은 상품 ${group.assignedCount}개 보기`} className="tabular-nums" disabled={locked} onClick={() => { if (!locked) { setResult(null); setAssignment({ group, task: 'manage' }); } }} size="xs" type="button" variant="outline">{group.assignedCount.toLocaleString('ko-KR')}개</Button> : '0개'}</TableCell>
            <TableCell className="align-top"><AdminStatusBadge tone={statusTone('setting', group.archived ? 'archived' : group.enabled ? 'active' : 'inactive')}>{group.archived ? '보관' : group.enabled ? '사용' : '사용 안 함'}</AdminStatusBadge></TableCell>
            <TableCell className="align-top tabular-nums">{formatOrderDateTime(group.updatedAt)}</TableCell>
            <TableCell className="align-top whitespace-normal"><div className="flex flex-nowrap items-start gap-1.5"><Button disabled={locked} onClick={() => { void edit(group); }} size="xs" type="button" variant="outline">{canEdit ? '수정' : '보기'}</Button>
              {canEdit && !group.archived ? <Button disabled={locked || runtimeOff || Boolean(reason)} onClick={() => { if (!locked && !runtimeOff && !reason) { setResult(null); setAssignment({ group, task: 'add' }); } }} size="xs" type="button" variant="outline">상품 넣기</Button> : null}
              {canEdit ? <ShippingChargeGroupArchiveButton group={group} origin={guard} identity={identity} scope={scope} disabled={locked}
                onReceipt={receipt => receiptReceived(receipt, group.archived ? 'restored' : 'archived')} onFailure={failure => { void load(applied).then(() => { if (alive.current) setError(failure.error); }); }} /> : null}</div>
              {canEdit && reason ? <small className={`mt-1 block max-w-56 ${FIELD_HINT}`} data-charge-group-add-blocked="">{reason}</small> : null}
              {canEdit && !group.archived && group.assignedCount > 0 ? <small className={`mt-1 block max-w-56 ${FIELD_HINT}`} data-charge-group-archive-blocked="">상품을 모두 빼야 보관할 수 있습니다</small> : null}</TableCell></TableRow>;
        })}</TableBody></Table>{!busy && data && !data.groups.length ? <p className={CONSOLE_LIST_EMPTY_CLASS}>조건에 맞는 묶음그룹이 없습니다.</p> : null}</div>
      <ConsolePagination label="배송비 묶음그룹 목록 페이지" page={data?.page ?? 1} pageSize={data?.pageSize ?? 20} total={data?.total ?? 0} disabled={busy || !data} onPageChange={page => { void load({ ...applied, page }); }} /></>}
    </ConsoleListCard>
    {editor && data ? <ShippingChargeGroupEditor key={`${identity.expectedActorId}:${identity.expectedSessionId}:${editor.id}`} start={editor} identity={identity} scope={scope} origins={origins} carriers={carriers}
      canEdit={canEdit} canManageRegional={canManageRegional} initialList={data} otherPending={pending.some(context => context.groupId !== editor.id || context.command !== 'save')}
      onClose={refresh => { setEditor(null); if (refresh) void load(applied); }} onSaved={receipt => receiptReceived(receipt)} /> : null}
    {assignment ? <ShippingChargeGroupAssignmentDialog key={`${identity.expectedActorId}:${identity.expectedSessionId}:${assignment.group.id}:${assignment.task}`} group={assignment.group} task={assignment.task}
      identity={identity} scope={scope} canEdit={canEdit} runtimeEnabled={!runtimeOff} onClose={() => setAssignment(null)} onApplied={receiptReceived} /> : null}
  </>;
}

export function ShippingChargeGroupsPanel({ accountId, origins, carriers, canEdit, canManageRegional, defaultOriginId }: {
  accountId: string; origins: GoodsFulfillmentOrigin[]; carriers: EditableCarrier[]; canEdit: boolean; canManageRegional: boolean; defaultOriginId?: string;
}) {
  const { identity, scope, blocked } = useShippingChargeGroupSession(accountId);
  return <section id="shipping-charge-groups" className="flex min-w-0 scroll-mt-16 flex-col gap-4" aria-labelledby="shipping-charge-groups-title">
    <header className="flex flex-col gap-1"><h2 className="text-lg leading-tight font-semibold tracking-tight" id="shipping-charge-groups-title">배송비 묶음그룹 관리</h2><p className="text-sm text-muted-foreground">함께 주문하면 배송비를 한 번만 받을 상품을 묶습니다.</p></header>
    {identity ? <GroupsWorkspace key={`${identity.expectedActorId}:${identity.expectedSessionId}`} identity={identity} scope={scope} origins={origins} carriers={carriers} canEdit={canEdit} canManageRegional={canManageRegional} defaultOriginId={defaultOriginId} />
      : <AdminNotice role={blocked ? 'alert' : 'status'} tone={blocked ? 'danger' : 'neutral'}>{blocked ? '로그인 계정이 바뀌었거나 로그인이 끊겼습니다. 지금 로그인한 계정으로 이 화면을 새로고침해 주세요.' : '로그인 상태를 확인하고 있습니다.'}</AdminNotice>}
  </section>;
}

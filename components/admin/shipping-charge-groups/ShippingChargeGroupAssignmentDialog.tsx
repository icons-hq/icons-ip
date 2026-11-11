'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { findShippingChargeGroupGoodsAction, previewShippingChargeGroupAssignmentAction } from '@/app/admin/shipping-charge-group-actions';
import {
  SHIPPING_CHARGE_GROUP_GOOD_LIMIT, parseShippingChargeGroupAssignRequest, shippingChargeGroupGoodGuard,
  type ShippingChargeGroup, type ShippingChargeGroupAssignmentPreview, type ShippingChargeGroupAssignRequest,
  type ShippingChargeGroupBlocker, type ShippingChargeGroupGood, type ShippingChargeGroupGoodsData, type ShippingChargeGroupGoodsFilters,
  type ShippingChargeGroupIdentity, type ShippingChargeGroupOperationReceipt,
} from '@/lib/admin/shipping-charge-groups';
import { ShippingChargeGroupField, ShippingChargeGroupSummary } from '../ShippingChargeGroupField';
import { CustomerServiceDialog } from '../screens/CustomerServiceDialog';
import { useShippingChargeGroupOperation, useShippingChargeGroupPending, type ShippingChargeGroupScope } from './useShippingChargeGroupOperation';
import { Search, X } from 'lucide-react';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, FIELD_HINT, FIELD_LABEL, INFO_PANEL, NOTE, TABLE_SCROLL } from '@/components/admin/settings-kit';
import { AdminNotice } from '@/components/admin/console/AdminKit';

const blockerText: Record<ShippingChargeGroupBlocker, string> = {
  goods_aggregation_policy_owned_by_source: '합산군 원상품에서 배정을 관리합니다.',
  checkout_contract_upgrade_required: '현재 상품 거래 경로에서 그룹 배정을 변경할 수 없습니다.',
  shipping_charge_group_unavailable: '사용할 수 없는 묶음그룹입니다.',
  shipping_charge_group_origin_mismatch: '상품과 묶음그룹의 출고지가 다릅니다.',
  shipping_charge_group_origin_unavailable: '출고지를 사용할 수 없습니다.',
  collect_contract_not_ready: '출고지의 착불 수납 조건이 준비되지 않았습니다.',
};
const clearableBlockers = new Set<ShippingChargeGroupBlocker>(['shipping_charge_group_origin_unavailable', 'collect_contract_not_ready',
  'shipping_charge_group_unavailable', 'shipping_charge_group_origin_mismatch']);

export function ShippingChargeGroupAssignmentDialog({ group, identity, scope, canEdit, onClose, onApplied }: {
  group: ShippingChargeGroup; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope; canEdit: boolean;
  onClose: () => void; onApplied: (receipt: ShippingChargeGroupOperationReceipt) => void;
}) {
  const initialFilters = (): ShippingChargeGroupGoodsFilters => ({ originId: group.originId, groupId: group.id, query: '', page: 1 });
  const [query, setQuery] = useState(''), [onlyAssigned, setOnlyAssigned] = useState(true), [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [rows, setRows] = useState<ShippingChargeGroupGoodsData | null>(null), [selected, setSelected] = useState<ShippingChargeGroupGood[]>([]);
  const [mode, setMode] = useState<'' | 'set' | 'clear'>(''), [target, setTarget] = useState<ShippingChargeGroup | null>(null);
  const [preview, setPreview] = useState<ShippingChargeGroupAssignmentPreview | null>(null), [input, setInput] = useState<ShippingChargeGroupAssignRequest | null>(null);
  const [reading, setReading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const alive = useRef(true), requesting = useRef(false);
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: mode === 'set' ? target?.id ?? null : null,
    command: 'assign', onReceipt: receipt => {
      if (receipt.state === 'assigned') onApplied(receipt);
      else if (receipt.state === 'sealed') { setPreview(null); setInput(null); setMessage('미처리 요청을 종료했습니다. 선택한 상품은 유지되며, 최신 미리보기를 다시 확인해야 적용할 수 있습니다.'); }
    } });
  const pending = useShippingChargeGroupPending(identity);
  const otherPending = pending.some(item => item.operationId !== operation.context?.operationId);
  const locked = reading || operation.busy || Boolean(operation.context) || otherPending;
  const { expectedActorId, expectedSessionId } = identity;
  useEffect(() => {
    alive.current = true; const ticket = scope.capture(); requesting.current = true;
    if (ticket) void findShippingChargeGroupGoodsAction({ originId: group.originId, groupId: group.id, query: '', page: 1 }, { expectedActorId, expectedSessionId })
      .then(result => {
        if (!alive.current || !scope.canApply(ticket)) return;
        if ('data' in result) setRows(result.data); else { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
      }).catch(() => { if (alive.current && scope.canApply(ticket)) setError('연결 상품을 불러오지 못했습니다. 다시 조회해주세요.'); })
      .finally(() => { requesting.current = false; if (alive.current && scope.canApply(ticket)) setReading(false); });
    return () => { alive.current = false; };
  }, [scope, expectedActorId, expectedSessionId, group.id, group.originId]);
  // Clearing an existing assignment must remain available when the origin or collector is no longer ready.
  // The fresh target-specific preview remains the authority for whether the whole change can be applied.
  const selectable = (good: ShippingChargeGroupGood) => good.editable && good.id === good.ownerGoodId && good.originId === group.originId
    && (good.blocker === null || mode === 'clear' && clearableBlockers.has(good.blocker));
  const targetReady = mode === 'clear' || mode === 'set' && target?.enabled && !target.archived && target.originId === group.originId;
  function begin() {
    const ticket = scope.capture(); if (!ticket || locked || requesting.current) return null;
    requesting.current = true; setReading(true); setError(''); setMessage(''); return ticket;
  }
  async function search(filters: ShippingChargeGroupGoodsFilters) {
    const ticket = begin(); if (!ticket) return;
    setPreview(null); setInput(null);
    try {
      const result = await findShippingChargeGroupGoodsAction(filters, identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('data' in result) { setRows(result.data); setAppliedFilters(filters); }
      else { setRows(null); setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
    } catch { if (alive.current && scope.canApply(ticket)) { setRows(null); setError('상품을 불러오지 못했습니다. 조회 조건과 선택한 상품은 유지됩니다.'); } }
    finally { requesting.current = false; if (alive.current && scope.canApply(ticket)) setReading(false); }
  }
  function toggle(good: ShippingChargeGroupGood) {
    if (locked || !canEdit) return;
    if (selected.some(item => item.id === good.id)) setSelected(items => items.filter(item => item.id !== good.id));
    else if (!selectable(good)) return;
    else if (selected.length < SHIPPING_CHARGE_GROUP_GOOD_LIMIT) setSelected(items => [...items, good]);
    else { setError(`한 번에 최대 ${SHIPPING_CHARGE_GROUP_GOOD_LIMIT}개 원상품을 선택할 수 있습니다.`); return; }
    setPreview(null); setInput(null); setMessage('');
  }
  async function buildPreview() {
    if (!canEdit || !selected.length || selected.length > SHIPPING_CHARGE_GROUP_GOOD_LIMIT || !targetReady) return;
    const ticket = begin(); if (!ticket) return;
    setPreview(null); setInput(null);
    const destination = mode === 'set' ? target!.id : null;
    try {
      const result = await previewShippingChargeGroupAssignmentAction(destination, selected.map(good => good.id), identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return; }
      const value = result.data;
      if (value.actorId !== expectedActorId || value.sessionId !== expectedSessionId || (value.group?.id ?? null) !== destination
        || value.goods.length !== selected.length || value.goods.some(good => !selected.some(item => item.id === good.id))) {
        setError('현재 선택과 다른 미리보기입니다. 상품과 대상 그룹을 다시 확인해주세요.'); return;
      }
      setPreview(value);
      if (!value.canAssign || value.goods.some(good => !selectable(good)) || value.origins.some(origin => origin.id !== group.originId)) return;
      const request = parseShippingChargeGroupAssignRequest({ ...identity, operationId: crypto.randomUUID(), command: 'assign', groupId: destination,
        expectedRevision: value.group?.revision ?? 0, origins: value.origins, goods: value.goods.map(shippingChargeGroupGoodGuard) });
      if (request) setInput(request); else setError('미리보기의 저장 기준을 확인하지 못했습니다. 전체 적용을 중단했습니다.');
    } catch { if (alive.current && scope.canApply(ticket)) setError('배정 미리보기를 불러오지 못했습니다. 선택은 유지됩니다.'); }
    finally { requesting.current = false; if (alive.current && scope.canApply(ticket)) setReading(false); }
  }
  function apply() {
    if (locked || !canEdit || !preview?.canAssign || !input || preview.goods.some(good => !selectable(good))) return;
    void operation.send(input);
  }
  const close = () => { if (!locked) onClose(); };
  return <CustomerServiceDialog title={preview ? '배송비 묶음그룹 배정 미리보기' : '배송비 묶음그룹 연결 상품·배정'} onClose={close} busy={locked} wide>
    <div className="flex min-w-0 flex-col gap-4" data-charge-group-assignment="">
      <p><strong className="font-medium">{group.name}</strong> · 현재 연결 원상품 {group.assignedCount.toLocaleString('ko-KR')}개</p>
      <p className={NOTE}>이 그룹과 같은 출고지의 상품만 조회합니다. 합산군 자식은 원상품 배정을 공유하며, 원상품이나 다른 상품을 자동으로 선택하지 않습니다.</p>
      {!preview ? <>
        <form className="grid min-w-0 grid-cols-1 items-end gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,2fr)_auto]" onSubmit={event => { event.preventDefault(); void search({ originId: group.originId, groupId: onlyAssigned ? group.id : null, query: query.trim(), page: 1 }); }}>
          <label className={FIELD_LABEL}>조회 범위<NativeSelect className="w-full" value={onlyAssigned ? 'assigned' : 'all'} disabled={locked} onChange={event => setOnlyAssigned(event.target.value === 'assigned')}><option value="assigned">현재 그룹에 연결된 상품</option><option value="all">같은 출고지의 전체 상품</option></NativeSelect></label>
          <label className={FIELD_LABEL}>상품명·상품코드·상품번호<Input value={query} maxLength={100} disabled={locked} onChange={event => setQuery(event.target.value)} /></label>
          <Button disabled={locked} type="submit" variant="soft"><Search aria-hidden="true" />상품 조회</Button>
        </form>
        <p className={NOTE}>선택 {selected.length}개 / 최대 {SHIPPING_CHARGE_GROUP_GOOD_LIMIT}개 · 조회 {rows?.total.toLocaleString('ko-KR') ?? '—'}개 · 선택은 조회 범위를 바꾸어도 유지됩니다.</p>
        {selected.length ? <div className="flex max-h-30 flex-wrap gap-1.5 overflow-auto">{selected.map(good => <Button key={good.id} aria-label={`${good.name} 선택 해제`} disabled={locked || !canEdit} onClick={() => toggle(good)} size="xs" type="button" variant="outline">{good.name}<X aria-hidden="true" /></Button>)}</div> : null}
        <div className={TABLE_SCROLL}><Table className="min-w-[40rem]"><caption className="sr-only">배송비 묶음그룹 배정 상품 조회 결과</caption><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>선택</TableHead><TableHead>상품명·상품코드</TableHead><TableHead>현재 묶음그룹</TableHead><TableHead>공유·선택 조건</TableHead></TableRow></TableHeader><TableBody>{rows?.goods.map(good => <TableRow key={good.id}>
          <TableCell className="align-top"><input type="checkbox" checked={selected.some(item => item.id === good.id)} disabled={locked || !canEdit || !selectable(good)} aria-label={`${good.name} 선택`} onChange={() => toggle(good)} /></TableCell>
          <TableHead className="h-auto py-3 align-top whitespace-normal [overflow-wrap:anywhere]" scope="row">{good.name}<small className={`mt-1 block ${FIELD_HINT}`}>{good.code ?? '상품코드 미입력'} · {good.id}</small></TableHead>
          <TableCell className="align-top whitespace-normal">{good.groupId === null ? '미지정' : good.groupId === group.id ? group.name : '다른 묶음그룹'}{good.groupId ? <small className={`mt-1 block ${FIELD_HINT}`}>{good.groupId} · 버전 {good.groupRevision}</small> : null}</TableCell>
          <TableCell className="align-top whitespace-normal">{good.effectiveCount > 1 ? <small className={`block ${FIELD_HINT}`}>합산군 {good.effectiveCount}개 상품이 배정을 공유합니다.</small> : <small className={`block ${FIELD_HINT}`}>개별 원상품</small>}
            {good.blocker ? <small className="mt-1 block text-xs text-destructive">{blockerText[good.blocker]}{mode === 'clear' && good.editable && clearableBlockers.has(good.blocker) ? ' 배정 해제 가능 여부는 미리보기에서 확인합니다.' : ''}</small> : null}{good.ownerGoodId !== good.id ? <Link className="mt-1 inline-block text-xs font-medium underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.ownerGoodId)}`}>원상품 확인</Link> : null}</TableCell>
        </TableRow>)}</TableBody></Table>{!reading && rows?.total === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">조회 조건에 맞는 상품이 없습니다.</p> : null}</div>
        <ConsolePagination label="묶음그룹 배정 상품 페이지" page={rows?.page ?? 1} pageSize={rows?.pageSize ?? 20} total={rows?.total ?? 0} unit="개" disabled={locked || !rows} onPageChange={page => { void search({ ...appliedFilters, page }); }} />
        {canEdit ? <div className={INFO_PANEL}><label className={FIELD_LABEL}>선택 상품의 배정 변경<NativeSelect className="w-full" value={mode} disabled={locked} onChange={event => { setMode(event.target.value as typeof mode); setPreview(null); setInput(null); setMessage(''); }}>
          <option value="">배정 변경을 선택해주세요</option><option value="set">선택한 묶음그룹으로 지정·이동</option><option value="clear">묶음그룹 배정 해제</option></NativeSelect></label>
          {mode === 'set' ? <ShippingChargeGroupField identity={identity} originId={group.originId} value={target?.id ?? null} selectedGroup={target} disabled={locked}
            onChange={(_id, next) => { if (!locked) { setTarget(next); setPreview(null); setInput(null); } }} /> : mode === 'clear' ? <p className="text-muted-foreground">선택한 원상품과 그 합산군의 그룹 배정을 해제합니다. 기존 상품·출고지의 배송비 규칙으로 계산하며 무료배송으로 바꾸지 않습니다.</p> : null}
        </div> : <p className={NOTE}>상품 배정은 읽기 전용입니다.</p>}
      </> : <>
        <div className={INFO_PANEL}><strong className="font-medium">{preview.group ? '배정할 묶음그룹' : '묶음그룹 배정 해제'}</strong><ShippingChargeGroupSummary group={preview.group} />
          <p className="text-muted-foreground">선택한 원상품 {preview.goods.length}개에 적용합니다. 원상품의 합산군 전체가 배정을 공유하며, 기존 주문에 확정된 배송비는 유지합니다.</p>
          <p className="text-muted-foreground">미리보기 뒤 상품·원상품·합산군 구성·배송 정책·출고지·현재 배정 또는 대상 그룹 버전이 바뀌면 전체 적용을 중단합니다.</p></div>
        <div className={TABLE_SCROLL}><Table className="min-w-[40rem]"><caption className="sr-only">배송비 묶음그룹 배정 변경 전후</caption><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>원상품·공유 범위</TableHead><TableHead>현재 배정</TableHead><TableHead>변경 후 배정</TableHead></TableRow></TableHeader><TableBody>{preview.goods.map(good => <TableRow className="hover:bg-transparent" key={good.id}>
          <TableHead className="h-auto py-3 align-top whitespace-normal [overflow-wrap:anywhere]" scope="row">{good.name}<small className={`mt-1 block ${FIELD_HINT}`}>{good.code ?? good.id} · 합산군 {good.effectiveCount}개</small>{good.blocker ? <small className="mt-1 block text-xs font-normal text-destructive">{blockerText[good.blocker]}</small> : null}</TableHead>
          <TableCell className="align-top whitespace-normal"><ShippingChargeGroupSummary group={good.beforeGroup} /></TableCell><TableCell className="align-top whitespace-normal"><ShippingChargeGroupSummary group={good.afterGroup} /></TableCell>
        </TableRow>)}</TableBody></Table></div>
        {!preview.canAssign || !input ? <AdminNotice role="alert" tone="danger">적용할 수 없는 상품이나 저장 기준이 있어 전체 적용을 중단했습니다. 조건을 확인한 뒤 다시 선택해주세요.</AdminNotice> : null}
      </>}
      {reading || operation.busy ? <p className="text-sm text-muted-foreground" role="status">처리 중입니다.</p> : null}
      {otherPending ? <AdminNotice role="alert" tone="danger">다른 묶음그룹 요청의 결과를 먼저 확인해주세요. 이 창을 닫고 목록에서 원래 요청을 확인할 수 있습니다.</AdminNotice> : null}
      {error || operation.error ? <AdminNotice role="alert" tone="danger">{error || operation.error}</AdminNotice> : null}
      {message || operation.message ? <AdminNotice role="status" tone="neutral">{message || operation.message}</AdminNotice> : null}
      {operation.context ? <div className={INFO_PANEL}><strong className="font-medium">같은 요청의 배정 결과를 확인해주세요.</strong><p className="text-muted-foreground">상품 목록과 지역 설정 원문을 보관하거나 재전송하지 않습니다. 저장 결과가 없으면 미처리 요청을 종료하고 새 미리보기를 만드세요.</p>
        <div className={ACTIONS}><Button disabled={reading || operation.busy} onClick={() => { void operation.recover(); }} type="button">저장 결과 확인</Button><Button disabled={reading || operation.busy || !canEdit} onClick={() => { void operation.recover(true); }} type="button" variant="outline">미처리 요청 종료</Button></div></div> : null}
      <div className={`${ACTIONS} border-t pt-4`}>{preview ? <><Button disabled={locked || !canEdit || !preview.canAssign || !input} onClick={apply} type="button">{preview.goods.length}개 원상품에 적용</Button>
        <Button disabled={locked} onClick={() => { setPreview(null); setInput(null); setError(''); }} type="button" variant="outline">상품 다시 선택</Button></>
        : canEdit ? <Button disabled={locked || !selected.length || !targetReady} onClick={() => { void buildPreview(); }} type="button">배정 미리보기</Button> : null}
        <Button disabled={reading || operation.busy || Boolean(operation.context)} onClick={() => { if (!reading && !operation.busy && !operation.context) onClose(); }} type="button" variant="ghost">닫기</Button></div>
    </div>
  </CustomerServiceDialog>;
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { findShippingChargeGroupGoodsAction, previewShippingChargeGroupAssignmentAction } from '@/app/admin/shipping-charge-group-actions';
import { adminConfirm } from '@/lib/admin/confirm';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, reopenClosedDialog } from '@/lib/admin/goods-template-save';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import {
  SHIPPING_CHARGE_GROUP_BLOCKER_LABELS, SHIPPING_CHARGE_GROUP_GOOD_LIMIT, SHIPPING_CHARGE_GROUP_RUNTIME_OFF, SHIPPING_CHARGE_GROUP_STOP_LABEL,
  parseShippingChargeGroupAssignRequest, shippingChargeGroupGoodGuard, shippingChargeGroupPreviewSplit,
  type ShippingChargeGroup, type ShippingChargeGroupAssignmentPreview, type ShippingChargeGroupAssignRequest, type ShippingChargeGroupBlocker,
  type ShippingChargeGroupGood, type ShippingChargeGroupIdentity, type ShippingChargeGroupOperationReceipt, type ShippingChargeGroupSkipped,
  type ShippingChargeGroupSummary as ShippingChargeGroupSummaryRow,
} from '@/lib/admin/shipping-charge-groups';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, FIELD_HINT, NOTE, TABLE_SCROLL } from '@/components/admin/settings-kit';
import {
  SHIPPING_CHARGE_GROUP_MODE_LABELS, SHIPPING_CHARGE_GROUP_PICKER_EMPTY, SHIPPING_CHARGE_GROUP_PICKER_EXCLUDED, SHIPPING_CHARGE_GROUP_PICKER_TITLE,
  ShippingChargeGroupSummary, shippingChargeGroupPickerLoader, shippingChargeGroupPickerRowView,
} from '../ShippingChargeGroupField';
import { CustomerServiceDialog } from '../screens/CustomerServiceDialog';
import { useShippingChargeGroupOperation, useShippingChargeGroupPending, type ShippingChargeGroupScope } from './useShippingChargeGroupOperation';

/** 목록의 [상품 넣기]로 열면 'add', 상품 수를 눌러 열면 'manage'(이 묶음그룹의 상품을 보고 빼거나 옮긴다). */
export type ShippingChargeGroupAssignmentTask = 'add' | 'manage';
type Action = 'add' | 'remove' | 'move';
/** 끝난 일. 목록 위 결과 줄이 이 값으로 문장을 만든다. `groupName`은 넣거나 옮긴 묶음그룹(빼기는 빠져나온 묶음그룹)의 이름이다. */
export interface ShippingChargeGroupAssignmentDone { action: Action; groupName: string; skipped: ShippingChargeGroupSkipped[] }
type Picked = Pick<ShippingChargeGroupGood, 'id' | 'name'>;

/* 묶음그룹에서 빼는 것은 출고지나 착불 준비가 끊긴 상품에도 열어 둔다(빼야 풀리는 경우가 있다). 되는지는 미리보기가 정한다. */
const clearableBlockers = new Set<ShippingChargeGroupBlocker>(['shipping_charge_group_origin_unavailable', 'collect_contract_not_ready',
  'shipping_charge_group_unavailable', 'shipping_charge_group_origin_mismatch']);
const ACTION_COPY: Record<Action, { title: string; apply: string; none: string; closeTitle: string; closeLabel: string }> = {
  add: { title: '묶음그룹에 상품 넣기', apply: '넣기', none: '넣을 수 있는 상품이 없습니다.', closeTitle: '상품을 넣지 않고 닫을까요?', closeLabel: '넣지 않고 닫기' },
  remove: { title: '묶음그룹에서 상품 빼기', apply: '빼기', none: '뺄 수 있는 상품이 없습니다.', closeTitle: '상품을 빼지 않고 닫을까요?', closeLabel: '빼지 않고 닫기' },
  move: { title: '다른 묶음그룹으로 상품 옮기기', apply: '옮기기', none: '옮길 수 있는 상품이 없습니다.', closeTitle: '상품을 옮기지 않고 닫을까요?', closeLabel: '옮기지 않고 닫기' },
};
const groupCell = (summary: ShippingChargeGroupSummaryRow | null) => summary
  ? <>{summary.name}<small className={`mt-1 block ${FIELD_HINT}`}>{SHIPPING_CHARGE_GROUP_MODE_LABELS[summary.calculationMode]}</small></>
  : <>묶음그룹 없음<small className={`mt-1 block ${FIELD_HINT}`}>상품과 출고지의 배송비 그대로</small></>;

/**
 * 묶음그룹에 상품을 넣고 빼는 창. 일마다 따로 연다(화면 규칙 '글보다 화면' ②).
 *   - [상품 넣기]: 같은 출고지의 상품을 공용 선택창(화면 규칙 1)에서 여러 개 고른다. 넣는 곳은 연 묶음그룹이다(다시 고르지 않는다).
 *   - 상품 수: 이 묶음그룹의 상품을 보고, 고른 상품을 [묶음그룹에서 빼기]·[다른 묶음그룹으로 옮기기] 한다.
 *   - 고른 뒤에는 바뀌는 내용을 먼저 보여 준다(미리보기가 확인 단계다). 조건이 안 맞는 상품은 건너뛰고 나머지만 바꾼다 —
 *     DB의 배정은 한 상품이라도 막히면 전부 거절하므로, 막힌 상품을 빼고 미리보기를 한 번 더 만들어 그 내용을 보낸다.
 * 내부 번호·버전은 보이지 않는다(화면 규칙 8).
 */
export function ShippingChargeGroupAssignmentDialog({ group, task, identity, scope, canEdit, runtimeEnabled = true, onClose, onApplied }: {
  group: ShippingChargeGroup; task: ShippingChargeGroupAssignmentTask; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope; canEdit: boolean;
  /** 쇼핑몰 주문 설정이 켜져 있는가. 꺼져 있으면 넣고 뺄 수 없어 목록만 보인다. */
  runtimeEnabled?: boolean;
  onClose: () => void; onApplied: (receipt: ShippingChargeGroupOperationReceipt, done: ShippingChargeGroupAssignmentDone) => void;
}) {
  const [picked, setPicked] = useState<Picked[]>([]), [step, setStep] = useState<'pick' | 'target' | 'preview'>('pick');
  const [action, setAction] = useState<Action | null>(task === 'add' ? 'add' : null), [target, setTarget] = useState<ShippingChargeGroup | null>(null);
  const [preview, setPreview] = useState<ShippingChargeGroupAssignmentPreview | null>(null), [input, setInput] = useState<ShippingChargeGroupAssignRequest | null>(null);
  const [skipped, setSkipped] = useState<ShippingChargeGroupSkipped[]>([]);
  const [reading, setReading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const alive = useRef(true), requesting = useRef(false), root = useRef<HTMLDivElement>(null);
  /* 보낼 때 건너뛴 상품과 한 일. 결과 줄에 그대로 남긴다. */
  const sent = useRef<ShippingChargeGroupAssignmentDone | null>(null);
  const destination = action === 'add' ? group.id : action === 'move' ? target?.id ?? null : null;
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: destination, command: 'assign',
    onReceipt: receipt => {
      if (receipt.state === 'assigned') onApplied(receipt, sent.current ?? { action: action ?? 'add', groupName: (action === 'move' ? target?.name : group.name) ?? group.name, skipped: [] });
      else if (receipt.state === 'sealed') { setPreview(null); setInput(null); setMessage('아무것도 바꾸지 않았습니다. 미리보기를 다시 만들어 주세요.'); }
    },
    /* 그사이 상품이나 묶음그룹이 바뀌어 저장되지 않았다. 미리보기가 낡았으므로 다시 만들게 한다(이유는 operation.error에 남는다). */
    onFailure: () => { setPreview(null); setInput(null); },
  });
  const pending = useShippingChargeGroupPending(identity);
  const otherPending = pending.some(item => item.operationId !== operation.context?.operationId);
  const unknown = Boolean(operation.context), locked = reading || operation.busy || unknown || otherPending;
  const readOnly = !canEdit || !runtimeEnabled;
  const { expectedActorId, expectedSessionId } = identity;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load: AdminPickerLoader<ShippingChargeGroupGood> = async request => {
    const result = await findShippingChargeGroupGoodsAction({ originId: group.originId, groupId: task === 'manage' ? group.id : null, query: request.query.trim(), page: request.page }, identity);
    if ('error' in result) { if (result.authChanged) scope.authenticate(null, null); return { error: result.error }; }
    return { rows: result.data.goods, total: result.data.total, page: result.data.page, pageSize: result.data.pageSize };
  };
  /** 이 줄을 고를 수 없는 까닭(고를 수 있으면 null). 조회가 막힌 상품을 빼 주지 않아 줄에 까닭을 보인다(공용 선택창의 예외). */
  function rowBlocked(good: ShippingChargeGroupGood): string | null {
    if (!good.editable || good.id !== good.ownerGoodId) return SHIPPING_CHARGE_GROUP_BLOCKER_LABELS.goods_aggregation_policy_owned_by_source;
    if (good.originId !== group.originId) return SHIPPING_CHARGE_GROUP_BLOCKER_LABELS.shipping_charge_group_origin_mismatch;
    if (task === 'add' && good.groupId === group.id) return '이미 이 묶음그룹에 있습니다';
    if (good.blocker && !(task === 'manage' && clearableBlockers.has(good.blocker))) return SHIPPING_CHARGE_GROUP_BLOCKER_LABELS[good.blocker];
    if (picked.length >= SHIPPING_CHARGE_GROUP_GOOD_LIMIT && !picked.some(item => item.id === good.id)) return `한 번에 ${SHIPPING_CHARGE_GROUP_GOOD_LIMIT}개까지`;
    return null;
  }
  const rowView = (good: ShippingChargeGroupGood): AdminPickerRowView => ({ title: good.name, meta: <>
    {good.code ?? ''}{task === 'add' && good.groupId && good.groupId !== group.id ? `${good.code ? ' · ' : ''}다른 묶음그룹에 있음 — 넣으면 이 묶음그룹으로 옮깁니다` : ''}
    {good.editable && good.effectiveCount > 1 ? <span className="block">함께 묶인 상품 {good.effectiveCount - 1}개도 같이 바뀝니다.</span> : null}
    {good.ownerGoodId !== good.id ? <Link className="block w-fit font-medium text-foreground underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.ownerGoodId)}`} target="_blank">원상품 열기 (새 탭)</Link> : null}
  </> });
  function pick(good: ShippingChargeGroupGood) {
    if (locked || readOnly || rowBlocked(good) !== null) return false;
    setPicked(current => current.some(item => item.id === good.id) || current.length >= SHIPPING_CHARGE_GROUP_GOOD_LIMIT ? current : [...current, { id: good.id, name: good.name }]);
  }
  const unpick = (good: ShippingChargeGroupGood) => { if (!locked) setPicked(current => current.filter(item => item.id !== good.id)); };

  /** 미리보기 한 번. 돌아온 것이 지금 고른 상품·묶음그룹과 다르면 쓰지 않는다. */
  async function readPreview(ids: string[], to: string | null, ticket: NonNullable<ReturnType<ShippingChargeGroupScope['capture']>>): Promise<ShippingChargeGroupAssignmentPreview | null> {
    const result = await previewShippingChargeGroupAssignmentAction(to, ids, identity);
    if (!alive.current || !scope.canApply(ticket)) return null;
    if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return null; }
    const value = result.data;
    if (value.actorId !== expectedActorId || value.sessionId !== expectedSessionId || (value.group?.id ?? null) !== to
      || value.goods.length !== ids.length || value.goods.some(good => !ids.includes(good.id))) {
      setError('고른 것과 다른 미리보기가 돌아왔습니다. [상품 다시 고르기]로 다시 골라 주세요.'); return null;
    }
    return value;
  }
  async function buildPreview(goods: Picked[], to: string | null) {
    const ticket = scope.capture(); if (!goods.length || !ticket || readOnly || requesting.current || operation.busy || operation.context) return;
    requesting.current = true; setReading(true); setError(''); setMessage(''); setPreview(null); setInput(null); setSkipped([]); operation.reset();
    try {
      const first = await readPreview(goods.map(good => good.id), to, ticket); if (!first) return;
      const split = shippingChargeGroupPreviewSplit(first);
      let value = first, skippedNow = split.skipped;
      /* 막힌 상품이 섞여 있으면 그 상품을 빼고 한 번 더 만든다. 보낼 내용은 이 두 번째 미리보기다. */
      if (split.skipped.length && split.ready.length) {
        const second = await readPreview(split.ready.map(good => good.id), to, ticket); if (!second) return;
        value = second; skippedNow = [...split.skipped, ...shippingChargeGroupPreviewSplit(second).skipped];
      }
      setPreview(value); setSkipped(skippedNow);
      const ready = shippingChargeGroupPreviewSplit(value);
      if (!value.canAssign || ready.skipped.length || !ready.ready.length || value.origins.some(origin => origin.id !== group.originId)) return;
      const request = parseShippingChargeGroupAssignRequest({ ...identity, operationId: crypto.randomUUID(), command: 'assign', groupId: to,
        expectedRevision: value.group?.revision ?? 0, origins: value.origins, goods: value.goods.map(shippingChargeGroupGoodGuard) });
      if (request) setInput(request); else setError('미리보기를 읽지 못해 저장할 수 없습니다. [상품 다시 고르기]로 다시 골라 주세요.');
    } catch { if (alive.current && scope.canApply(ticket)) setError('미리보기를 불러오지 못했습니다. 잠시 뒤 [미리보기 다시 만들기]를 눌러 주세요.'); }
    finally { requesting.current = false; if (alive.current && scope.canApply(ticket)) setReading(false); }
  }
  function begin(next: Action, to: ShippingChargeGroup | null = null) {
    if (locked || readOnly || !picked.length) return;
    setAction(next); setTarget(to); setStep('preview');
    void buildPreview(picked, next === 'add' ? group.id : to?.id ?? null);
  }
  /* 넣을 상품 고르기를 [완료]나 ×로 닫으면 고른 상품의 미리보기로 넘어간다(아직 아무것도 바뀌지 않는다). 고른 상품이 없으면 창을 닫는다. */
  function finishAdding() { if (picked.length && !readOnly) begin('add'); else onClose(); }
  async function closeList() {
    if (picked.length && !readOnly && !await adminConfirm({ title: '빼거나 옮기지 않고 닫을까요?', message: `고른 상품 ${picked.length}개의 선택이 풀립니다. 아직 아무 상품도 바뀌지 않았습니다.`, confirmLabel: '닫기', cancelLabel: '돌아가기' })) return;
    onClose();
  }
  function repick() {
    if (locked) return;
    setPreview(null); setInput(null); setSkipped([]); setError(''); setMessage(''); operation.reset();
    if (task === 'manage') { setAction(null); setTarget(null); }
    setStep('pick');
  }
  function apply() {
    if (locked || readOnly || !preview || !input || !action) return;
    sent.current = { action, groupName: (action === 'move' ? target?.name : group.name) ?? group.name, skipped };
    void operation.send(input);
  }
  async function close() {
    if (locked) return;
    const copy = ACTION_COPY[action ?? 'add'];
    if (picked.length && !readOnly && !await adminConfirm({ title: copy.closeTitle, message: `고른 상품 ${picked.length}개의 선택이 풀립니다. 아직 아무 상품도 바뀌지 않았습니다.`, confirmLabel: copy.closeLabel, cancelLabel: '돌아가기' })) { reopenClosedDialog(root.current); return; }
    onClose();
  }
  const waiting = otherPending || unknown ? '저장됐는지 확인하지 못한 일이 남아 있습니다. 이 창을 닫고 목록 위에서 먼저 확인해 주세요.' : null;

  if (step === 'pick') return <AdminPickerDialog<ShippingChargeGroupGood>
    blockedReason={waiting}
    closeLabel={task === 'manage' ? '닫기' : undefined}
    description={task === 'add' ? `‘${group.name}’ 묶음그룹에 넣을 상품을 고릅니다. 한 번에 ${SHIPPING_CHARGE_GROUP_GOOD_LIMIT}개까지 고를 수 있고, [완료]를 누르면 바뀌는 내용을 먼저 보여 줍니다.`
      : readOnly ? `‘${group.name}’ 묶음그룹에 넣은 상품입니다.` : `‘${group.name}’ 묶음그룹에 넣은 상품입니다. 빼거나 옮길 상품을 [선택]으로 고른 뒤 아래 버튼을 눌러 주세요.`}
    emptyText={task === 'add' ? '조건에 맞는 상품이 없습니다.' : '이 묶음그룹에 넣은 상품이 없습니다.'}
    excludedNote={task === 'add' ? '이 묶음그룹과 출고지가 다른 상품은 목록에서 뺐습니다.' : undefined}
    footer={readOnly ? (canEdit && !runtimeEnabled ? <p className={NOTE} data-charge-group-runtime-off="">{SHIPPING_CHARGE_GROUP_RUNTIME_OFF}</p> : null)
      : <div className={`${ACTIONS} justify-between`} data-charge-group-picked="">
        <p className="text-sm text-muted-foreground tabular-nums" role="status">고른 상품 {picked.length}개</p>
        {task === 'manage' ? <div className={ACTIONS}><Button disabled={locked || !picked.length} onClick={() => begin('remove')} type="button">묶음그룹에서 빼기</Button>
          <Button disabled={locked || !picked.length} onClick={() => { if (!locked && picked.length) setStep('target'); }} type="button" variant="outline">다른 묶음그룹으로 옮기기</Button></div> : null}
      </div>}
    load={load}
    multiple
    onClose={() => { if (task === 'add') finishAdding(); else void closeList(); }}
    onDeselect={unpick}
    onSelect={pick}
    rowAction={readOnly ? () => null : undefined}
    rowBlocked={rowBlocked}
    rowKey={good => good.id}
    rowView={rowView}
    searchPlaceholder="상품명·상품 자동코드"
    selectedKeys={picked.map(good => good.id)}
    title={task === 'add' ? '상품 고르기' : '묶음그룹의 상품'}
  />;

  /* 옮길 곳 고르기. 같은 출고지의 '사용' 묶음그룹만 보이고, 지금 묶음그룹은 고를 수 없다. 고르면 바로 미리보기로 넘어간다(선택창이 스스로 닫히지 않게 false를 돌려준다). */
  if (step === 'target') return <AdminPickerDialog<ShippingChargeGroup>
    description={`고른 상품 ${picked.length}개를 옮길 묶음그룹을 고릅니다. 고르면 바뀌는 내용을 먼저 보여 줍니다.`}
    emptyText={SHIPPING_CHARGE_GROUP_PICKER_EMPTY}
    excludedNote={SHIPPING_CHARGE_GROUP_PICKER_EXCLUDED}
    load={shippingChargeGroupPickerLoader(identity, group.originId)}
    onClose={() => setStep('pick')}
    onSelect={next => { if (next.id === group.id || next.originId !== group.originId || !next.enabled || next.archived) return false; begin('move', next); return false; }}
    rowBlocked={next => next.id === group.id ? '지금 묶음그룹' : null}
    rowKey={next => next.id}
    rowView={next => shippingChargeGroupPickerRowView(next)}
    searchPlaceholder="묶음그룹 이름"
    title={SHIPPING_CHARGE_GROUP_PICKER_TITLE}
  />;

  const copy = ACTION_COPY[action ?? 'add'], count = preview?.goods.length ?? 0;
  /* 미리보기는 있는데 보낼 내용이 없다: 바꿀 수 있는 상품이 하나도 없거나, 두 번째 미리보기 사이에 상품·묶음그룹이 바뀌었다. */
  const noneReady = preview !== null && shippingChargeGroupPreviewSplit(preview).ready.length === 0;
  const headline = action === 'remove' ? `상품 ${count}개를 ‘${group.name}’ 묶음그룹에서 뺍니다.`
    : action === 'move' ? `상품 ${count}개를 ‘${target?.name ?? ''}’ 묶음그룹으로 옮깁니다.` : `상품 ${count}개를 ‘${group.name}’ 묶음그룹에 넣습니다.`;
  return <CustomerServiceDialog title={copy.title} onClose={() => { void close(); }} busy={locked} wide>
    <div className="flex min-w-0 flex-col gap-4" data-charge-group-assignment="" ref={root}>
      {preview ? <>
        {input ? <p data-charge-group-apply-summary=""><strong className="font-medium">{headline}</strong>{skipped.length ? ` ${skipped.length}개는 건너뜁니다.` : ''}</p>
          : noneReady ? <AdminNotice role="alert" title={copy.none} tone="warning"><p>상품마다 건너뛴 이유를 확인해 주세요.</p></AdminNotice>
            : error ? null : <AdminNotice role="alert" tone="warning">그사이 상품이나 묶음그룹이 바뀌었습니다. [미리보기 다시 만들기]를 눌러 주세요.</AdminNotice>}
        {input ? <p className={NOTE}>{action === 'remove' ? '뺀 상품은 상품과 출고지의 배송비를 그대로 받습니다. ' : ''}이미 들어온 주문의 배송비는 그대로입니다.</p> : null}
        {input && preview.group ? <ShippingChargeGroupSummary group={preview.group} example /> : null}
        <div className={TABLE_SCROLL}><Table className="min-w-[40rem]"><caption className="sr-only">상품마다 지금 묶음그룹과 바꾼 뒤</caption><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>상품명·상품 자동코드</TableHead><TableHead>지금</TableHead><TableHead>바꾼 뒤</TableHead></TableRow></TableHeader><TableBody>
          {input ? preview.goods.map(good => <TableRow className="hover:bg-transparent" key={good.id}>
            <TableHead className="h-auto py-3 align-top whitespace-normal [overflow-wrap:anywhere]" scope="row">{good.name}{good.code ? <small className={`mt-1 block ${FIELD_HINT}`}>{good.code}</small> : null}
              {good.familyGoodIds.length > 1 ? <small className={`mt-1 block ${FIELD_HINT}`}>함께 묶인 상품 {good.familyGoodIds.length - 1}개도 같이 바뀝니다.</small> : null}</TableHead>
            <TableCell className="align-top whitespace-normal">{groupCell(good.beforeGroup)}</TableCell><TableCell className="align-top whitespace-normal">{groupCell(good.afterGroup)}</TableCell>
          </TableRow>) : null}
          {skipped.map(item => <TableRow className="text-muted-foreground hover:bg-transparent" data-skipped="true" key={item.id}>
            <TableHead className="h-auto py-3 align-top whitespace-normal [overflow-wrap:anywhere]" scope="row">{item.name}</TableHead>
            <TableCell className="align-top whitespace-normal" colSpan={2}><span data-charge-group-skip="">건너뜀 · {item.reason}</span></TableCell>
          </TableRow>)}
        </TableBody></Table></div>
      </> : !reading && picked.length ? <p data-charge-group-picked="">고른 상품 {picked.length}개 · {picked.slice(0, 5).map(good => good.name).join(', ')}{picked.length > 5 ? ` 외 ${picked.length - 5}개` : ''}</p> : null}
      {reading || operation.busy ? <p className="text-sm text-muted-foreground" role="status">{operation.busy ? '저장하고 있습니다.' : '미리보기를 만들고 있습니다.'}</p> : null}
      {error || !unknown && operation.error ? <AdminNotice role="alert" tone="danger">{error || operation.error}</AdminNotice> : null}
      {message && !unknown ? <AdminNotice role="status" tone="neutral">{message}</AdminNotice> : null}
      {otherPending && !unknown ? <AdminNotice role="alert" tone="warning">{waiting}</AdminNotice> : null}
      {unknown ? <AdminNotice role="alert" tone="warning">
        <p>{operation.error || SAVE_UNKNOWN_MESSAGE}</p>{operation.message ? <p className="mt-1">{operation.message}</p> : null}
        <div className={`${ACTIONS} mt-2`}><Button disabled={reading || operation.busy} onClick={() => { void operation.recover(); }} size="sm" type="button">{SAVE_CHECK_LABEL}</Button>
          <Button disabled={reading || operation.busy || !canEdit} onClick={() => { void operation.recover(true); }} size="sm" type="button" variant="outline">{SHIPPING_CHARGE_GROUP_STOP_LABEL}</Button></div>
      </AdminNotice> : null}
      <div className={`${ACTIONS} justify-end border-t pt-4`}>
        <Button disabled={locked} onClick={() => { void close(); }} type="button" variant="ghost">닫기</Button>
        <Button disabled={locked} onClick={repick} type="button" variant="outline">상품 다시 고르기</Button>
        {preview && input ? <Button disabled={locked || readOnly} onClick={apply} type="button">{count}개 상품 {copy.apply}</Button>
          : noneReady ? null : <Button disabled={locked || readOnly || !picked.length} onClick={() => { void buildPreview(picked, destination); }} type="button">미리보기 다시 만들기</Button>}
      </div>
    </div>
  </CustomerServiceDialog>;
}

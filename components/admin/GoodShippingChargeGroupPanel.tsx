'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGoodShippingChargeGroupAction, previewShippingChargeGroupAssignmentAction } from '@/app/admin/shipping-charge-group-actions';
import { parseShippingChargeGroupAssignRequest, shippingChargeGroupGoodGuard, type ShippingChargeGroup, type ShippingChargeGroupAssignRequest,
  type ShippingChargeGroupAssignmentPreview, type ShippingChargeGroupGoodData, type ShippingChargeGroupIdentity,
  type ShippingChargeGroupOperationContext, type ShippingChargeGroupOperationReceipt } from '@/lib/admin/shipping-charge-groups';
import { ShippingChargeGroupField, ShippingChargeGroupSummary } from './ShippingChargeGroupField';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { GOOD_NOTE_CLASS, GOOD_SUBPANEL_CLASS } from './GoodEditorParts';
import { useShippingChargeGroupOperation, useShippingChargeGroupPending, useShippingChargeGroupSession,
  type ShippingChargeGroupScope } from './shipping-charge-groups/useShippingChargeGroupOperation';

function PendingAssignment({ context, identity, scope, disabled, onReceipt }: {
  context: ShippingChargeGroupOperationContext; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope;
  disabled: boolean; onReceipt: (receipt: ShippingChargeGroupOperationReceipt) => void;
}) {
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: context.groupId, command: context.command, onReceipt });
  /* 결과를 확인해야 하는 요청이라 경고 톤으로 둔다. */
  return <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--wc-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--wc-warning)_8%,transparent)] px-3 py-2.5 text-sm" data-shipping-charge-pending="">
    <strong className="font-medium">미확정 묶음배송 요청</strong>
    <p className="text-muted-foreground">이 계정·세션에서 진행한 요청의 결과를 먼저 확인해주세요. 조회 결과가 없으면 요청을 종료한 뒤 최신 상태로 다시 미리보기합니다.</p>
    <div className="flex flex-wrap gap-2">
      <button className={buttonVariants({ size: 'sm' })} data-slot="button" type="button" disabled={disabled || operation.busy} onClick={() => { if (!disabled && !operation.busy) void operation.recover(); }}>저장 결과 확인</button>
      <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={disabled || operation.busy} onClick={() => { if (!disabled && !operation.busy) void operation.recover(true); }}>미처리 요청 종료</button>
    </div>
    {operation.error ? <p className="text-destructive" role="alert">{operation.error}</p> : null}
    {operation.message ? <p className="font-medium" role="status">{operation.message}</p> : null}
  </div>;
}

export function GoodShippingChargeGroupAssignmentEditor({ goodId, identity, scope, disabledReason, showDisabledReason = true, onBusyChange }: {
  goodId: string; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope;
  disabledReason: string; onBusyChange?: (busy: boolean) => void;
  /** false면 잠금 이유 문장을 본문에 그리지 않는다(상품 편집기가 패널 위에 공통 잠금 안내를 보일 때). 잠금은 disabledReason이 그대로 맡는다. */
  showDisabledReason?: boolean;
}) {
  const [data, setData] = useState<ShippingChargeGroupGoodData | null>(null), [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState<string | null>(null), [target, setTarget] = useState<ShippingChargeGroup | null>(null);
  const [preview, setPreview] = useState<ShippingChargeGroupAssignmentPreview | null>(null), [request, setRequest] = useState<ShippingChargeGroupAssignRequest | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const alive = useRef(true), reading = useRef(false), sequence = useRef(0);
  const { expectedActorId, expectedSessionId } = identity;
  const pending = useShippingChargeGroupPending(identity);
  const reload = useCallback(async (replacePendingRead = false) => {
    const ticket = scope.capture(); if (!alive.current || !ticket || reading.current && !replacePendingRead) return;
    const number = ++sequence.current; reading.current = true; setLoading(true); setError(''); setData(null); setPreview(null); setRequest(null);
    try {
      const result = await getGoodShippingChargeGroupAction(goodId, { expectedActorId, expectedSessionId });
      if (!alive.current || number !== sequence.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return; }
      if (result.data.actorId !== expectedActorId || result.data.sessionId !== expectedSessionId || result.data.good.id !== goodId) {
        setError('현재 상품·계정과 다른 조회 결과입니다. 최신 배정을 다시 불러와주세요.'); return;
      }
      setData(result.data); setTargetId(result.data.group?.id ?? null); setTarget(result.data.group); setPreview(null); setRequest(null);
    } catch { if (alive.current && number === sequence.current && scope.canApply(ticket)) setError('상품의 묶음그룹을 읽지 못했습니다. 기존 배정을 변경하지 않았습니다.'); }
    finally { if (number === sequence.current) { reading.current = false; if (alive.current && scope.canApply(ticket)) setLoading(false); } }
  }, [goodId, expectedActorId, expectedSessionId, scope]);
  const received = (receipt: ShippingChargeGroupOperationReceipt) => {
    if (!alive.current || !scope.capture()) return;
    setMessage(receipt.state === 'sealed' ? '미처리 요청을 종료했습니다. 최신 상태를 확인하고 다시 미리보기해주세요.'
      : receipt.state === 'assigned' ? `${receipt.appliedCount}개 상품의 묶음그룹 배정 결과를 확인했습니다.` : '묶음그룹 저장 결과를 확인했습니다.');
    void reload(true);
  };
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: targetId, command: 'assign', onReceipt: received });
  const invalidateReads = useCallback(() => { sequence.current++; }, []);
  useEffect(() => {
    alive.current = true; let current = true;
    void Promise.resolve().then(() => { if (current && alive.current) void reload(); });
    return () => { current = false; alive.current = false; invalidateReads(); };
  }, [reload, invalidateReads]);
  useEffect(() => { onBusyChange?.(loading || operation.busy || pending.length > 0); }, [loading, operation.busy, pending.length, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const locked = loading || operation.busy || pending.length > 0 || Boolean(disabledReason);
  const canEdit = Boolean(data?.good.editable && data.good.id === data.good.ownerGoodId && data.runtimeEnabled
    && (targetId === null || data.good.originId));
  async function prepare() {
    if (locked || !canEdit || reading.current) return;
    const ticket = scope.capture(); if (!ticket) return;
    const number = ++sequence.current;
    reading.current = true; setLoading(true); setError(''); setMessage(''); setPreview(null); setRequest(null);
    try {
      const result = await previewShippingChargeGroupAssignmentAction(targetId, [goodId], identity);
      if (!alive.current || number !== sequence.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return; }
      const value = result.data;
      if (value.actorId !== expectedActorId || value.sessionId !== expectedSessionId || (value.group?.id ?? null) !== targetId
        || value.goods.length !== 1 || value.goods[0].id !== goodId) {
        setError('현재 상품·대상 그룹·세션과 다른 미리보기입니다. 최신 배정을 확인해주세요.'); return;
      }
      setPreview(value);
      if (value.canAssign && value.runtimeEnabled && value.goods.every(good => good.editable && good.id === good.ownerGoodId && good.blocker === null)) {
        const parsed = parseShippingChargeGroupAssignRequest({ operationId: crypto.randomUUID(), command: 'assign', groupId: targetId,
          expectedRevision: value.group?.revision ?? 0, ...identity, origins: value.origins, goods: value.goods.map(shippingChargeGroupGoodGuard) });
        if (parsed) setRequest(parsed); else setError('미리보기의 저장 기준을 확인하지 못했습니다. 배정을 저장하지 않았습니다.');
      }
    } catch { if (alive.current && number === sequence.current && scope.canApply(ticket)) setError('배정 미리보기를 불러오지 못했습니다. 다시 확인해주세요.'); }
    finally { if (number === sequence.current) { reading.current = false; if (alive.current && scope.canApply(ticket)) setLoading(false); } }
  }
  return <div className="flex min-w-0 flex-col gap-3" data-shipping-charge-assignment="">
    {pending.map(context => <PendingAssignment key={context.operationId} context={context} identity={identity} scope={scope} disabled={loading || operation.busy} onReceipt={received} />)}
    {data ? <>
      <ShippingChargeGroupField identity={identity} originId={data.good.originId} value={targetId} selectedGroup={target}
        onChange={(id, group) => { if (!locked && canEdit) { setTargetId(id); setTarget(group); setPreview(null); setRequest(null); setMessage(''); } }}
        disabled={locked || !canEdit} readOnly={!data.good.editable} ownerGoodId={data.good.ownerGoodId} />
      {data.good.familyGoodIds.length > 1 ? <p className="text-sm text-muted-foreground">원상품의 배정을 합산군 {data.good.familyGoodIds.length}개 상품이 공유합니다. 구매 할인·한도와 전시 그룹 구성은 변경하지 않습니다.</p> : null}
      {!data.runtimeEnabled ? <p className="text-sm text-[var(--wc-warning)]">현재 상품 거래 경로에서 묶음배송을 적용할 수 없습니다. 운영 설정을 확인해주세요.</p> : null}
      <p className="text-sm text-muted-foreground">배정은 이 영역에서 별도로 저장합니다. 출고지를 바꾸려면 기존 배정을 먼저 해제하거나 배송정보 템플릿에서 출고지와 그룹을 함께 적용해주세요.</p>
      {preview ? <div className={GOOD_SUBPANEL_CLASS} data-shipping-charge-preview=""><strong className="text-sm font-medium">상품 배정 변경 전후</strong>
        {preview.goods.map(good => <div className="flex min-w-0 flex-col gap-2" key={good.id}><p className="text-sm font-medium wrap-anywhere">{good.name}</p>
          <div className="grid min-w-0 gap-3 md:grid-cols-2"><div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">변경 전</span><ShippingChargeGroupSummary group={good.beforeGroup} /></div>
          <div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">변경 후</span><ShippingChargeGroupSummary group={good.afterGroup} /></div></div>
          {good.blocker ? <p className="text-sm text-destructive" role="alert">현재 출고지·권한·거래 준비 상태에서 적용할 수 없습니다. 최신 상품과 그룹 설정을 확인해주세요.</p> : null}</div>)}
        <p className="text-sm text-muted-foreground">묶음 기본료는 같은 주문의 대상 상품 수량·금액으로 계산합니다. 기존 확정 주문은 바뀌지 않습니다.</p>
        <button className={`${buttonVariants()} self-start`} data-slot="button" type="button" disabled={locked || !request || !preview.canAssign} onClick={() => { if (!locked && canEdit && request && preview.canAssign) void operation.send(request); }}>이 배정으로 저장</button>
      </div> : null}
    </> : null}
    <div className="flex flex-wrap gap-2"><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={locked || !canEdit} onClick={() => { void prepare(); }}>배정 미리보기</button>
      <button className={buttonVariants({ variant: 'ghost' })} data-slot="button" type="button" disabled={locked} onClick={() => { if (!locked) void reload(); }}>최신 배정 불러오기</button></div>
    {showDisabledReason && disabledReason ? <p className={GOOD_NOTE_CLASS}>{disabledReason}</p> : null}
    {loading || operation.busy ? <p className="text-sm text-muted-foreground" role="status">묶음배송 설정을 확인하고 있습니다.</p> : null}
    {error || operation.error ? <p className="text-sm text-destructive" role="alert">{error || operation.error}</p> : null}
    {message || operation.message ? <p className="text-sm font-medium" role="status">{message || operation.message}</p> : null}
  </div>;
}

export function GoodShippingChargeGroupPanel({ goodId, accountId, disabledReason = '', showDisabledReason = true, onBusyChange }: {
  goodId: string; accountId: string; disabledReason?: string; onBusyChange?: (busy: boolean) => void;
  /** false면 잠금 이유 문장을 본문에 그리지 않는다(상품 편집기가 패널 위에 공통 잠금 안내를 보일 때). 잠금은 disabledReason이 그대로 맡는다. */
  showDisabledReason?: boolean;
}) {
  const { identity, scope, blocked } = useShippingChargeGroupSession(accountId);
  return identity ? <GoodShippingChargeGroupAssignmentEditor key={`${identity.expectedActorId}:${identity.expectedSessionId}:${goodId}`} goodId={goodId} identity={identity}
    scope={scope} disabledReason={disabledReason} showDisabledReason={showDisabledReason} onBusyChange={onBusyChange} />
    : <p className={blocked ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} role={blocked ? 'alert' : 'status'}>{blocked ? '로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.' : '현재 로그인 상태를 확인하고 있습니다.'}</p>;
}

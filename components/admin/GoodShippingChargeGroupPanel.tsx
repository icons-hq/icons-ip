'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getGoodShippingChargeGroupAction, previewShippingChargeGroupAssignmentAction } from '@/app/admin/shipping-charge-group-actions';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import { SHIPPING_CHARGE_GROUP_BLOCKER_LABELS, SHIPPING_CHARGE_GROUP_RUNTIME_OFF, SHIPPING_CHARGE_GROUP_STOP_LABEL,
  parseShippingChargeGroupAssignRequest, shippingChargeGroupGoodGuard, type ShippingChargeGroup, type ShippingChargeGroupAssignRequest,
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
  /* 저장됐는지 모르는 채 남은 일이라 경고 톤으로 둔다. */
  return <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--wc-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--wc-warning)_8%,transparent)] px-3 py-2.5 text-sm" data-shipping-charge-pending="">
    <p><strong className="font-medium">{context.command === 'save' ? '묶음그룹을 저장하던 중이었습니다.' : '묶음그룹에 상품을 넣거나 빼던 중이었습니다.'}</strong> {SAVE_UNKNOWN_MESSAGE}</p>
    <div className="flex flex-wrap gap-2">
      <button className={buttonVariants({ size: 'sm' })} data-slot="button" type="button" disabled={disabled || operation.busy} onClick={() => { if (!disabled && !operation.busy) void operation.recover(); }}>{SAVE_CHECK_LABEL}</button>
      <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={disabled || operation.busy} onClick={() => { if (!disabled && !operation.busy) void operation.recover(true); }}>{SHIPPING_CHARGE_GROUP_STOP_LABEL}</button>
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
        setError('다른 상품이나 계정의 결과가 돌아왔습니다. [지금 묶음그룹 불러오기]를 눌러 주세요.'); return;
      }
      setData(result.data); setTargetId(result.data.group?.id ?? null); setTarget(result.data.group); setPreview(null); setRequest(null);
    } catch { if (alive.current && number === sequence.current && scope.canApply(ticket)) setError('상품의 묶음그룹을 불러오지 못했습니다. 아무것도 바뀌지 않았습니다. [지금 묶음그룹 불러오기]를 눌러 주세요.'); }
    finally { if (number === sequence.current) { reading.current = false; if (alive.current && scope.canApply(ticket)) setLoading(false); } }
  }, [goodId, expectedActorId, expectedSessionId, scope]);
  const received = (receipt: ShippingChargeGroupOperationReceipt) => {
    if (!alive.current || !scope.capture()) return;
    setMessage(receipt.state === 'sealed' ? '그만뒀습니다. 아무것도 바뀌지 않았습니다. 지금 묶음그룹을 확인한 뒤 다시 해 주세요.'
      : receipt.state === 'assigned' ? `상품 ${receipt.appliedCount}개의 묶음그룹을 바꿨습니다.` : '묶음그룹을 저장했습니다.');
    void reload(true);
  };
  /* 저장되지 않은 것이 확실하면(그사이 상품·묶음그룹이 바뀐 경우 등) 낡은 미리보기를 지운다. 이유를 보고 [바뀌는 내용 보기]를 다시 누르면 지금 값으로 새로 만든다. */
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: targetId, command: 'assign', onReceipt: received,
    onFailure: failure => { if (alive.current && scope.capture()) { setPreview(null); setRequest(null); setError(failure.error); } } });
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
        setError('지금 고른 것과 맞지 않는 미리보기가 돌아왔습니다. [바뀌는 내용 보기]를 다시 눌러 주세요.'); return;
      }
      setPreview(value);
      if (value.canAssign && value.runtimeEnabled && value.goods.every(good => good.editable && good.id === good.ownerGoodId && good.blocker === null)) {
        const parsed = parseShippingChargeGroupAssignRequest({ operationId: crypto.randomUUID(), command: 'assign', groupId: targetId,
          expectedRevision: value.group?.revision ?? 0, ...identity, origins: value.origins, goods: value.goods.map(shippingChargeGroupGoodGuard) });
        if (parsed) setRequest(parsed); else setError('미리보기를 읽지 못해 저장할 수 없습니다. [지금 묶음그룹 불러오기]를 누른 뒤 다시 해 주세요.');
      }
    } catch { if (alive.current && number === sequence.current && scope.canApply(ticket)) setError('미리보기를 불러오지 못했습니다. 잠시 뒤 [바뀌는 내용 보기]를 다시 눌러 주세요.'); }
    finally { if (number === sequence.current) { reading.current = false; if (alive.current && scope.canApply(ticket)) setLoading(false); } }
  }
  return <div className="flex min-w-0 flex-col gap-3" data-shipping-charge-assignment="">
    {pending.map(context => <PendingAssignment key={context.operationId} context={context} identity={identity} scope={scope} disabled={loading || operation.busy} onReceipt={received} />)}
    {data ? <>
      <ShippingChargeGroupField identity={identity} originId={data.good.originId} value={targetId} selectedGroup={target}
        onChange={(id, group) => { if (!locked && canEdit) { setTargetId(id); setTarget(group); setPreview(null); setRequest(null); setMessage(''); } }}
        disabled={locked || !canEdit} readOnly={!data.good.editable} ownerGoodId={data.good.ownerGoodId} />
      {data.good.editable && data.good.familyGoodIds.length > 1 ? <p className="text-sm text-muted-foreground" data-shipping-charge-family="">함께 묶인 상품 {data.good.familyGoodIds.length - 1}개도 같은 묶음그룹을 씁니다.</p> : null}
      {!data.runtimeEnabled ? <p className="text-sm text-[var(--wc-warning)]" data-shipping-charge-runtime-off="">{SHIPPING_CHARGE_GROUP_RUNTIME_OFF}</p> : null}
      {/* 묶음그룹에 든 상품은 출고지를 바꿀 수 없다(DB가 거절한다). 묶음그룹에 들어 있을 때만 그 길을 말한다. */}
      {data.group ? <p className="text-sm text-muted-foreground" data-shipping-charge-origin-note="">출고지를 바꾸려면 묶음그룹에서 먼저 빼거나, 배송정보 템플릿으로 출고지와 묶음그룹을 함께 바꿔 주세요.</p> : null}
      {preview ? <div className={GOOD_SUBPANEL_CLASS} data-shipping-charge-preview=""><strong className="text-sm font-medium">바뀌는 내용</strong>
        {preview.goods.map(good => <div className="flex min-w-0 flex-col gap-2" key={good.id}><p className="text-sm font-medium wrap-anywhere">{good.name}</p>
          <div className="grid min-w-0 gap-3 md:grid-cols-2"><div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">지금</span><ShippingChargeGroupSummary group={good.beforeGroup} /></div>
          <div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">바꾼 뒤</span><ShippingChargeGroupSummary group={good.afterGroup} /></div></div>
          {good.blocker ? <p className="text-sm text-destructive" role="alert">저장할 수 없습니다. {SHIPPING_CHARGE_GROUP_BLOCKER_LABELS[good.blocker]}.</p> : null}</div>)}
        <p className="text-sm text-muted-foreground">이미 들어온 주문의 배송비는 그대로입니다.</p>
        <button className={`${buttonVariants()} self-start`} data-slot="button" type="button" disabled={locked || !request || !preview.canAssign} onClick={() => { if (!locked && canEdit && request && preview.canAssign) void operation.send(request); }}>이대로 저장</button>
      </div> : null}
    </> : null}
    <div className="flex flex-wrap gap-2"><button className={buttonVariants({ variant: 'outline' })} data-slot="button" type="button" disabled={locked || !canEdit} onClick={() => { void prepare(); }}>바뀌는 내용 보기</button>
      <button className={buttonVariants({ variant: 'ghost' })} data-slot="button" type="button" disabled={locked} onClick={() => { if (!locked) void reload(); }}>지금 묶음그룹 불러오기</button></div>
    {showDisabledReason && disabledReason ? <p className={GOOD_NOTE_CLASS}>{disabledReason}</p> : null}
    {loading || operation.busy ? <p className="text-sm text-muted-foreground" role="status">묶음그룹을 확인하고 있습니다.</p> : null}
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
    : <p className={blocked ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} role={blocked ? 'alert' : 'status'}>{blocked ? '로그인 계정이 바뀌었거나 로그인이 끊겼습니다. 지금 로그인한 계정으로 이 화면을 새로고침해주세요.' : '현재 로그인 상태를 확인하고 있습니다.'}</p>;
}

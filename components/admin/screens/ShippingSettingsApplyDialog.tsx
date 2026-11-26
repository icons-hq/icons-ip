'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { findShippingSettingsOutdatedGoodsAction, previewShippingSettingsTemplateAction } from '@/app/admin/shipping-settings-template-actions';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import {
  SHIPPING_SETTINGS_GOOD_LIMIT, SHIPPING_SETTINGS_RUNTIME_REJECTED, shippingSettingsExtraChanges, shippingSettingsGoodGuard, shippingSettingsMoney, shippingSettingsPreviewSplit, type ShippingSettings, type ShippingSettingsApplyInput,
  type ShippingSettingsEffective, type ShippingSettingsIdentity, type ShippingSettingsPreview, type ShippingSettingsSkipped, type ShippingSettingsTemplate,
} from '@/lib/admin/shipping-settings-templates';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, reopenClosedDialog } from '@/lib/admin/goods-template-save';
import { adminConfirm } from '@/lib/admin/confirm';
import { AdminGoodsPicker, type AdminGoodsPickerRow } from '@/components/admin/AdminGoodsPicker';
import { ShippingChargeGroupSummary } from '@/components/admin/ShippingChargeGroupField';
import { Button } from '@/components/admin/kit/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, FIELD_HINT, NOTE, TABLE_SCROLL } from '@/components/admin/settings-kit';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { ShippingSettingsFulfillmentSummary } from './ShippingSettingsFulfillmentFields';
import { SHIPPING_SETTINGS_STOP_LABEL, useShippingSettingsOperation, type ShippingSettingsScope } from './useShippingSettingsOperation';

/* 반품·교환 조건의 짧은 이름. 상품등록의 접힌 줄 요약(GoodsClaimPolicyFields)과 같은 말이다. */
const claimFlag = (value: boolean | null) => value === null ? '기본 정책 확인' : value ? '기본 정책 가능' : '개별 확인 필요';
type Picked = { id: string; name: string };

/** 미리보기 표의 '지금'·'바꾼 뒤' 칸. 실제로 받는 배송비 규칙을 먼저 보인다. */
function PolicySummary({ settings, effective, origins }: { settings: ShippingSettings; effective: ShippingSettingsEffective; origins: GoodsFulfillmentOrigin[] }) {
  const origin = origins.find(item => item.id === effective.originId);
  return <dl className="grid min-w-60 gap-1 text-xs leading-relaxed [&_dd]:mb-1.5 [&_dd]:whitespace-pre-wrap [&_dd]:[overflow-wrap:anywhere] [&_dt]:font-medium">
    <dt>출고지·배송비</dt><dd>{origin?.name ?? '출고지 없음'}<ShippingSettingsDeliverySummary effective={effective} origin={origin} /></dd>
    {Object.hasOwn(effective, 'chargeGroup') ? <><dt>묶음그룹</dt><dd><ShippingChargeGroupSummary group={effective.chargeGroup} /></dd></> : null}
    {effective.fulfillment ? <><dt>수령 방식</dt><dd><ShippingSettingsFulfillmentSummary value={effective.fulfillment} /></dd></> : null}
    <dt>반품·교환</dt><dd>반품 {claimFlag(settings.claimPolicy.returnAllowed)} / 교환 {claimFlag(settings.claimPolicy.exchangeAllowed)}</dd>
    <dt>고객 귀책 비용</dt><dd>반품 편도 {shippingSettingsMoney(settings.claimPolicy.returnFee)} / 무료배송 후 반품 왕복 {shippingSettingsMoney(settings.claimPolicy.returnFreeShippingFee)} / 교환 왕복 {shippingSettingsMoney(settings.claimPolicy.exchangeFee)}</dd>
    {settings.claimPolicy.restrictionReason ? <><dt>제한 사유</dt><dd>{settings.claimPolicy.restrictionReason}</dd></> : null}
  </dl>;
}

/**
 * 템플릿을 상품에 적용하는 창. 상품은 공용 상품 선택창(화면 규칙 1)에서 여러 개 고르고, [완료]를 누르면 바뀌는 내용을 먼저 보여 준다.
 *   - 미리보기가 확인 단계다: 몇 개가 바뀌고 몇 개를 건너뛰는지, 상품마다 지금 → 바꾼 뒤를 보인다.
 *   - 조건이 안 맞는 상품은 건너뛰고 나머지만 적용한다(상품 일괄 변경과 같은 방식). 건너뛴 상품과 이유는 적용 결과에도 남는다.
 *   - 디지털 파일이 연결된 상품의 수령 방식을 바꾸면 파일 연결이 끊긴다. 그때만 한 번 더 묻는다.
 * 상품 목록에서 고른 상품(`initialGoodIds`)이나 [다시 적용](`reapply`)으로 열면 고르지 않고 바로 미리보기부터 연다.
 */
export function ShippingSettingsApplyDialog({ template, origins, identity, scope, onClose, onApplied, initialGoodIds = [], reapply = false }: {
  template: ShippingSettingsTemplate; origins: GoodsFulfillmentOrigin[]; identity: ShippingSettingsIdentity; scope: ShippingSettingsScope;
  onClose: () => void; onApplied: (count: number, skipped: ShippingSettingsSkipped[]) => void; initialGoodIds?: string[];
  /** 템플릿을 고친 뒤 다시 적용하지 않은 상품(한 번에 100개까지)으로 바로 미리보기를 만든다. */
  reapply?: boolean;
}) {
  const preset = initialGoodIds.length > 0 || reapply;
  const [picked, setPicked] = useState<Picked[]>([]), [picking, setPicking] = useState(!preset), [pending, setPending] = useState(preset);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [preview, setPreview] = useState<ShippingSettingsPreview | null>(null);
  const [applyInput, setApplyInput] = useState<ShippingSettingsApplyInput | null>(null), [remaining, setRemaining] = useState(0);
  const { expectedActorId, expectedSessionId } = identity;
  const alive = useRef(true), requesting = useRef(false), root = useRef<HTMLDivElement>(null);
  /* 적용을 보낼 때 건너뛴 상품. 결과 줄에 그대로 남긴다. */
  const skippedAtSend = useRef<ShippingSettingsSkipped[]>([]);
  const operation = useShippingSettingsOperation({ identity, scope, templateId: template.id, command: 'apply',
    onReceipt: receipt => {
      if (receipt.state === 'applied') onApplied(receipt.appliedCount, skippedAtSend.current);
      else if (receipt.state === 'sealed') { setPreview(null); setApplyInput(null); setMessage('적용하지 않았습니다. 미리보기를 다시 만들어 주세요.'); }
    },
    /* 그사이 상품·출고지·템플릿이 바뀌어 적용되지 않았다. 미리보기가 낡았으므로 다시 만들게 한다(이유는 operation.error에 남는다). */
    onFailure: () => { setPreview(null); setApplyInput(null); },
  });
  const unknown = Boolean(operation.context), locked = pending || operation.busy || unknown;
  const initialIdsKey = initialGoodIds.join(',');
  function adoptPreview(next: ShippingSettingsPreview) {
    const { ready } = shippingSettingsPreviewSplit(next);
    setPreview(next); setPicked(next.goods.map(good => ({ id: good.id, name: good.name })));
    setApplyInput(ready.length ? { operationId: crypto.randomUUID(), command: 'apply', templateId: next.template.id,
      expectedRevision: next.template.revision, ...identity, originUpdatedAt: next.origin.updatedAt,
      collectRevision: next.origin.collectRevision, collectVersionId: next.origin.collectVersionId,
      goods: ready.map(shippingSettingsGoodGuard),
      ...(Object.hasOwn(next, 'targetGroup') ? { targetGroup: next.targetGroup ? { id: next.targetGroup.id, revision: next.targetGroup.revision } : null } : {}) } : null);
  }
  useEffect(() => {
    alive.current = true; const ticket = scope.capture();
    async function initialize() {
      if (!ticket) return;
      let ids = initialIdsKey ? initialIdsKey.split(',') : [];
      if (reapply) {
        const found = await findShippingSettingsOutdatedGoodsAction(template.id, { expectedActorId, expectedSessionId });
        if (!alive.current || !scope.canApply(ticket)) return;
        if ('error' in found) { setError(found.error); if (found.authChanged) scope.authenticate(null, null); return; }
        if (!found.data.ids.length) { setMessage('다시 적용할 상품이 없습니다. 이 템플릿을 쓰는 상품은 모두 지금 내용입니다.'); return; }
        ids = found.data.ids; setRemaining(found.data.total - ids.length);
      }
      const result = await previewShippingSettingsTemplateAction(template.id, ids, { expectedActorId, expectedSessionId });
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('data' in result) adoptPreview(result.data); else { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
    }
    if (ticket && (initialIdsKey || reapply)) {
      requesting.current = true;
      void initialize().catch(() => { if (alive.current && scope.canApply(ticket)) setError('미리보기를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); })
        .finally(() => { requesting.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); });
    }
    return () => { alive.current = false; };
    // The template and identity are fixed by the keyed dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, expectedActorId, expectedSessionId, initialIdsKey, reapply, template.id]);
  async function buildPreview(goods: Picked[]) {
    const ticket = scope.capture(); if (!goods.length || !ticket || requesting.current || operation.busy || operation.context) return;
    requesting.current = true; setPending(true); setError(''); setMessage(''); setApplyInput(null); setPreview(null); operation.reset();
    try {
      const result = await previewShippingSettingsTemplateAction(template.id, goods.map(good => good.id), identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return; }
      adoptPreview(result.data);
    } catch { if (alive.current && scope.canApply(ticket)) setError('미리보기를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); }
    finally { requesting.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  const pick = (good: AdminGoodsPickerRow) => { setPicked(current => current.some(item => item.id === good.id) || current.length >= SHIPPING_SETTINGS_GOOD_LIMIT ? current : [...current, { id: good.id, name: good.name }]); };
  /* 선택창을 [완료]나 ×로 닫으면 고른 상품의 미리보기로 넘어간다(아직 아무것도 바뀌지 않는다). 고른 상품이 없으면 창을 닫는다. */
  function finishPicking() { setPicking(false); if (picked.length) void buildPreview(picked); else onClose(); }
  function repick() { if (locked) return; setPreview(null); setApplyInput(null); setError(''); setMessage(''); operation.reset(); setPicking(true); }
  const split = preview ? shippingSettingsPreviewSplit(preview) : null;
  /* 수령 방식을 바꾸는 템플릿을 디지털 파일이 연결된 상품에 적용하면 파일 연결이 끊긴다(새 주문부터). */
  const withFiles = preview && split && preview.template.settings.fulfillment?.mode === 'replace' ? split.ready.filter(good => (good.effectiveBefore.fulfillment?.files.length ?? 0) > 0) : [];
  async function apply() {
    if (locked || !applyInput || !split) return;
    if (withFiles.length && !await adminConfirm({ title: `상품 ${withFiles.length}개의 디지털 파일 연결을 끊고 적용할까요?`,
      message: `${withFiles.slice(0, 3).map(good => `‘${good.name}’`).join(', ')}${withFiles.length > 3 ? ` 외 ${withFiles.length - 3}개` : ''}에 연결해 둔 파일이 새 주문부터 빠집니다. 이미 구매한 주문은 그대로 받을 수 있습니다. 다시 넣으려면 상품마다 파일을 다시 올려야 합니다.`,
      confirmLabel: `${split.ready.length}개 상품에 적용`, destructive: true })) return;
    skippedAtSend.current = split.skipped;
    await operation.send(applyInput);
  }
  async function close() {
    if (locked) return;
    /* 여기서 고른 상품은 닫으면 사라진다. 상품 목록에서 넘어온 선택과 [다시 적용]은 다시 누르면 되므로 묻지 않는다. */
    if (!preset && picked.length && !await adminConfirm({ title: '상품에 적용하지 않고 닫을까요?', message: `고른 상품 ${picked.length}개가 사라집니다. 아직 아무 상품도 바뀌지 않았습니다.`, confirmLabel: '적용하지 않고 닫기' })) { reopenClosedDialog(root.current); return; }
    onClose();
  }
  if (picking) return <AdminGoodsPicker accountId={expectedActorId} title="상품 고르기" multiple
    description={`‘${template.name}’ 템플릿을 적용할 상품을 고릅니다. 한 번에 ${SHIPPING_SETTINGS_GOOD_LIMIT}개까지 고를 수 있습니다. [완료]를 누르면 바뀌는 내용을 먼저 보여 줍니다.`}
    footer={<p className="text-sm text-muted-foreground tabular-nums" data-shipping-apply-picked="" role="status">고른 상품 {picked.length}개</p>}
    onClose={finishPicking} onDeselect={good => setPicked(current => current.filter(item => item.id !== good.id))} onSelect={pick}
    rowBlocked={good => picked.length >= SHIPPING_SETTINGS_GOOD_LIMIT && !picked.some(item => item.id === good.id) ? `한 번에 ${SHIPPING_SETTINGS_GOOD_LIMIT}개까지` : null}
    selectedKeys={picked.map(good => good.id)} />;
  const extras = shippingSettingsExtraChanges(preview?.template.settings ?? template.settings);
  return <CustomerServiceDialog title="배송정보 템플릿을 상품에 적용" onClose={() => { void close(); }} busy={locked} wide>
    <div className="flex min-w-0 flex-col gap-4" data-shipping-apply="" ref={root}>
      {preview && split ? <>
        <p data-shipping-apply-summary=""><strong className="font-medium">상품 {split.ready.length}개의 배송 설정이 ‘{preview.template.name}’ 템플릿 값으로 바뀝니다.</strong>{split.skipped.length ? ` ${split.skipped.length}개는 건너뜁니다.` : ''}</p>
        <p className={NOTE}>바꾸는 것: 출고지, 배송비 유형, 반품·교환 조건{extras.length ? `, ${extras.join(', ')}` : ''}. 이미 받은 주문의 배송비와 회수 주소는 그대로입니다.</p>
        {withFiles.length ? <AdminNotice role="status" tone="warning"><p data-shipping-apply-files="">디지털 파일이 연결된 상품 {withFiles.length}개는 새 주문부터 파일을 받을 수 없게 됩니다. 이미 구매한 주문은 그대로입니다.</p></AdminNotice> : null}
        {split.ready.length ? null : <AdminNotice role="alert" title="적용할 수 있는 상품이 없습니다." tone="warning"><p>상품마다 건너뛴 이유를 확인해 주세요.</p></AdminNotice>}
        {preview.goods.some(good => good.blocker === 'checkout_contract_upgrade_required') ? <p className={NOTE} data-shipping-apply-runtime="">{SHIPPING_SETTINGS_RUNTIME_REJECTED}</p> : null}
        <div className={TABLE_SCROLL}><Table className="min-w-[42.5rem]"><caption className="sr-only">상품마다 지금 배송 설정과 바꾼 뒤</caption><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>상품명·상품 자동코드</TableHead><TableHead>지금</TableHead><TableHead>바꾼 뒤</TableHead></TableRow></TableHeader>
          <TableBody>{[...preview.goods].sort((a, b) => Number(split.ready.includes(a)) - Number(split.ready.includes(b))).map(good => {
            const skip = split.skipped.find(item => item.id === good.id);
            return <TableRow className="hover:bg-transparent data-[skipped]:text-muted-foreground" data-skipped={skip ? 'true' : undefined} key={good.id}>
              <TableHead className="h-auto py-3 align-top whitespace-normal" scope="row">{good.name}<small className={`mt-1 block ${FIELD_HINT}`}>{good.code}</small>
                {!skip && good.familyGoodIds.length > 1 ? <small className={`mt-1 block ${FIELD_HINT}`}>함께 묶인 상품 {good.familyGoodIds.length - 1}개의 배송비 계산도 같이 바뀝니다. 수령 방식과 반품·교환 조건은 이 상품만 바뀝니다.</small> : null}</TableHead>
              <TableCell className="align-top whitespace-normal"><PolicySummary settings={good.before} effective={good.effectiveBefore} origins={origins} /></TableCell>
              <TableCell className="align-top whitespace-normal">{skip ? <span data-shipping-apply-skip="">건너뜀 · {skip.reason}{good.ownerGoodId !== good.id ? <> <Link className="font-medium text-foreground underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.ownerGoodId)}`} target="_blank">원상품 열기 (새 탭)</Link></> : null}</span>
                : <PolicySummary settings={good.after} effective={good.effectiveAfter} origins={origins} />}</TableCell>
            </TableRow>;
          })}</TableBody></Table></div>
        {remaining > 0 ? <p className={NOTE} data-shipping-apply-remaining="">한 번에 {SHIPPING_SETTINGS_GOOD_LIMIT}개까지 적용합니다. 남은 {remaining.toLocaleString('ko-KR')}개는 적용한 뒤 목록에서 [다시 적용]을 한 번 더 눌러 주세요.</p> : null}
      </> : !pending && picked.length ? <p data-shipping-apply-picked="">고른 상품 {picked.length}개 · {picked.slice(0, 5).map(good => good.name).join(', ')}{picked.length > 5 ? ` 외 ${picked.length - 5}개` : ''}</p> : null}
      {pending || operation.busy ? <p className="text-sm text-muted-foreground" role="status">{operation.busy ? '적용하고 있습니다.' : '미리보기를 만들고 있습니다.'}</p> : null}
      {error || !unknown && operation.error ? <AdminNotice role="alert" tone="danger">{error || operation.error}</AdminNotice> : null}
      {message && !unknown ? <AdminNotice role="status" tone="neutral">{message}</AdminNotice> : null}
      {unknown ? <AdminNotice role="alert" tone="warning">
        <p>{operation.error || SAVE_UNKNOWN_MESSAGE}</p>{operation.message ? <p className="mt-1">{operation.message}</p> : null}
        <div className={`${ACTIONS} mt-2`}><Button disabled={pending || operation.busy} onClick={() => { void operation.check(); }} size="sm" type="button">{SAVE_CHECK_LABEL}</Button>
          <Button disabled={pending || operation.busy} onClick={() => { void operation.recover(true); }} size="sm" type="button" variant="outline">{SHIPPING_SETTINGS_STOP_LABEL}</Button></div>
      </AdminNotice> : null}
      <div className={`${ACTIONS} justify-end border-t pt-4`}>
        <Button disabled={locked} onClick={() => { void close(); }} type="button" variant="ghost">닫기</Button>
        {reapply ? null : <Button disabled={locked} onClick={repick} type="button" variant="outline">상품 다시 고르기</Button>}
        {preview && split ? <Button disabled={locked || !applyInput} onClick={() => { void apply(); }} type="button">{split.ready.length}개 상품에 적용</Button>
          : <Button disabled={locked || !picked.length} onClick={() => { void buildPreview(picked); }} type="button">미리보기</Button>}
      </div>
    </div>
  </CustomerServiceDialog>;
}

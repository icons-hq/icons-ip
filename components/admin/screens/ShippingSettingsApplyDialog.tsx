'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { findShippingSettingsGoodsAction, previewShippingSettingsTemplateAction } from '@/app/admin/shipping-settings-template-actions';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import {
  SHIPPING_SETTINGS_GOOD_LIMIT, shippingSettingsDelivery, shippingSettingsChargeGroup, shippingSettingsGoodGuard, shippingSettingsMoney, type ShippingSettings, type ShippingSettingsApplyInput,
  type ShippingSettingsCandidates, type ShippingSettingsEffective, type ShippingSettingsGood, type ShippingSettingsIdentity,
  type ShippingSettingsPreview, type ShippingSettingsTemplate,
} from '@/lib/admin/shipping-settings-templates';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { useShippingSettingsOperation, type ShippingSettingsScope } from './useShippingSettingsOperation';
import { ShippingSettingsFulfillmentSummary } from './ShippingSettingsFulfillmentFields';
import { ShippingChargeGroupSummary } from '@/components/admin/ShippingChargeGroupField';
import { Search, X } from 'lucide-react';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, ALERT_BOX, FIELD_HINT, INFO_PANEL, NOTE, STATUS_BOX, TABLE_SCROLL } from '@/components/admin/settings-kit';

function PolicySummary({ settings, effective, origins }: { settings: ShippingSettings; effective: ShippingSettingsEffective; origins: GoodsFulfillmentOrigin[] }) {
  const flag = (value: boolean | null) => value === null ? '미검토' : value ? '기본 정책에 따라 가능' : '제한 사유 개별 확인';
  return <dl className="grid min-w-60 gap-1 text-xs leading-relaxed [&_dd]:mb-1.5 [&_dd]:whitespace-pre-wrap [&_dd]:[overflow-wrap:anywhere] [&_dt]:font-medium">
    <dt>출고지·실제 배송비 규칙</dt><dd>{origins.find(origin => origin.id === effective.originId)?.name ?? '출고지 미설정'}<ShippingSettingsDeliverySummary effective={effective} /></dd>
    {Object.hasOwn(effective, 'chargeGroup') ? <><dt>배송비 묶음그룹</dt><dd><ShippingChargeGroupSummary group={effective.chargeGroup} /></dd></> : null}
    {effective.fulfillment ? <><dt>고객 수령 방식</dt><dd><ShippingSettingsFulfillmentSummary value={effective.fulfillment} /></dd></> : null}
    <dt>반품·교환</dt><dd>반품 {flag(settings.claimPolicy.returnAllowed)} / 교환 {flag(settings.claimPolicy.exchangeAllowed)}</dd>
    <dt>고객 귀책 비용</dt><dd>반품 편도 {shippingSettingsMoney(settings.claimPolicy.returnFee)} / 무료배송 후 반품 왕복 {shippingSettingsMoney(settings.claimPolicy.returnFreeShippingFee)} / 교환 왕복 {shippingSettingsMoney(settings.claimPolicy.exchangeFee)}</dd>
    {settings.claimPolicy.restrictionReason ? <><dt>조건</dt><dd>{settings.claimPolicy.restrictionReason}</dd></> : null}
    {settings.feeType !== 'individual' && settings.individualFee > 0 ? <><dt>보관된 개별 배송비</dt><dd>{shippingSettingsMoney(settings.individualFee)} · 현재 기본 설정에서 미사용</dd></> : null}
  </dl>;
}
const blockerText = {
  goods_aggregation_policy_owned_by_source: '이 상품의 배송 조건은 합산군 원상품이 관리합니다. 원상품에서 확인해주세요.',
  checkout_contract_upgrade_required: '현재 상품 거래 경로에서 확장 배송비를 적용할 수 없습니다.',
  collect_contract_not_ready: '출고지의 착불 수납 조건이 준비되지 않았습니다.',
  shipping_charge_group_unavailable: '지정할 묶음그룹을 사용할 수 없습니다.',
  shipping_charge_group_origin_mismatch: '묶음그룹과 적용할 출고지가 다릅니다. 같은 출고지의 그룹을 지정하거나 배정을 해제해주세요.',
};
export function ShippingSettingsApplyDialog({ template, origins, identity, scope, onClose, onApplied, initialGoodIds = [] }: {
  template: ShippingSettingsTemplate; origins: GoodsFulfillmentOrigin[]; identity: ShippingSettingsIdentity; scope: ShippingSettingsScope;
  onClose: () => void; onApplied: (count: number) => void; initialGoodIds?: string[];
}) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<ShippingSettingsGood[]>([]);
  const [candidates, setCandidates] = useState<ShippingSettingsCandidates | null>(null), [pending, setPending] = useState(true);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [preview, setPreview] = useState<ShippingSettingsPreview | null>(null);
  const [applyInput, setApplyInput] = useState<ShippingSettingsApplyInput | null>(null);
  const { expectedActorId, expectedSessionId } = identity;
  const alive = useRef(true), requesting = useRef(false);
  const operation = useShippingSettingsOperation({ identity, scope, templateId: template.id, command: 'apply', onReceipt: receipt => {
    if (receipt.state === 'applied') onApplied(receipt.appliedCount);
    else if (receipt.state === 'sealed') { setPreview(null); setApplyInput(null); setMessage('미처리 요청을 종료했습니다. 최신 미리보기를 확인한 뒤 적용해주세요.'); }
  } });
  const locked = pending || operation.busy || Boolean(operation.context);
  const initialIdsKey = initialGoodIds.join(',');
  function adoptPreview(next: ShippingSettingsPreview) {
    setPreview(next);
    if (next.canApply) setApplyInput({ operationId: crypto.randomUUID(), command: 'apply', templateId: next.template.id,
      expectedRevision: next.template.revision, ...identity, originUpdatedAt: next.origin.updatedAt,
      collectRevision: next.origin.collectRevision, collectVersionId: next.origin.collectVersionId,
      goods: next.goods.map(shippingSettingsGoodGuard),
      ...(Object.hasOwn(next, 'targetGroup') ? { targetGroup: next.targetGroup ? { id: next.targetGroup.id, revision: next.targetGroup.revision } : null } : {}) });
  }
  useEffect(() => {
    alive.current = true; const ticket = scope.capture(); requesting.current = true;
    async function initialize() {
      if (!ticket) return;
      if (initialIdsKey) {
        const result = await previewShippingSettingsTemplateAction(template.id, initialIdsKey.split(','), { expectedActorId, expectedSessionId });
        if (!alive.current || !scope.canApply(ticket)) return;
        if ('data' in result) adoptPreview(result.data); else { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
      } else {
        const result = await findShippingSettingsGoodsAction('', 1, { expectedActorId, expectedSessionId });
        if (!alive.current || !scope.canApply(ticket)) return;
        if ('data' in result) setCandidates(result.data); else { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
      }
    }
    if (ticket) void initialize().catch(() => { if (alive.current && scope.canApply(ticket)) setError('상품을 불러오지 못했습니다. 다시 검색해주세요.'); })
      .finally(() => { requesting.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); });
    return () => { alive.current = false; };
    // The template and identity are fixed by the keyed dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, expectedActorId, expectedSessionId, initialIdsKey, template.id]);
  function begin() {
    const ticket = scope.capture(); if (!ticket || requesting.current || operation.busy || operation.context) return null;
    requesting.current = true; setPending(true); setError(''); setMessage(''); return ticket;
  }
  async function search(page: number) {
    const ticket = begin(); if (!ticket) return;
    try { const result = await findShippingSettingsGoodsAction(query, page, identity); if (!alive.current || !scope.canApply(ticket)) return;
      if ('data' in result) setCandidates(result.data); else { setError(result.error); if (result.authChanged) scope.authenticate(null, null); }
    } catch { if (alive.current && scope.canApply(ticket)) setError('상품을 불러오지 못했습니다. 다시 검색해주세요.'); }
    finally { requesting.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  function toggle(good: ShippingSettingsGood) {
    if (locked || !good.editable) return;
    if (selected.some(item => item.id === good.id)) setSelected(items => items.filter(item => item.id !== good.id));
    else if (selected.length < SHIPPING_SETTINGS_GOOD_LIMIT) setSelected(items => [...items, good]);
    else setError(`한 번에 최대 ${SHIPPING_SETTINGS_GOOD_LIMIT}개까지 적용할 수 있습니다.`);
  }
  async function buildPreview() {
    if (!selected.length) return; const ticket = begin(); if (!ticket) return;
    setApplyInput(null);
    try {
      const result = await previewShippingSettingsTemplateAction(template.id, selected.map(good => good.id), identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return; }
      adoptPreview(result.data);
    } catch { if (alive.current && scope.canApply(ticket)) setError('미리보기를 불러오지 못했습니다. 다시 확인해주세요.'); }
    finally { requesting.current = false; if (alive.current && scope.canApply(ticket)) setPending(false); }
  }
  const close = () => { if (!locked) onClose(); };
  const delivery = shippingSettingsDelivery(preview?.template.settings ?? template.settings);
  const chargeGroup = shippingSettingsChargeGroup(preview?.template.settings ?? template.settings);
  return <CustomerServiceDialog title={preview ? '배송정보 적용 미리보기' : '배송정보 적용 상품 선택'} onClose={close} busy={locked} wide>
    <div className="flex min-w-0 flex-col gap-4" data-shipping-apply="">
      <p><strong className="font-medium">{preview?.template.name ?? template.name}</strong> · 버전 {preview?.template.revision ?? template.revision}</p>
      {!preview ? <>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void search(1); }}><label className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-1.5 text-sm font-medium [&_input]:font-normal" htmlFor="shipping-settings-good-query">상품명·판매자상품코드·상품번호<Input id="shipping-settings-good-query" value={query} maxLength={100} disabled={locked} onChange={event => setQuery(event.target.value)} /></label><Button disabled={locked} type="submit"><Search aria-hidden="true" />검색</Button></form>
        <p className={NOTE}>선택 {selected.length}개 / 최대 {SHIPPING_SETTINGS_GOOD_LIMIT}개 · 조회 {candidates?.total.toLocaleString('ko-KR') ?? '—'}개</p>
        <p className={NOTE}>합산군 원상품이 관리하는 다른 상품은 직접 선택하지 않습니다. 원상품이나 합산군 전체를 자동으로 추가하지 않습니다.</p>
        {selected.length ? <div className="flex max-h-30 flex-wrap gap-1.5 overflow-auto">{selected.map(good => <Button key={good.id} aria-label={`${good.name} 선택 해제`} disabled={locked} onClick={() => toggle(good)} size="xs" type="button" variant="outline">{good.name}<X aria-hidden="true" /></Button>)}</div> : null}
        <div className={TABLE_SCROLL}><Table className="min-w-[42.5rem]"><caption className="sr-only">배송정보 적용 상품 검색 결과</caption><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>선택</TableHead><TableHead>상품명</TableHead><TableHead>판매자상품코드</TableHead><TableHead>현재 적용되는 배송비</TableHead><TableHead>적용 버전</TableHead></TableRow></TableHeader><TableBody>{candidates?.rows.map(good => <TableRow key={good.id}>
          <TableCell className="align-top"><input type="checkbox" checked={selected.some(item => item.id === good.id)} aria-label={`${good.name} 선택`} onChange={() => toggle(good)} disabled={locked || !good.editable} /></TableCell>
          <TableCell className="align-top whitespace-normal">{good.name}<small className={`mt-1 block ${FIELD_HINT}`}>{good.id}</small>{good.familyGoodIds.length > 1 ? <small className={`mt-1 block ${FIELD_HINT}`}>확장 배송 정책을 {good.familyGoodIds.length}개 상품이 공유합니다.</small> : null}{!good.editable ? <small className={`mt-1 block ${FIELD_HINT}`}>합산군 원상품 관리 · <Link className="font-medium text-foreground underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.ownerGoodId)}`}>원상품 확인</Link></small> : null}</TableCell>
          <TableCell className="align-top">{good.code}</TableCell><TableCell className="min-w-56 align-top whitespace-normal"><ShippingSettingsDeliverySummary effective={good.effective} />{Object.hasOwn(good.effective, 'chargeGroup') ? <ShippingChargeGroupSummary group={good.effective.chargeGroup} /> : null}</TableCell><TableCell className="align-top">{good.templateId ? `${good.templateId === template.id ? '이 템플릿' : '다른 템플릿'} · 버전 ${good.templateRevision}` : '개별 설정'}</TableCell>
        </TableRow>)}</TableBody></Table>{!pending && candidates?.total === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">조건에 맞는 상품이 없습니다.</p> : null}</div>
        <ConsolePagination label="배송정보 적용 상품 페이지" page={candidates?.page ?? 1} pageSize={candidates?.pageSize ?? 20} total={candidates?.total ?? 0} unit="개" disabled={locked || !candidates} onPageChange={page => { void search(page); }} />
      </> : <>
        <div className={INFO_PANEL}><strong className="font-medium">{preview.origin.name} · 현재 출고지 정책</strong><p className="text-muted-foreground">기본 배송비 {shippingSettingsMoney(preview.origin.baseFee)} · {preview.origin.freeThreshold === null ? '무료 기준 없음' : `${shippingSettingsMoney(preview.origin.freeThreshold)} 이상 무료`} · 기본 택배사 {preview.origin.defaultCarrier ?? '미설정'}</p><p className="text-muted-foreground">반송 주소: {preview.origin.returnAddress || '미설정'}</p>
          <p className="text-muted-foreground">착불 수납 조건 {preview.origin.collectReady ? `준비됨${preview.origin.collectorName ? ` · ${preview.origin.collectorName}` : ''}` : '준비되지 않음'}</p></div>
        <p className={NOTE}>{preview.goods.length}개 선택 상품의 출고지·기본 배송비·반품 및 교환 조건을 바꿉니다. {delivery.mode === 'preserve'
          ? '상품의 기존 수량별·착불 설정은 유지합니다. 사용 중인 수량별 배송비가 기본 배송비보다 우선합니다.'
          : '확장 배송비는 이 템플릿에 저장된 상태와 조건으로 변경합니다.'}</p>
        <p className={NOTE}>묶음그룹은 {chargeGroup.mode === 'preserve' ? '현재 배정을 유지합니다.' : chargeGroup.mode === 'clear' ? '배정을 명시적으로 해제합니다.' : `${preview.targetGroup?.name ?? '선택한 그룹'}으로 지정합니다.`} 그룹에 지정된 상품은 실제 주문의 묶음 대상 수량·금액으로 함께 계산합니다.</p>
        <p className={NOTE}>{preview.template.settings.fulfillment?.mode === 'replace' ? '선택한 상품의 수령 방식·운임·설치비·수령 안내를 이 템플릿으로 변경합니다. 기존 디지털 파일 연결은 새 주문에서 해제됩니다.' : '상품별 수령 방식·설치비·다운로드 파일·수령 안내는 유지합니다.'} 이미 확정된 주문의 수령 조건과 파일은 유지됩니다.</p>
        <p className={NOTE}>기존 배송 안내문구와 주문에 확정된 배송비·회수 주소는 유지됩니다. 복수구매 할인과 합산군 구성은 변경하지 않으며 지역 추가료와 최종 운임은 주문 시 확인합니다.</p>
        {preview.goods.some(good => good.familyGoodIds.length > 1) ? <p className={NOTE}>원상품의 출고지·기본 배송비와 확장 배송 정책은 합산군 전체의 배송비 계산에 사용됩니다. 수령 방식·반품 및 교환 안내·템플릿 연결은 직접 선택한 상품에 저장합니다.</p> : null}
        <div className={TABLE_SCROLL}><Table className="min-w-[42.5rem]"><caption className="sr-only">상품별 실제 배송비 규칙과 설정 변경 전후</caption><TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead>상품</TableHead><TableHead>변경 전</TableHead><TableHead>변경 후</TableHead></TableRow></TableHeader><TableBody>{preview.goods.map(good => <TableRow className="hover:bg-transparent" key={good.id}>
          <TableHead className="h-auto py-3 align-top whitespace-normal" scope="row">{good.name}<small className={`mt-1 block ${FIELD_HINT}`}>{good.code}</small>{good.familyGoodIds.length > 1 ? <small className={`mt-1 block ${FIELD_HINT}`}>확장 배송 정책 공유 {good.familyGoodIds.length}개 상품</small> : null}{good.blocker ? <small className="mt-1 block text-xs font-normal text-destructive">{blockerText[good.blocker]}{good.ownerGoodId !== good.id ? <Link className="font-medium underline underline-offset-4" href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.ownerGoodId)}`}> 원상품 확인</Link> : null}</small> : null}</TableHead>
          <TableCell className="align-top whitespace-normal"><PolicySummary settings={good.before} effective={good.effectiveBefore} origins={origins} /></TableCell><TableCell className="align-top whitespace-normal"><PolicySummary settings={good.after} effective={good.effectiveAfter} origins={origins} /></TableCell>
        </TableRow>)}</TableBody></Table></div>
        {!preview.canApply ? <p role="alert" className={ALERT_BOX}>적용할 수 없는 상품이 있어 전체 적용을 중단했습니다. 표시된 조건을 확인하고 상품을 다시 선택해주세요.</p> : null}
        <p className={NOTE}>미리보기 후 상품·원상품·템플릿·출고지·묶음그룹 배정과 버전 또는 착불·수령 조건이 바뀌면 전체 적용을 중단합니다.</p>
      </>}
      {pending || operation.busy ? <p className="text-sm text-muted-foreground" role="status">처리 중입니다.</p> : null}
      {error || operation.error ? <p role="alert" className={ALERT_BOX}>{error || operation.error}</p> : null}
      {message || operation.message ? <p className={STATUS_BOX} role="status">{message || operation.message}</p> : null}
      {operation.context ? <div className={INFO_PANEL}><strong className="font-medium">같은 요청의 결과를 먼저 확인해주세요.</strong><p className="text-muted-foreground">새로고침 후에도 요청번호만 남습니다. 조회 결과가 없으면 미처리 요청을 종료한 뒤 새 미리보기를 만드세요.</p>
        <div className={ACTIONS}><Button disabled={pending || operation.busy} onClick={() => { void operation.recover(); }} type="button">저장 결과 확인</Button>
          {operation.canRetry ? <Button disabled={pending || operation.busy} onClick={() => { void operation.retry(); }} type="button" variant="outline">같은 입력으로 재시도</Button> : null}
          <Button disabled={pending || operation.busy} onClick={() => { void operation.recover(true); }} type="button" variant="outline">미처리 요청 종료</Button></div></div> : null}
      <div className={`${ACTIONS} border-t pt-4`}>{preview ? <><Button disabled={locked || !preview.canApply || !applyInput} onClick={() => { if (!locked && applyInput) void operation.send(applyInput); }} type="button">{preview.goods.length}개 상품에 적용</Button>
        <Button disabled={locked} onClick={() => { setPreview(null); setApplyInput(null); setError(''); }} type="button" variant="outline">상품 다시 선택</Button></>
        : <Button disabled={locked || !selected.length} onClick={() => { void buildPreview(); }} type="button">적용 미리보기</Button>}
        <Button disabled={locked} onClick={close} type="button" variant="ghost">취소</Button></div>
    </div>
  </CustomerServiceDialog>;
}

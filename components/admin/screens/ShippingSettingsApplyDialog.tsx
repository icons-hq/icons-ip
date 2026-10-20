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

function PolicySummary({ settings, effective, origins }: { settings: ShippingSettings; effective: ShippingSettingsEffective; origins: GoodsFulfillmentOrigin[] }) {
  const flag = (value: boolean | null) => value === null ? '미검토' : value ? '기본 정책에 따라 가능' : '제한 사유 개별 확인';
  return <dl className="admin-shipping-settings__policy-summary">
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
  const maxPage = candidates ? Math.max(1, Math.ceil(candidates.total / candidates.pageSize)) : 1;
  const delivery = shippingSettingsDelivery(preview?.template.settings ?? template.settings);
  const chargeGroup = shippingSettingsChargeGroup(preview?.template.settings ?? template.settings);
  return <CustomerServiceDialog title={preview ? '배송정보 적용 미리보기' : '배송정보 적용 상품 선택'} onClose={close} busy={locked} wide>
    <div className="admin-shipping-settings__apply">
      <p><strong>{preview?.template.name ?? template.name}</strong> · 버전 {preview?.template.revision ?? template.revision}</p>
      {!preview ? <>
        <form className="admin-shipping-settings__picker-search" onSubmit={event => { event.preventDefault(); void search(1); }}><label htmlFor="shipping-settings-good-query">상품명·판매자상품코드·상품번호<input id="shipping-settings-good-query" value={query} maxLength={100} disabled={locked} onChange={event => setQuery(event.target.value)} /></label><button className="btn btn-sm" type="submit" disabled={locked}>검색</button></form>
        <p>선택 {selected.length}개 / 최대 {SHIPPING_SETTINGS_GOOD_LIMIT}개 · 조회 {candidates?.total.toLocaleString('ko-KR') ?? '—'}개</p>
        <p>합산군 원상품이 관리하는 다른 상품은 직접 선택하지 않습니다. 원상품이나 합산군 전체를 자동으로 추가하지 않습니다.</p>
        {selected.length ? <div className="admin-shipping-settings__selected">{selected.map(good => <button key={good.id} type="button" disabled={locked} onClick={() => toggle(good)} aria-label={`${good.name} 선택 해제`}>{good.name} ×</button>)}</div> : null}
        <div className="admin-shipping-settings__table"><table><caption>배송정보 적용 상품 검색 결과</caption><thead><tr><th>선택</th><th>상품명</th><th>판매자상품코드</th><th>현재 적용되는 배송비</th><th>적용 버전</th></tr></thead><tbody>{candidates?.rows.map(good => <tr key={good.id}>
          <td><input type="checkbox" checked={selected.some(item => item.id === good.id)} aria-label={`${good.name} 선택`} onChange={() => toggle(good)} disabled={locked || !good.editable} /></td>
          <td>{good.name}<small>{good.id}</small>{good.familyGoodIds.length > 1 ? <small>확장 배송 정책을 {good.familyGoodIds.length}개 상품이 공유합니다.</small> : null}{!good.editable ? <small>합산군 원상품 관리 · <Link href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.ownerGoodId)}`}>원상품 확인</Link></small> : null}</td>
          <td>{good.code}</td><td><ShippingSettingsDeliverySummary effective={good.effective} />{Object.hasOwn(good.effective, 'chargeGroup') ? <ShippingChargeGroupSummary group={good.effective.chargeGroup} /> : null}</td><td>{good.templateId ? `${good.templateId === template.id ? '이 템플릿' : '다른 템플릿'} · 버전 ${good.templateRevision}` : '개별 설정'}</td>
        </tr>)}</tbody></table>{!pending && candidates?.total === 0 ? <p>조건에 맞는 상품이 없습니다.</p> : null}</div>
        <div className="admin-shipping-settings__pagination"><button className="btn btn-sm btn-ghost" type="button" disabled={locked || !candidates || candidates.page <= 1} onClick={() => { void search((candidates?.page ?? 1) - 1); }}>이전</button><span>{candidates?.page ?? 1} / {maxPage}</span><button className="btn btn-sm btn-ghost" type="button" disabled={locked || !candidates || candidates.page >= maxPage} onClick={() => { void search((candidates?.page ?? 1) + 1); }}>다음</button></div>
      </> : <>
        <div className="admin-shipping-settings__origin"><strong>{preview.origin.name} · 현재 출고지 정책</strong><p>기본 배송비 {shippingSettingsMoney(preview.origin.baseFee)} · {preview.origin.freeThreshold === null ? '무료 기준 없음' : `${shippingSettingsMoney(preview.origin.freeThreshold)} 이상 무료`} · 기본 택배사 {preview.origin.defaultCarrier ?? '미설정'}</p><p>반송 주소: {preview.origin.returnAddress || '미설정'}</p>
          <p>착불 수납 조건 {preview.origin.collectReady ? `준비됨${preview.origin.collectorName ? ` · ${preview.origin.collectorName}` : ''}` : '준비되지 않음'}</p></div>
        <p>{preview.goods.length}개 선택 상품의 출고지·기본 배송비·반품 및 교환 조건을 바꿉니다. {delivery.mode === 'preserve'
          ? '상품의 기존 수량별·착불 설정은 유지합니다. 사용 중인 수량별 배송비가 기본 배송비보다 우선합니다.'
          : '확장 배송비는 이 템플릿에 저장된 상태와 조건으로 변경합니다.'}</p>
        <p>묶음그룹은 {chargeGroup.mode === 'preserve' ? '현재 배정을 유지합니다.' : chargeGroup.mode === 'clear' ? '배정을 명시적으로 해제합니다.' : `${preview.targetGroup?.name ?? '선택한 그룹'}으로 지정합니다.`} 그룹에 지정된 상품은 실제 주문의 묶음 대상 수량·금액으로 함께 계산합니다.</p>
        <p>{preview.template.settings.fulfillment?.mode === 'replace' ? '선택한 상품의 수령 방식·운임·설치비·수령 안내를 이 템플릿으로 변경합니다. 기존 디지털 파일 연결은 새 주문에서 해제됩니다.' : '상품별 수령 방식·설치비·다운로드 파일·수령 안내는 유지합니다.'} 이미 확정된 주문의 수령 조건과 파일은 유지됩니다.</p>
        <p>기존 배송 안내문구와 주문에 확정된 배송비·회수 주소는 유지됩니다. 복수구매 할인과 합산군 구성은 변경하지 않으며 지역 추가료와 최종 운임은 주문 시 확인합니다.</p>
        {preview.goods.some(good => good.familyGoodIds.length > 1) ? <p>원상품의 출고지·기본 배송비와 확장 배송 정책은 합산군 전체의 배송비 계산에 사용됩니다. 수령 방식·반품 및 교환 안내·템플릿 연결은 직접 선택한 상품에 저장합니다.</p> : null}
        <div className="admin-shipping-settings__table"><table><caption>상품별 실제 배송비 규칙과 설정 변경 전후</caption><thead><tr><th>상품</th><th>변경 전</th><th>변경 후</th></tr></thead><tbody>{preview.goods.map(good => <tr key={good.id}>
          <th scope="row">{good.name}<small>{good.code}</small>{good.familyGoodIds.length > 1 ? <small>확장 배송 정책 공유 {good.familyGoodIds.length}개 상품</small> : null}{good.blocker ? <small>{blockerText[good.blocker]}{good.ownerGoodId !== good.id ? <Link href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.ownerGoodId)}`}> 원상품 확인</Link> : null}</small> : null}</th>
          <td><PolicySummary settings={good.before} effective={good.effectiveBefore} origins={origins} /></td><td><PolicySummary settings={good.after} effective={good.effectiveAfter} origins={origins} /></td>
        </tr>)}</tbody></table></div>
        {!preview.canApply ? <p role="alert" className="admin-shipping-settings__error">적용할 수 없는 상품이 있어 전체 적용을 중단했습니다. 표시된 조건을 확인하고 상품을 다시 선택해주세요.</p> : null}
        <p>미리보기 후 상품·원상품·템플릿·출고지·묶음그룹 배정과 버전 또는 착불·수령 조건이 바뀌면 전체 적용을 중단합니다.</p>
      </>}
      {pending || operation.busy ? <p role="status">처리 중입니다.</p> : null}
      {error || operation.error ? <p role="alert" className="admin-shipping-settings__error">{error || operation.error}</p> : null}
      {message || operation.message ? <p role="status">{message || operation.message}</p> : null}
      {operation.context ? <div className="admin-shipping-settings__origin"><strong>같은 요청의 결과를 먼저 확인해주세요.</strong><p>새로고침 후에도 요청번호만 남습니다. 조회 결과가 없으면 미처리 요청을 종료한 뒤 새 미리보기를 만드세요.</p>
        <div className="admin-shipping-settings__actions"><button className="btn" type="button" disabled={pending || operation.busy} onClick={() => { void operation.recover(); }}>저장 결과 확인</button>
          {operation.canRetry ? <button className="btn btn-ghost" type="button" disabled={pending || operation.busy} onClick={() => { void operation.retry(); }}>같은 입력으로 재시도</button> : null}
          <button className="btn btn-ghost" type="button" disabled={pending || operation.busy} onClick={() => { void operation.recover(true); }}>미처리 요청 종료</button></div></div> : null}
      <div className="admin-shipping-settings__actions">{preview ? <><button className="btn" type="button" disabled={locked || !preview.canApply || !applyInput} onClick={() => { if (!locked && applyInput) void operation.send(applyInput); }}>{preview.goods.length}개 상품에 적용</button>
        <button className="btn btn-ghost" type="button" disabled={locked} onClick={() => { setPreview(null); setApplyInput(null); setError(''); }}>상품 다시 선택</button></>
        : <button className="btn" type="button" disabled={locked || !selected.length} onClick={() => { void buildPreview(); }}>적용 미리보기</button>}
        <button className="btn btn-ghost" type="button" disabled={locked} onClick={close}>취소</button></div>
    </div>
  </CustomerServiceDialog>;
}

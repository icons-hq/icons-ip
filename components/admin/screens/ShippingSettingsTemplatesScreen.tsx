'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import { SHIPPING_SETTINGS_PATH, shippingSettingsFeeLabel, shippingSettingsHref, type ShippingSettingsIdentity, type ShippingSettingsListData, type ShippingSettingsOperationContext, type ShippingSettingsOperationReceipt, type ShippingSettingsTemplate } from '@/lib/admin/shipping-settings-templates';
import { ShippingSettingsTemplateForm } from './ShippingSettingsTemplateForm';
import { ShippingSettingsApplyDialog } from './ShippingSettingsApplyDialog';
import { ShippingSettingsFulfillmentDirective } from './ShippingSettingsFulfillmentFields';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { useShippingSettingsOperation, useShippingSettingsPending, useShippingSettingsSession, type ShippingSettingsScope } from './useShippingSettingsOperation';

function PendingOperation({ context, identity, scope, onReceipt }: { context: ShippingSettingsOperationContext; identity: ShippingSettingsIdentity;
  scope: ShippingSettingsScope; onReceipt: (receipt: ShippingSettingsOperationReceipt) => void }) {
  const operation = useShippingSettingsOperation({ identity, scope, templateId: context.templateId, command: context.command, onReceipt });
  return <div className="admin-shipping-settings__origin">
    <strong>미확정 {context.command === 'save' ? '템플릿 저장' : '상품 적용'} 요청</strong><p>입력 원문 없이 요청번호만 복구했습니다. 결과가 없으면 미처리 요청을 종료한 뒤 최신 내용으로 다시 진행해주세요.</p>
    <p>템플릿 {context.templateId} · 기준 버전 {context.expectedRevision}</p>
    <div className="admin-shipping-settings__actions"><button className="btn btn-sm" type="button" disabled={operation.busy} onClick={() => { void operation.recover(); }}>저장 결과 확인</button>
      <button className="btn btn-sm btn-ghost" type="button" disabled={operation.busy} onClick={() => { void operation.recover(true); }}>미처리 요청 종료</button></div>
    {operation.error ? <p role="alert">{operation.error}</p> : null}{operation.message ? <p role="status">{operation.message}</p> : null}
  </div>;
}
export function ShippingSettingsTemplatesScreen({ data, origins, regions, accountId, initialGoodIds = [] }: { data: ShippingSettingsListData; origins: GoodsFulfillmentOrigin[]; regions: GoodShippingRegionSummary[]; accountId: string; initialGoodIds?: string[] }) {
  const router = useRouter(), { identity, scope, blocked } = useShippingSettingsSession(accountId), pending = useShippingSettingsPending(identity);
  const identityKey = identity ? `${identity.expectedActorId}:${identity.expectedSessionId}` : '';
  const [editor, setEditor] = useState<{ owner: string; template?: ShippingSettingsTemplate; newId?: string } | null>(null);
  const [applying, setApplying] = useState<{ owner: string; template: ShippingSettingsTemplate } | null>(null), [message, setMessage] = useState('');
  const canEdit = Boolean(identity && !blocked && !pending.length);
  const withSelection = (href: string) => initialGoodIds.length ? `${href}${href.includes('?') ? '&' : '?'}goods=${encodeURIComponent(initialGoodIds.join(','))}` : href;
  return <section className="wc-admin-kit admin-shipping-settings">
    <AdminPageHeader title="배송정보 템플릿 관리" description="출고지·배송비·수령 방식·설치비·반품 및 교환 조건을 저장하고 선택한 상품에 적용합니다." actions={<button className="btn" type="button" disabled={!canEdit} onClick={() => { if (canEdit) { setMessage(''); setEditor({ owner: identityKey, newId: crypto.randomUUID() }); } }}>템플릿 등록</button>} />
    <nav className="admin-shipping-settings__links" aria-label="배송 설정 관련 관리"><Link href="/admin/settings/origins">출고지·배송정보 관리</Link><Link href="/admin/settings/shipping-regions">지역별 추가배송비 관리</Link><Link href="/admin/settings/shipping-notices">배송 안내 템플릿 관리</Link></nav>
    {initialGoodIds.length ? <p role="status">상품 목록에서 선택한 {initialGoodIds.length}개 상품에 적용할 템플릿을 선택해주세요. <Link href={SHIPPING_SETTINGS_PATH}>상품 선택 취소</Link></p> : null}
    <form action={SHIPPING_SETTINGS_PATH} className="admin-shipping-settings__filters">{initialGoodIds.length ? <input type="hidden" name="goods" value={initialGoodIds.join(',')} /> : null}<label htmlFor="shipping-template-query">템플릿 이름<input id="shipping-template-query" name="q" defaultValue={data.filters.query} maxLength={80} type="search" placeholder="템플릿 이름을 입력해주세요" /></label><label htmlFor="shipping-template-state">사용 여부<select id="shipping-template-state" name="state" defaultValue={data.filters.state}><option value="all">전체</option><option value="enabled">사용</option><option value="disabled">사용 안 함</option></select></label><button className="btn" type="submit">검색</button><Link className="btn btn-ghost" href={withSelection(SHIPPING_SETTINGS_PATH)}>초기화</Link></form>
    {message ? <p className="admin-shipping-settings__message" role="status">{message}</p> : null}
    {blocked ? <p role="alert">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 이 화면을 다시 열어주세요.</p> : null}
    {identity ? pending.map(context => <PendingOperation key={context.operationId} context={context} identity={identity} scope={scope} onReceipt={receipt => {
      setMessage(receipt.state === 'sealed' ? '미처리 요청을 종료했습니다. 최신 내용을 확인하고 다시 진행해주세요.'
        : receipt.state === 'saved' ? `‘${receipt.template?.name}’ 버전 ${receipt.template?.revision}의 저장 결과를 확인했습니다.` : `${receipt.appliedCount}개 상품의 적용 결과를 확인했습니다.`);
      router.refresh();
    }} />) : null}
    <div className="admin-shipping-settings__results"><div className="admin-shipping-settings__result-heading"><h2>배송정보 템플릿 <span>총 {data.total.toLocaleString('ko-KR')}개</span></h2><span>최근 수정순 · 20개씩 보기</span></div>
      <div className="admin-shipping-settings__table"><table><caption>배송정보 템플릿 목록</caption><thead><tr><th>템플릿 이름</th><th>사용 여부</th><th>출고지</th><th>저장된 배송비 조건</th><th>버전</th><th>관리</th></tr></thead><tbody>{data.rows.map(template => <tr key={template.id}><th scope="row">{template.name}</th><td>{template.enabled ? '사용' : '사용 안 함'}</td><td>{origins.find(origin => origin.id === template.settings.originId)?.name ?? '출고지 확인 필요'}</td>
        <td>{template.settings.delivery?.mode === 'replace' ? <ShippingSettingsDeliverySummary effective={{ ...template.settings, chargeGroup: undefined, fulfillment: undefined, delivery: template.settings.delivery.policy }} />
          : <>{shippingSettingsFeeLabel(template.settings)} · 기본 설정<small>상품의 기존 수량별·착불 설정 유지 · 실제 운임 규칙은 적용 미리보기에서 확인</small></>}
          <ShippingSettingsFulfillmentDirective value={template.settings.fulfillment} />
          <small>묶음그룹 {template.settings.chargeGroup?.mode === 'assign' ? '지정' : template.settings.chargeGroup?.mode === 'clear' ? '배정 해제' : '현재 배정 유지'}</small></td>
        <td>{template.revision}</td><td><div className="admin-shipping-settings__row-actions"><button className="btn btn-sm btn-ghost" type="button" disabled={!canEdit} onClick={() => { if (canEdit) setEditor({ owner: identityKey, template }); }}>조회/수정</button><button className="btn btn-sm" type="button" disabled={!template.enabled || !canEdit} onClick={() => { if (canEdit && template.enabled) setApplying({ owner: identityKey, template }); }}>상품 적용</button></div></td></tr>)}</tbody></table>{!data.rows.length ? <p className="admin-shipping-settings__empty">{data.filters.query || data.filters.state !== 'all' ? '조건에 맞는 템플릿이 없습니다.' : '등록된 템플릿이 없습니다. 배송 설정을 등록해주세요.'}</p> : null}</div>
      <ConsolePagination page={data.filters.page} pageSize={20} total={data.total} hrefForPage={page => withSelection(shippingSettingsHref(data.filters, page))} />
    </div>
    <p className="admin-shipping-settings__hint">템플릿 수정은 이미 적용한 상품에 자동 반영되지 않습니다. 현재 출고지 정책을 확인하고 적용 미리보기에서 변경 전·후를 비교해주세요.</p>
    {identity && editor?.owner === identityKey ? <ShippingSettingsTemplateForm key={`${identityKey}:${editor.template?.id ?? editor.newId}`} {...editor} identity={identity} scope={scope} origins={origins} regions={regions} onClose={() => setEditor(null)} onSaved={saved => { setEditor(null); setMessage(`‘${saved.name}’ 버전 ${saved.revision} 저장을 완료했습니다.`); router.refresh(); }} /> : null}
    {identity && applying?.owner === identityKey ? <ShippingSettingsApplyDialog key={`${identityKey}:${applying.template.id}`} template={applying.template} identity={identity} scope={scope} origins={origins} initialGoodIds={initialGoodIds} onClose={() => setApplying(null)} onApplied={count => { setApplying(null); setMessage(`${count}개 상품에 배송정보를 적용했습니다.`); router.refresh(); }} /> : null}
  </section>;
}

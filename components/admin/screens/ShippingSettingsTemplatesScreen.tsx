'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { AdminPageHeader, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, ConsoleFilterActions, ConsoleFilterField } from '@/components/admin/console/ConsoleFilterPanel';
import { CONSOLE_LIST_EMPTY_CLASS, CONSOLE_TABLE_FRAME_CLASS, ConsoleListCard, ConsoleTableHeader } from '@/components/admin/console/ConsoleListCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, FIELD_HINT, INFO_PANEL, NOTE } from '@/components/admin/settings-kit';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import { SHIPPING_SETTINGS_PATH, shippingSettingsFeeLabel, shippingSettingsHref, type ShippingSettingsIdentity, type ShippingSettingsListData, type ShippingSettingsOperationContext, type ShippingSettingsOperationReceipt, type ShippingSettingsTemplate } from '@/lib/admin/shipping-settings-templates';
import { ShippingSettingsTemplateForm } from './ShippingSettingsTemplateForm';
import { ShippingSettingsApplyDialog } from './ShippingSettingsApplyDialog';
import { ShippingSettingsFulfillmentDirective } from './ShippingSettingsFulfillmentFields';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { useShippingSettingsOperation, useShippingSettingsPending, useShippingSettingsSession, type ShippingSettingsScope } from './useShippingSettingsOperation';
import { StoreSettingsRelatedLinks } from './StoreSettingsRelatedLinks';

function PendingOperation({ context, identity, scope, onReceipt }: { context: ShippingSettingsOperationContext; identity: ShippingSettingsIdentity;
  scope: ShippingSettingsScope; onReceipt: (receipt: ShippingSettingsOperationReceipt) => void }) {
  const operation = useShippingSettingsOperation({ identity, scope, templateId: context.templateId, command: context.command, onReceipt });
  return <div className={INFO_PANEL}>
    <strong className="font-medium">미확정 {context.command === 'save' ? '템플릿 저장' : '상품 적용'} 요청</strong><p className="text-muted-foreground">입력 원문 없이 요청번호만 복구했습니다. 결과가 없으면 미처리 요청을 종료한 뒤 최신 내용으로 다시 진행해주세요.</p>
    <p className="text-muted-foreground tabular-nums">템플릿 {context.templateId} · 기준 버전 {context.expectedRevision}</p>
    <div className={ACTIONS}><Button disabled={operation.busy} onClick={() => { void operation.recover(); }} size="sm" type="button">저장 결과 확인</Button>
      <Button disabled={operation.busy} onClick={() => { void operation.recover(true); }} size="sm" type="button" variant="outline">미처리 요청 종료</Button></div>
    {operation.error ? <AdminNotice role="alert" tone="danger">{operation.error}</AdminNotice> : null}{operation.message ? <AdminNotice role="status" tone="neutral">{operation.message}</AdminNotice> : null}
  </div>;
}
export function ShippingSettingsTemplatesScreen({ data, origins, regions, accountId, initialGoodIds = [] }: { data: ShippingSettingsListData; origins: GoodsFulfillmentOrigin[]; regions: GoodShippingRegionSummary[]; accountId: string; initialGoodIds?: string[] }) {
  const router = useRouter(), { identity, scope, blocked } = useShippingSettingsSession(accountId), pending = useShippingSettingsPending(identity);
  const identityKey = identity ? `${identity.expectedActorId}:${identity.expectedSessionId}` : '';
  const [editor, setEditor] = useState<{ owner: string; template?: ShippingSettingsTemplate; newId?: string } | null>(null);
  const [applying, setApplying] = useState<{ owner: string; template: ShippingSettingsTemplate } | null>(null), [message, setMessage] = useState('');
  const canEdit = Boolean(identity && !blocked && !pending.length);
  const withSelection = (href: string) => initialGoodIds.length ? `${href}${href.includes('?') ? '&' : '?'}goods=${encodeURIComponent(initialGoodIds.join(','))}` : href;
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="shipping-templates">
    <AdminPageHeader title="배송정보 템플릿 관리" description="출고지·배송비·수령 방식·설치비·반품 및 교환 조건을 저장하고 선택한 상품에 적용합니다." actions={<Button disabled={!canEdit} onClick={() => { if (canEdit) { setMessage(''); setEditor({ owner: identityKey, newId: crypto.randomUUID() }); } }} type="button"><Plus aria-hidden="true" />템플릿 등록</Button>} />
    <StoreSettingsRelatedLinks label="배송 설정 관련 관리" links={[{ href: '/admin/settings/origins', label: '출고지·배송정보 관리' }, { href: '/admin/settings/shipping-regions', label: '지역별 추가배송비 관리' }, { href: '/admin/settings/shipping-notices', label: '배송 안내 템플릿 관리' }]} />
    {initialGoodIds.length ? <AdminNotice role="status" tone="neutral">상품 목록에서 선택한 {initialGoodIds.length}개 상품에 적용할 템플릿을 선택해주세요. <Link className="font-medium underline underline-offset-4" href={SHIPPING_SETTINGS_PATH}>상품 선택 취소</Link></AdminNotice> : null}
    <form action={SHIPPING_SETTINGS_PATH} className={CONSOLE_FILTER_CARD_CLASS}>{initialGoodIds.length ? <input type="hidden" name="goods" value={initialGoodIds.join(',')} /> : null}
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <ConsoleFilterField className="min-w-[min(100%,18rem)] flex-1" htmlFor="shipping-template-query" label="템플릿 이름"><Input id="shipping-template-query" name="q" defaultValue={data.filters.query} maxLength={80} type="search" placeholder="템플릿 이름을 입력해주세요" /></ConsoleFilterField>
        <ConsoleFilterField htmlFor="shipping-template-state" label="사용 여부"><NativeSelect className="w-36" id="shipping-template-state" name="state" defaultValue={data.filters.state}><option value="all">전체</option><option value="enabled">사용</option><option value="disabled">사용 안 함</option></NativeSelect></ConsoleFilterField>
      </div>
      <ConsoleFilterActions><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={withSelection(SHIPPING_SETTINGS_PATH)}>초기화</Link><button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit">검색</button></ConsoleFilterActions>
    </form>
    {message ? <AdminNotice role="status" tone="neutral">{message}</AdminNotice> : null}
    {blocked ? <AdminNotice role="alert" tone="danger">로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 이 화면을 다시 열어주세요.</AdminNotice> : null}
    {identity ? pending.map(context => <PendingOperation key={context.operationId} context={context} identity={identity} scope={scope} onReceipt={receipt => {
      setMessage(receipt.state === 'sealed' ? '미처리 요청을 종료했습니다. 최신 내용을 확인하고 다시 진행해주세요.'
        : receipt.state === 'saved' ? `‘${receipt.template?.name}’ 버전 ${receipt.template?.revision}의 저장 결과를 확인했습니다.` : `${receipt.appliedCount}개 상품의 적용 결과를 확인했습니다.`);
      router.refresh();
    }} />) : null}
    <ConsoleListCard data-shipping-templates="" description="별도 표시가 없으면 상품의 기존 수량별·착불 설정, 수령 방식·파일, 묶음그룹 배정을 그대로 유지합니다. 실제 운임 규칙은 적용 미리보기에서 확인합니다." title="배송정보 템플릿" total={data.total} unit="개" actions={<span className="text-xs text-muted-foreground">최근 수정순 · 20개씩 보기</span>}>
      <div aria-label="배송정보 템플릿 목록 가로 스크롤" className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" tabIndex={0}>
        <Table className="min-w-[42.5rem]"><caption className="sr-only">배송정보 템플릿 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>템플릿 이름</TableHead><TableHead>사용 여부</TableHead><TableHead>출고지</TableHead><TableHead>저장된 배송비 조건</TableHead><TableHead>버전</TableHead><TableHead>관리</TableHead></TableRow></ConsoleTableHeader><TableBody>{data.rows.map(template => <TableRow key={template.id}><TableHead className="h-auto bg-transparent py-3 align-top text-sm font-semibold whitespace-normal text-foreground" scope="row">{template.name}</TableHead><TableCell className="align-top"><AdminStatusBadge tone={statusTone('setting', template.enabled ? 'active' : 'inactive')}>{template.enabled ? '사용' : '사용 안 함'}</AdminStatusBadge></TableCell><TableCell className="align-top whitespace-normal">{origins.find(origin => origin.id === template.settings.originId)?.name ?? '출고지 확인 필요'}</TableCell>
          {/* 줄마다 같은 '기본값 유지' 문장을 반복하지 않고(표 위 안내 한 줄), 이 템플릿이 실제로 바꾸는 것만 적는다. */}
          <TableCell className="min-w-56 align-top whitespace-normal">{template.settings.delivery?.mode === 'replace' ? <ShippingSettingsDeliverySummary effective={{ ...template.settings, chargeGroup: undefined, fulfillment: undefined, delivery: template.settings.delivery.policy }} />
            : <span className="font-medium">{shippingSettingsFeeLabel(template.settings)}</span>}
            {template.settings.fulfillment?.mode === 'replace' ? <ShippingSettingsFulfillmentDirective value={template.settings.fulfillment} /> : null}
            {template.settings.chargeGroup && template.settings.chargeGroup.mode !== 'preserve' ? <small className={`mt-1 block ${FIELD_HINT}`}>묶음그룹 {template.settings.chargeGroup.mode === 'assign' ? '지정' : '배정 해제'}</small> : null}</TableCell>
          <TableCell className="align-top tabular-nums">{template.revision}</TableCell><TableCell className="align-top"><div className="flex flex-nowrap items-center gap-1.5"><Button disabled={!canEdit} onClick={() => { if (canEdit) setEditor({ owner: identityKey, template }); }} size="xs" type="button" variant="outline">조회/수정</Button><Button disabled={!template.enabled || !canEdit} onClick={() => { if (canEdit && template.enabled) setApplying({ owner: identityKey, template }); }} size="xs" type="button" variant="soft">상품 적용</Button></div></TableCell></TableRow>)}</TableBody></Table>
        {!data.rows.length ? <p className={CONSOLE_LIST_EMPTY_CLASS}>{data.filters.query || data.filters.state !== 'all' ? '조건에 맞는 템플릿이 없습니다.' : '등록된 템플릿이 없습니다. 배송 설정을 등록해주세요.'}</p> : null}
      </div>
      <ConsolePagination page={data.filters.page} pageSize={20} total={data.total} hrefForPage={page => withSelection(shippingSettingsHref(data.filters, page))} />
    </ConsoleListCard>
    <p className={NOTE}>템플릿 수정은 이미 적용한 상품에 자동 반영되지 않습니다. 현재 출고지 정책을 확인하고 적용 미리보기에서 변경 전·후를 비교해주세요.</p>
    {identity && editor?.owner === identityKey ? <ShippingSettingsTemplateForm key={`${identityKey}:${editor.template?.id ?? editor.newId}`} {...editor} identity={identity} scope={scope} origins={origins} regions={regions} onClose={() => setEditor(null)} onSaved={saved => { setEditor(null); setMessage(`‘${saved.name}’ 버전 ${saved.revision} 저장을 완료했습니다.`); router.refresh(); }} /> : null}
    {identity && applying?.owner === identityKey ? <ShippingSettingsApplyDialog key={`${identityKey}:${applying.template.id}`} template={applying.template} identity={identity} scope={scope} origins={origins} initialGoodIds={initialGoodIds} onClose={() => setApplying(null)} onApplied={count => { setApplying(null); setMessage(`${count}개 상품에 배송정보를 적용했습니다.`); router.refresh(); }} /> : null}
  </div>;
}

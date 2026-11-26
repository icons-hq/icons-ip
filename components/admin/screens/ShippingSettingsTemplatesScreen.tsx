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
import { ACTIONS, FIELD_HINT } from '@/components/admin/settings-kit';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { GoodShippingRegionSummary } from '@/lib/admin/good-shipping-summary';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, templateSavedNotice } from '@/lib/admin/goods-template-save';
import { kstDateTimeText } from '@/lib/admin/list-export';
import {
  SHIPPING_SETTINGS_GOOD_LIMIT, SHIPPING_SETTINGS_PATH, shippingSettingsExtraChanges, shippingSettingsFeeText, shippingSettingsHref, shippingSettingsRuntimeBlocked, type ShippingSettingsIdentity, type ShippingSettingsListData,
  type ShippingSettingsOperationContext, type ShippingSettingsOperationReceipt, type ShippingSettingsSkipped, type ShippingSettingsTemplate,
} from '@/lib/admin/shipping-settings-templates';
import { ShippingSettingsTemplateForm } from './ShippingSettingsTemplateForm';
import { ShippingSettingsApplyDialog } from './ShippingSettingsApplyDialog';
import { ShippingSettingsFulfillmentDirective } from './ShippingSettingsFulfillmentFields';
import { ShippingSettingsDeliverySummary } from './ShippingSettingsDeliverySummary';
import { SHIPPING_SETTINGS_STOP_LABEL, useShippingSettingsOperation, useShippingSettingsPending, useShippingSettingsSession, type ShippingSettingsScope } from './useShippingSettingsOperation';
import { StoreSettingsRelatedLinks } from './StoreSettingsRelatedLinks';

/** 저장·적용을 누른 뒤 결과를 받지 못한 채 화면을 새로 연 경우. 적었던 내용은 남아 있지 않고, 됐는지 확인하거나 그만둘 수만 있다. */
function PendingOperation({ context, name, identity, scope, onReceipt }: { context: ShippingSettingsOperationContext; name: string | undefined; identity: ShippingSettingsIdentity;
  scope: ShippingSettingsScope; onReceipt: (receipt: ShippingSettingsOperationReceipt) => void }) {
  const operation = useShippingSettingsOperation({ identity, scope, templateId: context.templateId, command: context.command, onReceipt });
  return <AdminNotice role="alert" tone="warning">
    <p><strong className="font-medium">{name ? `‘${name}’ 템플릿` : '템플릿'}을 {context.command === 'save' ? '저장' : '상품에 적용'}하던 중이었습니다.</strong> {SAVE_UNKNOWN_MESSAGE}</p>
    {operation.error ? <p className="mt-1 text-destructive">{operation.error}</p> : null}{operation.message ? <p className="mt-1">{operation.message}</p> : null}
    <div className={`${ACTIONS} mt-2`}><Button disabled={operation.busy} onClick={() => { void operation.check(); }} size="sm" type="button">{SAVE_CHECK_LABEL}</Button>
      <Button disabled={operation.busy} onClick={() => { void operation.recover(true); }} size="sm" type="button" variant="outline">{SHIPPING_SETTINGS_STOP_LABEL}</Button></div>
  </AdminNotice>;
}
/** 저장·적용 뒤 목록 위에 보이는 결과. `templateId`가 있으면(저장) 그 템플릿을 쓰던 상품에 다시 적용하는 길을 함께 보인다. */
type Result = { text: string; templateId?: string; skipped?: ShippingSettingsSkipped[] };

/*
 * 배송정보 템플릿 관리(/admin/settings/shipping-templates): 목록 + [수정] 창 + [상품에 적용] 창. 사이즈·A/S·이벤트 템플릿 관리와 같은 모양이다.
 * 템플릿을 고쳐도 이미 적용한 상품은 바뀌지 않는다 — 그런 상품이 몇 개인지 줄에 보이고 [다시 적용]으로 바로 맞춘다.
 * 조회 조건은 주소(?q=&state=&page=)가 진실원이다.
 */
export function ShippingSettingsTemplatesScreen({ data, origins, regions, accountId, initialGoodIds = [], runtimeEnabled = null }: {
  data: ShippingSettingsListData; origins: GoodsFulfillmentOrigin[]; regions: GoodShippingRegionSummary[]; accountId: string; initialGoodIds?: string[];
  /** 쇼핑몰 주문 설정이 켜져 있는가(적용할 수 없는 템플릿을 미리 막는 데 쓴다). 읽지 못했으면 null. */
  runtimeEnabled?: boolean | null;
}) {
  const router = useRouter(), { identity, scope, blocked } = useShippingSettingsSession(accountId), pending = useShippingSettingsPending(identity);
  const identityKey = identity ? `${identity.expectedActorId}:${identity.expectedSessionId}` : '';
  const [editor, setEditor] = useState<{ owner: string; template?: ShippingSettingsTemplate; newId?: string } | null>(null);
  const [applying, setApplying] = useState<{ owner: string; template: ShippingSettingsTemplate; reapply?: boolean } | null>(null), [result, setResult] = useState<Result | null>(null);
  const canEdit = Boolean(identity && !blocked && !pending.length);
  const withSelection = (href: string) => initialGoodIds.length ? `${href}${href.includes('?') ? '&' : '?'}goods=${encodeURIComponent(initialGoodIds.join(','))}` : href;
  /* [상품에 적용]을 누를 수 없는 까닭(없으면 null). 못 누르는 버튼을 까닭 없이 흐리게만 두지 않는다(화면 규칙 5). */
  const applyBlocked = (template: ShippingSettingsTemplate): string | null => {
    if (!template.enabled) return "'사용'으로 바꿔야 적용할 수 있습니다";
    const origin = origins.find(item => item.id === template.settings.originId);
    if (origin && !origin.active) return '출고지가 사용 안 함이라 적용할 수 없습니다';
    const names = runtimeEnabled === false ? shippingSettingsRuntimeBlocked(template.settings) : [];
    return names.length ? `지금 쇼핑몰 설정에서는 적용할 수 없습니다. [수정]에서 함께 바꾸는 것(${names.join(', ')})을 끄면 적용할 수 있습니다` : null;
  };
  const open = (template: ShippingSettingsTemplate, reapply = false) => { if (canEdit && !applyBlocked(template)) { setResult(null); setApplying({ owner: identityKey, template, reapply }); } };
  const resultTemplate = result?.templateId ? data.rows.find(row => row.id === result.templateId) : undefined;
  const resultOutdated = resultTemplate ? data.usage?.[resultTemplate.id]?.outdated ?? 0 : 0;
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="shipping-templates">
    <AdminPageHeader title="배송정보 템플릿 관리" description="출고지·배송비·반품 조건을 묶어 두고 여러 상품에 한 번에 넣는 설정입니다." actions={<Button disabled={!canEdit} onClick={() => { if (canEdit) { setResult(null); setEditor({ owner: identityKey, newId: crypto.randomUUID() }); } }} type="button"><Plus aria-hidden="true" />템플릿 등록</Button>} />
    <StoreSettingsRelatedLinks label="배송 설정 관련 관리" links={[{ href: '/admin/settings/origins', label: '배송정보 관리' }, { href: '/admin/settings/shipping-regions', label: '지역별 추가배송비 관리' }, { href: '/admin/settings/shipping-notices', label: '배송 안내 템플릿 관리' }]} />
    {initialGoodIds.length ? <AdminNotice role="status" tone="neutral">상품 목록에서 고른 상품 {initialGoodIds.length}개에 넣을 템플릿의 [상품에 적용]을 눌러 주세요. <Link className="font-medium underline underline-offset-4" href={SHIPPING_SETTINGS_PATH}>고른 상품 풀기</Link></AdminNotice> : null}
    <form action={SHIPPING_SETTINGS_PATH} className={CONSOLE_FILTER_CARD_CLASS}>{initialGoodIds.length ? <input type="hidden" name="goods" value={initialGoodIds.join(',')} /> : null}
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <ConsoleFilterField className="min-w-[min(100%,18rem)] flex-1" htmlFor="shipping-template-query" label="템플릿 이름 검색"><Input id="shipping-template-query" name="q" defaultValue={data.filters.query} maxLength={80} type="search" /></ConsoleFilterField>
        <ConsoleFilterField htmlFor="shipping-template-state" label="사용 여부"><NativeSelect className="w-36" id="shipping-template-state" name="state" defaultValue={data.filters.state}><option value="all">전체</option><option value="enabled">사용</option><option value="disabled">사용 안 함</option></NativeSelect></ConsoleFilterField>
      </div>
      <ConsoleFilterActions><Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={withSelection(SHIPPING_SETTINGS_PATH)}>초기화</Link><button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit">검색</button></ConsoleFilterActions>
    </form>
    {result ? <div className="flex min-w-0 flex-col gap-1.5 text-sm" data-goods-template-notice="" role="status">
      <p>{result.text}</p>
      {resultTemplate && resultOutdated ? <p className={`${ACTIONS} text-muted-foreground`}>이 템플릿을 쓰는 상품 {resultOutdated.toLocaleString('ko-KR')}개는 고치기 전 내용 그대로입니다.
        <Button disabled={!canEdit || Boolean(applyBlocked(resultTemplate))} onClick={() => open(resultTemplate, true)} size="sm" type="button" variant="outline">{Math.min(resultOutdated, SHIPPING_SETTINGS_GOOD_LIMIT).toLocaleString('ko-KR')}개 상품에 다시 적용</Button></p> : null}
      {result.skipped?.length ? <div data-shipping-skipped=""><p>건너뛴 상품 {result.skipped.length}개</p>
        <ul className="m-0 list-disc pl-5 text-muted-foreground">{result.skipped.map(item => <li key={item.id}>{item.name} — {item.reason}</li>)}</ul></div> : null}
    </div> : null}
    {blocked ? <AdminNotice role="alert" tone="danger">로그인 계정이 바뀌었거나 로그인이 끊겼습니다. 지금 로그인한 계정으로 이 화면을 새로고침해 주세요.</AdminNotice> : null}
    {identity ? pending.map(context => <PendingOperation key={context.operationId} context={context} name={data.rows.find(row => row.id === context.templateId)?.name} identity={identity} scope={scope} onReceipt={receipt => {
      setResult({ text: receipt.state === 'sealed' ? '그만뒀습니다. 지금 저장된 내용을 확인하고 처음부터 다시 해 주세요.'
        : receipt.state === 'saved' ? `‘${receipt.template?.name}’ 템플릿은 저장돼 있습니다.` : `상품 ${receipt.appliedCount}개에 적용돼 있습니다.` });
      router.refresh();
    }} />) : null}
    <ConsoleListCard data-shipping-templates="" title="배송정보 템플릿" total={data.total} unit="개" actions={<span className="text-xs text-muted-foreground">최근 수정순 · 20개씩 보기</span>}>
      <div aria-label="배송정보 템플릿 목록 가로 스크롤" className={`${CONSOLE_TABLE_FRAME_CLASS} [&>[data-slot=table-container]]:overflow-visible`} role="region" tabIndex={0}>
        <Table className="min-w-[52rem]"><caption className="sr-only">배송정보 템플릿 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>템플릿 이름</TableHead><TableHead>사용 여부</TableHead><TableHead>출고지</TableHead><TableHead>배송비</TableHead><TableHead>적용 상품</TableHead><TableHead>수정일</TableHead><TableHead>관리</TableHead></TableRow></ConsoleTableHeader><TableBody>{data.rows.map(template => {
          const origin = origins.find(item => item.id === template.settings.originId), usage = data.usage?.[template.id];
          const extras = shippingSettingsExtraChanges(template.settings), reason = applyBlocked(template);
          return <TableRow key={template.id}><TableHead className="h-auto bg-transparent py-3 align-top text-sm font-semibold whitespace-normal text-foreground" scope="row">{template.name}</TableHead>
            <TableCell className="align-top"><AdminStatusBadge tone={statusTone('setting', template.enabled ? 'active' : 'inactive')}>{template.enabled ? '사용' : '사용 안 함'}</AdminStatusBadge></TableCell>
            <TableCell className="align-top whitespace-normal">{origin ? `${origin.name}${origin.active ? '' : ' · 사용 안 함'}` : '출고지 확인 필요'}</TableCell>
            {/* 이 템플릿을 쓴 상품이 내는 배송비와, 템플릿이 함께 바꾸는 것만 적는다(바꾸지 않는 것은 적지 않는다). */}
            <TableCell className="min-w-56 align-top whitespace-normal">{template.settings.delivery?.mode === 'replace' ? <ShippingSettingsDeliverySummary effective={{ ...template.settings, chargeGroup: undefined, fulfillment: undefined, delivery: template.settings.delivery.policy }} origin={origin} />
              : <span className="font-medium">{shippingSettingsFeeText(template.settings, origin)}</span>}
              {extras.length ? <small className={`mt-1 block ${FIELD_HINT}`} data-shipping-template-extras="">함께 바꾸는 것: {extras.join(', ')}</small> : null}
              {template.settings.fulfillment?.mode === 'replace' ? <div className={`mt-1 ${FIELD_HINT}`}><ShippingSettingsFulfillmentDirective value={template.settings.fulfillment} /></div> : null}</TableCell>
            <TableCell className="align-top whitespace-normal tabular-nums" data-shipping-template-usage="">{usage ? <>{usage.applied.toLocaleString('ko-KR')}개
              {usage.outdated ? <div className="mt-1 flex flex-col items-start gap-1"><small className={FIELD_HINT}>{usage.outdated.toLocaleString('ko-KR')}개는 고치기 전 내용</small>
                <Button disabled={!canEdit || Boolean(reason)} onClick={() => open(template, true)} size="xs" type="button" variant="outline">다시 적용</Button></div> : null}</> : '—'}</TableCell>
            <TableCell className="align-top tabular-nums">{kstDateTimeText(template.updatedAt).replaceAll('-', '.')}</TableCell>
            <TableCell className="align-top whitespace-normal"><div className="flex flex-nowrap items-center gap-1.5"><Button disabled={!canEdit} onClick={() => { if (canEdit) { setResult(null); setEditor({ owner: identityKey, template }); } }} size="xs" type="button" variant="outline">수정</Button><Button disabled={!canEdit || Boolean(reason)} onClick={() => open(template)} size="xs" type="button" variant={initialGoodIds.length ? 'soft' : 'outline'}>상품에 적용</Button></div>
              {reason ? <small className={`mt-1 block max-w-56 ${FIELD_HINT}`} data-shipping-apply-blocked="">{reason}</small> : null}</TableCell></TableRow>;
        })}</TableBody></Table>
        {!data.rows.length ? <p className={CONSOLE_LIST_EMPTY_CLASS}>{data.filters.query || data.filters.state !== 'all' ? '조건에 맞는 템플릿이 없습니다.' : '등록된 템플릿이 없습니다. [템플릿 등록]으로 만들어 주세요.'}</p> : null}
      </div>
      <ConsolePagination page={data.filters.page} pageSize={20} total={data.total} hrefForPage={page => withSelection(shippingSettingsHref(data.filters, page))} />
    </ConsoleListCard>
    {identity && editor?.owner === identityKey ? <ShippingSettingsTemplateForm key={`${identityKey}:${editor.template?.id ?? editor.newId}`} {...editor} identity={identity} scope={scope} origins={origins} regions={regions} runtimeEnabled={runtimeEnabled}
      onClose={refresh => { setEditor(null); if (refresh) router.refresh(); }} onSaved={saved => { setEditor(null); setResult({ text: templateSavedNotice('saved'), templateId: saved.id }); router.refresh(); }} /> : null}
    {identity && applying?.owner === identityKey ? <ShippingSettingsApplyDialog key={`${identityKey}:${applying.template.id}:${applying.reapply ? 'reapply' : 'pick'}`} template={applying.template} identity={identity} scope={scope} origins={origins}
      initialGoodIds={applying.reapply ? [] : initialGoodIds} reapply={Boolean(applying.reapply)} onClose={() => setApplying(null)}
      onApplied={(count, skipped) => { setApplying(null); setResult({ text: `상품 ${count}개에 ‘${applying.template.name}’ 템플릿을 적용했습니다.`, skipped }); router.refresh(); }} /> : null}
  </div>;
}

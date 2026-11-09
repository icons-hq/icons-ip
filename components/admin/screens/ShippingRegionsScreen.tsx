'use client';

import { useState, useTransition } from 'react';
import { ChevronRight } from 'lucide-react';
import { saveShippingRegionPolicyAction, setShippingRegionPolicyStatusAction } from '@/app/admin/shipping-region-actions';
import { AdminPageHeader, AdminSectionCard, AdminNotice, AdminStatusBadge } from '../console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import {
  emptyShippingRegionPolicy, parseShippingRegionPolicyInput, parseShippingRegionRulesTsv, REGION_DISPOSITION_LABELS, shippingRegionPolicyProblems,
  shippingRegionRulesTsv, type ShippingRegionPolicy, type ShippingRegionPolicyInput,
} from '@/lib/admin/shipping-regions';
import type { ShippingRegionAdoption } from '@/lib/admin/shipping-regions.server';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { CHECK_LABEL, CHECK_LABEL_TOP, FIELD_LABEL, NOTE, TABLE_BOX, TSV_TEXTAREA } from '@/components/admin/settings-kit';
import { StoreSettingsRelatedLinks } from './StoreSettingsRelatedLinks';

const POLICY_EDITOR_ID = 'shipping-region-policy-editor';
/* 저장·확정 버튼 줄. 입력이 길어도 화면 바닥에 남아 초안을 끝내는 길이 보인다. */
const STICKY_ACTIONS = 'sticky bottom-0 z-10 flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm';

function koreaInput(value: string | null): string { return value ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16) : ''; }
function fromKoreaInput(value: string): string | null { return value ? new Date(`${value}:00+09:00`).toISOString() : null; }
function yesNo(value: boolean | null): string { return value === null ? '' : value ? 'yes' : 'no'; }
function fromYesNo(value: string): boolean | null { return value === '' ? null : value === 'yes'; }
const STATUS_LABELS = { draft: '초안', active: '활성', retired: '중단' };

function ShippingRegionEditor({ policy, initialCopy, origins, carriers, canEdit, onSaved }: {
  policy: ShippingRegionPolicy | null; origins: GoodsFulfillmentOrigin[]; carriers: EditableCarrier[]; canEdit: boolean;
  initialCopy?: ShippingRegionPolicyInput | null;
  onSaved: (policy: ShippingRegionPolicy, message: string) => void;
}) {
  const [input, setInput] = useState<ShippingRegionPolicyInput>(() => parseShippingRegionPolicyInput(policy) ?? initialCopy ?? emptyShippingRegionPolicy());
  const [tsv, setTsv] = useState(() => shippingRegionRulesTsv(policy?.rules ?? initialCopy?.rules ?? []));
  const [attested, setAttested] = useState(false); const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = parseShippingRegionRulesTsv(tsv, policy?.rules);
  const current = { ...input, rules: parsed.rules ?? input.rules };
  const problems = parsed.error ? [parsed.error] : shippingRegionPolicyProblems(current);
  const readOnly = !canEdit || (policy !== null && policy.status !== 'draft');
  const dirty = policy === null || JSON.stringify(current) !== JSON.stringify(parseShippingRegionPolicyInput(policy));
  function change(patch: Partial<ShippingRegionPolicyInput>) { setInput({ ...input, ...patch }); setAttested(false); }
  function save() {
    if (parsed.error) { setError(parsed.error); return; }
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveShippingRegionPolicyAction(policy?.id ?? null, policy?.revision ?? null, current);
        if (result.ok) onSaved(result.policy, result.message); else setError(result.error);
      } catch { setError('저장하지 못했습니다. 현재 입력은 유지됩니다.'); }
    });
  }
  function setStatus(status: 'active' | 'retired') {
    if (!policy) return; setError(null);
    startTransition(async () => {
      try {
        const result = await setShippingRegionPolicyStatusAction(policy.id, policy.revision, status, attested);
        if (result.ok) onSaved(result.policy, result.message); else setError(result.error);
      } catch { setError('정책 상태를 변경하지 못했습니다. 다시 시도해주세요.'); }
    });
  }
  function booleanField(key: 'chargePolicyGoods' | 'waivePolicyThreshold' | 'chargeFreeGoods' | 'chargeIndividualGoods', label: string) {
    return <label className={FIELD_LABEL}>{label}<NativeSelect className="w-full" value={yesNo(input[key])} onChange={(event) => change({ [key]: fromYesNo(event.target.value) })}>
      <option value="">미확인</option><option value="yes">예</option><option value="no">아니요</option>
    </NativeSelect></label>;
  }
  return <div className="flex min-w-0 flex-col gap-4" data-region-editor="">
    {canEdit && policy?.status === 'draft' ? <AdminNotice title="이 초안을 확정하는 순서" tone="info">내용을 고쳤다면 먼저 초안 저장 → 저장된 내용과 원본 일치 확인 체크 → 저장된 정책 활성화를 눌러주세요.</AdminNotice> : null}
    <fieldset disabled={pending || readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <legend className="sr-only">지역 배송 정책 입력</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13.75rem),1fr))] gap-3">
        <label className={FIELD_LABEL}>출고지<NativeSelect className="w-full" value={input.originId} disabled={Boolean(policy)} onChange={(event) => change({ originId: event.target.value })}>
          <option value="">선택해주세요</option>{origins.map((origin) => <option key={origin.id} value={origin.id}>{origin.name}{origin.active ? '' : ' · 비활성'}</option>)}
        </NativeSelect></label>
        <label className={FIELD_LABEL}>계약 택배사<NativeSelect className="w-full" value={input.carrierCode} disabled={Boolean(policy)} onChange={(event) => change({ carrierCode: event.target.value })}>
          <option value="">선택해주세요</option>{carriers.map((carrier) => <option key={carrier.code} value={carrier.code}>{carrier.label}{carrier.active ? '' : ' · 비활성'}</option>)}
        </NativeSelect></label>
        <label className={FIELD_LABEL}>정책 이름<Input value={input.name} maxLength={100} onChange={(event) => change({ name: event.target.value })} /></label>
        <label className={FIELD_LABEL}>적용 시작 · 한국 시각<Input type="datetime-local" value={koreaInput(input.startsAt)} onChange={(event) => change({ startsAt: fromKoreaInput(event.target.value) })} /></label>
        <label className={FIELD_LABEL}>적용 종료 방식<NativeSelect className="w-full" value={yesNo(input.openEnded)} onChange={(event) => {
          const openEnded = fromYesNo(event.target.value); change({ openEnded, ...(openEnded ? { endsAt: null } : {}) });
        }}><option value="">미확인</option><option value="yes">무기한</option><option value="no">종료 일시 지정</option></NativeSelect></label>
        <label className={FIELD_LABEL}>적용 종료 · 한국 시각<Input type="datetime-local" disabled={input.openEnded === true} value={koreaInput(input.endsAt)}
          onChange={(event) => change({ endsAt: fromKoreaInput(event.target.value) })} /></label>
      </div>
      <label className={FIELD_LABEL}>물류사 원본 회신·계약 근거<Textarea rows={3} maxLength={2000} value={input.sourceEvidence}
        onChange={(event) => change({ sourceEvidence: event.target.value })} /></label>
      <p className={NOTE}>실제 회신·계약을 찾을 수 있는 사내 문서번호나 접근 제한 문서 주소를 입력하세요. 근거 참조는 고객에게 공개되지 않습니다.</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3">
        <label className={FIELD_LABEL}>표에 없는 지역<NativeSelect className="w-full" value={input.unlistedDisposition ?? ''} onChange={(event) => change({ unlistedDisposition: (event.target.value || null) as ShippingRegionPolicyInput['unlistedDisposition'] })}>
          <option value="">미확인</option><option value="standard">추가료 없음</option><option value="manual_review">개별 확인 필요</option>
        </NativeSelect></label>
        <label className={FIELD_LABEL}>추가료 부과 단위<NativeSelect className="w-full" value={input.feeUnit ?? ''} onChange={(event) => change({ feeUnit: (event.target.value || null) as ShippingRegionPolicyInput['feeUnit'] })}>
          <option value="">미확인</option><option value="per_shipment">출고지 배송 건당 한 번</option><option value="per_good">대상 상품당 한 번 · 옵션·수량 무관</option>
        </NativeSelect></label>
        {booleanField('chargePolicyGoods', '정책 배송비 상품에 지역 추가료 부과')}
        {booleanField('waivePolicyThreshold', '무료 기준 금액을 채운 정책 상품은 지역료 면제')}
        {booleanField('chargeFreeGoods', '무료배송 상품에 지역 추가료 부과')}
        {booleanField('chargeIndividualGoods', '개별 배송비 상품에 지역 추가료 부과')}
      </div>
      <label className={FIELD_LABEL}>지역표 · 스프레드시트의 6개 열을 붙여넣기<Textarea className={TSV_TEXTAREA} rows={9} value={tsv} maxLength={500000}
        spellCheck={false} onChange={(event) => { setTsv(event.target.value); setAttested(false); }} /></label>
      <p className={NOTE}>우편번호 시작·끝은 5자리이며 양 끝을 포함합니다. 주소 시작문구는 공백을 정리한 기본주소의 시작 부분과 단어 경계가 정확히 일치해야 합니다.
        처리 열은 ‘추가료 없음’, ‘추가료 부과’, ‘배송 불가’, ‘개별 확인 필요’ 중 하나입니다. 추가료 부과 행에만 원 단위 정수를 입력하며, 0원도 명시해야 합니다. 최대 1,000행입니다.</p>
      <label className={CHECK_LABEL}><input type="checkbox" checked={input.noRulesConfirmed} onChange={(event) => change({ noRulesConfirmed: event.target.checked })} />
        실제 회신에 예외 지역이 없으며 지역표가 비어 있음을 확인했습니다.</label>
    </fieldset>
    <details className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"><summary className="cursor-pointer font-medium">지역표·고객 안내 미리보기 · {parsed.rules?.length ?? 0}행</summary>
      <p className={`mt-2 ${NOTE}`}>배송비는 아래 판정과 실제 주문의 무료·묶음 적용 기준을 함께 계산합니다. 배송 불가·개별 확인 필요 주소는 결제할 수 없습니다.</p>
      {parsed.rules?.length ? <div className={`mt-3 ${TABLE_BOX}`}><Table className="min-w-[40rem]">
        <caption className="sr-only">지역 추가 배송비 적용 구간</caption>
        <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead scope="col">우편번호</TableHead><TableHead scope="col">기본주소 시작</TableHead><TableHead scope="col">고객 지역명</TableHead><TableHead scope="col">처리</TableHead><TableHead className="text-right" scope="col">계약 추가료</TableHead></TableRow></TableHeader>
        <TableBody>{parsed.rules.slice(0, 50).map((rule, index) => <TableRow key={rule.id ?? index}><TableCell className="tabular-nums">{rule.postalFrom || '미입력'}~{rule.postalTo || '미입력'}</TableCell>
          <TableCell className="whitespace-normal">{rule.addressPrefix || '우편번호만 판정'}</TableCell><TableCell>{rule.regionLabel || '미입력'}</TableCell><TableCell>{rule.disposition ? REGION_DISPOSITION_LABELS[rule.disposition] : '미입력'}</TableCell>
          <TableCell className="text-right tabular-nums">{rule.amount === null ? rule.disposition === 'surcharge' ? '미입력' : '해당 없음' : krw(rule.amount)}</TableCell></TableRow>)}</TableBody></Table>
        {parsed.rules.length > 50 ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">앞의 50행을 표시합니다. 저장·서버 검증은 전체 {parsed.rules.length}행에 적용합니다.</p> : null}</div> : <p className={`mt-2 ${NOTE}`}>입력된 지역표가 없습니다.</p>}
    </details>
    {!readOnly && problems.length > 0 ? <AdminNotice title="활성화 전 확인" tone="warning"><ul className="flex list-disc flex-col gap-1 pl-5">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></AdminNotice> : null}
    {!readOnly ? <div className={STICKY_ACTIONS} data-admin-savebar="">
      {policy && <label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={attested} disabled={pending || dirty || problems.length > 0}
        onChange={(event) => setAttested(event.target.checked)} /><span>저장된 정책이 실제 물류사 원본·적용 기간·지역·요금·무료/묶음 기준과 일치함을 확인했습니다.</span></label>}
      {policy && dirty ? <p className={NOTE}>수정한 내용을 먼저 초안으로 저장해주세요.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {/* 저장된 초안이 있으면 그 화면의 주 행동은 확정이고, 저장은 보조다. */}
        <Button disabled={pending} onClick={save} type="button" variant={policy ? 'outline' : 'default'}>초안 저장</Button>
        {policy && <Button disabled={pending || dirty || problems.length > 0 || !attested} onClick={() => setStatus('active')} type="button">저장된 정책 활성화</Button>}
      </div>
    </div> : null}
    {canEdit && policy?.status === 'active' ? <>
      <label className={CHECK_LABEL_TOP}><input className="mt-0.5" type="checkbox" checked={attested} disabled={pending} onChange={(event) => setAttested(event.target.checked)} />
        <span>정책을 중단하면 적용할 다른 정책이 없는 출고지의 신규 주문이 차단됩니다. 기존 주문의 배송비는 그대로 보존됨을 확인했습니다.</span></label>
      <Button className="w-fit" disabled={pending || !attested} onClick={() => setStatus('retired')} type="button" variant="destructive">정책 중단</Button>
    </> : null}
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
  </div>;
}

export function ShippingRegionsScreen({ policies: initialPolicies, adoptions, origins, carriers, canEdit }: {
  policies: ShippingRegionPolicy[]; adoptions: ShippingRegionAdoption[]; origins: GoodsFulfillmentOrigin[];
  carriers: EditableCarrier[]; canEdit: boolean;
}) {
  const [policies, setPolicies] = useState(initialPolicies); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copy, setCopy] = useState<ShippingRegionPolicyInput | null>(null); const [editorKey, setEditorKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const selected = policies.find((policy) => policy.id === selectedId) ?? null;
  function openPolicy(id: string) {
    setSelectedId(id); setCopy(null); setEditorKey((key) => key + 1); setMessage(null);
    /* 편집 카드는 목록 아래에 있어 눌러도 변화가 안 보인다 — 열린 카드로 데려간다. */
    requestAnimationFrame(() => document.getElementById(POLICY_EDITOR_ID)?.scrollIntoView({ block: 'start' }));
  }
  function saved(policy: ShippingRegionPolicy, success: string) {
    setPolicies((current) => current.some((row) => row.id === policy.id) ? current.map((row) => row.id === policy.id ? policy : row) : [...current, policy]);
    setSelectedId(policy.id); setCopy(null); setEditorKey((key) => key + 1); setMessage(success);
  }
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="shipping-regions">
    <AdminPageHeader title="지역별 추가배송비 관리" description="실제 물류사 회신을 출고지·계약 택배사·적용 기간별로 관리합니다. 확정된 정책만 배송지별 견적과 주문에 적용합니다." />
    <StoreSettingsRelatedLinks label="배송 설정" links={[{ href: '/admin/settings/origins', label: '출고지·배송비' }, { href: '/admin/settings/carriers', label: '택배사' }]} />
    {message ? <AdminNotice role="status" tone="success">{message}</AdminNotice> : null}
    <AdminSectionCard title="출고지별 등록 상태">
      <ul className="flex flex-col divide-y">{origins.map((origin) => {
        const adoption = adoptions.find((row) => row.originId === origin.id);
        const originPolicies = policies.filter((policy) => policy.originId === origin.id);
        const newlyActive = originPolicies.some((policy) => policy.status !== 'draft');
        const state = adoption
          ? originPolicies.some((policy) => policy.status === 'active')
            ? { tone: 'success', label: '지역 정책 적용', detail: `${formatOrderDateTime(adoption.managedFrom)}부터 지역 정책 필수` } as const
            : { tone: 'warning', label: '활성 정책 없음', detail: `${formatOrderDateTime(adoption.managedFrom)}부터 지역 정책 필수` } as const
          : newlyActive ? { tone: 'info', label: '지역 정책 도입', detail: '적용 기간을 확인해주세요' } as const
            : { tone: 'neutral', label: '지역표 미등록', detail: '기존 배송비로 주문 확정' } as const;
        return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0" key={origin.id}><span className="font-medium">{origin.name}</span><AdminStatusBadge tone={state.tone}>{state.label}</AdminStatusBadge><span className="text-muted-foreground">{state.detail}</span></li>;
      })}</ul>
      <p className={NOTE}>지역표 미등록은 계약 추가료가 0원이라는 뜻이 아닙니다. 현재 표시된 배송비로 주문이 확정되며, 이미 확정된 주문에 지역료를 뒤늦게 더하지 않습니다.</p>
      <AdminNotice title="신규 주문이 차단될 수 있습니다" tone="warning">지역 정책을 도입한 출고지는 정책 만료·중단·택배사 불일치 시 신규 주문을 차단합니다.</AdminNotice>
    </AdminSectionCard>
    <AdminSectionCard title="정책 버전" summary="줄을 누르면 아래에서 내용을 보고, 초안은 확정할 수 있습니다.">
      {policies.length ? <div className="flex flex-col gap-1.5">{policies.map((policy) => <Button className="h-auto min-h-9 justify-start py-1.5 text-left whitespace-normal [overflow-wrap:anywhere] aria-pressed:border-primary aria-pressed:bg-primary-soft" key={policy.id} type="button" variant="outline"
        aria-pressed={selectedId === policy.id} onClick={() => openPolicy(policy.id)}>
        <span className="min-w-0 flex-1">{origins.find((origin) => origin.id === policy.originId)?.name} · {policy.name || '이름 미입력'} · 버전 {policy.version}</span>
        <AdminStatusBadge className="shrink-0" tone={statusTone('regionPolicy', policy.status)}>{STATUS_LABELS[policy.status]}</AdminStatusBadge>
        {canEdit && policy.status === 'draft' ? <span className="shrink-0 text-xs font-semibold text-primary">확정하기</span> : <span className="shrink-0 text-xs font-normal text-muted-foreground">내용 보기</span>}
        <ChevronRight aria-hidden="true" className="text-muted-foreground" />
      </Button>)}</div> : <p className={NOTE}>등록한 지역 정책이 없습니다. 실제 회신을 확보한 출고지부터 초안을 작성해주세요.</p>}
      {canEdit && <Button className="w-fit" onClick={() => { setSelectedId(null); setCopy(null); setEditorKey((key) => key + 1); }} type="button" variant="outline">새 정책 초안</Button>}
    </AdminSectionCard>
    {(selected || canEdit) && <AdminSectionCard id={POLICY_EDITOR_ID} summary={selected ? <AdminStatusBadge tone={statusTone('regionPolicy', selected.status)}>{STATUS_LABELS[selected.status]}</AdminStatusBadge> : undefined} title={selected ? `${selected.name || '지역 정책'} · 버전 ${selected.version}` : '새 정책 초안'}>
      {selected?.confirmedAt ? <p className={NOTE}>원본 확인: {selected.confirmedBy} · {formatOrderDateTime(selected.confirmedAt)}</p> : null}
      {canEdit && selected && <Button className="w-fit" type="button" variant="outline" onClick={() => {
        const source = parseShippingRegionPolicyInput(selected)!;
        setCopy({ ...source, startsAt: null, endsAt: null, openEnded: null, rules: source.rules.map((rule) => ({ ...rule, id: null })) });
        setSelectedId(null); setEditorKey((key) => key + 1); setMessage(null);
      }}>이 정책으로 새 버전 초안 만들기</Button>}
      <ShippingRegionEditor key={editorKey} policy={selected} initialCopy={copy} origins={origins} carriers={carriers} canEdit={canEdit} onSaved={saved} />
      {copy ? <AdminNotice tone="info">이전 정책의 원본을 기준으로 새 정책을 입력해주세요. 실제 계약과 기간을 다시 확인해야 합니다.</AdminNotice> : null}
    </AdminSectionCard>}
  </div>;
}

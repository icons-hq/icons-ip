'use client';

import { useId, useState, useTransition } from 'react';
import { ChevronRight } from 'lucide-react';
import { applyShippingRegionPolicyAction, changeShippingRegionFeesAction, endShippingRegionPolicyAction, saveShippingRegionPolicyAction } from '@/app/admin/shipping-region-actions';
import { adminConfirm } from '@/lib/admin/confirm';
import { TEMPLATE_CLOSE_DIRTY_CONFIRM } from '@/lib/admin/goods-template-save';
import { SHIPPING_REGIONS_HELP } from '@/lib/admin/help/shipping-regions';
import { AdminPageHeader, AdminSectionCard, AdminNotice, AdminStatusBadge } from '../console/AdminKit';
import { AdminLabelWithHelp } from '../console/AdminHelpTip';
import { useAdminLeaveGuard } from '../useAdminLeaveGuard';
import { statusTone } from '@/lib/admin/status-tone';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import {
  defaultShippingRegionPolicy, MAX_SHIPPING_REGION_FEE, parseShippingRegionPolicyInput, parseShippingRegionRulesTsv, REGION_DISPOSITION_LABELS,
  SHIPPING_REGION_EFFECT_NOW, SHIPPING_REGION_STATE_LABELS, SHIPPING_REGION_TSV_EXAMPLE, shippingRegionApplyConfirmMessage, shippingRegionEndConfirmMessage, shippingRegionExampleLines,
  shippingRegionFeeGroups, shippingRegionFeeSummary, shippingRegionPolicyInEffect, shippingRegionPolicyProblems, shippingRegionPolicyState, shippingRegionReplacements,
  shippingRegionRulesTsv, withShippingRegionPolicyDefaults, type ShippingRegionFeeGroup, type ShippingRegionPolicy, type ShippingRegionPolicyInput,
  type ShippingRegionPolicyState } from '@/lib/admin/shipping-regions';
import type { ShippingRegionAdoption } from '@/lib/admin/shipping-regions.server';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { CHECK_LABEL, FIELD_HINT, FIELD_LABEL, INFO_PANEL, NOTE, TABLE_BOX, TSV_TEXTAREA } from '@/components/admin/settings-kit';
import { StoreSettingsRelatedLinks } from './StoreSettingsRelatedLinks';

const POLICY_EDITOR_ID = 'shipping-region-policy-editor';
/* 저장 버튼 줄. 지역표가 길어도 화면 바닥에 남는다. 카드 폭 그대로 바닥에 붙어야 입력칸 위에 뜬 상자로 보이지 않는다. */
const STICKY_ACTIONS = 'sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t bg-card px-4 py-3 sm:-mx-5 sm:-mb-5 sm:px-5';
const FIELD_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,13.75rem),1fr))] gap-3';
const APPLY_LABEL = '저장하고 적용';
const APPLY_UNKNOWN = '적용됐는지 확인하지 못했습니다. 다시 누르지 말고 새로고침해 목록에서 상태를 확인해 주세요.';

function koreaInput(value: string | null): string { return value ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16) : ''; }
function fromKoreaInput(value: string): string | null { return value ? new Date(`${value}:00+09:00`).toISOString() : null; }
/* 배지 색은 상태 표(status-tone)의 네 값에서 고른다. 주문에 쓰이지 않는 설정(기간 끝남·택배사 다름)은 끝낸 설정과 같은 색이다. */
const STATE_TONE_KEY: Record<ShippingRegionPolicyState, string> = { draft: 'draft', scheduled: 'scheduled', in_effect: 'active', unused: 'retired', expired: 'retired', retired: 'retired' };
/** 붙여넣은 지역표의 줄에 달린 안내인가(줄 번호가 있는 안내와 그 뒤의 '나머지 줄' 안내). */
const isTableProblem = (problem: string) => /^지역표( \d+번째 줄|의 나머지 줄)/.test(problem);
function periodText(policy: Pick<ShippingRegionPolicy, 'status' | 'startsAt' | 'endsAt'>): string {
  if (!policy.startsAt) return '적용하면 바로 시작';
  return `${formatOrderDateTime(policy.startsAt)}부터${policy.endsAt ? ` ${formatOrderDateTime(policy.endsAt)}까지` : ''}`;
}

/*
 * 적용 중인 설정의 추가배송비는 지역명 칸의 숫자만 고쳐 바꾼다. 지역표를 다시 붙여넣지 않는다.
 * 서버가 같은 지역표로 새 설정을 바로 적용하고 이전 설정을 함께 끝낸다(주문이 막히는 틈 없음).
 */
export function ShippingRegionFeeChanger({ policy, originName, onReplaced }: {
  policy: ShippingRegionPolicy; onReplaced: (policy: ShippingRegionPolicy, replacedId: string, message: string) => void;
  /** 확인창 첫 줄에 어느 출고지의 금액인지 보인다. */
  originName?: string;
}) {
  const groups = shippingRegionFeeGroups(policy.rules);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((group) =>
    [group.regionLabel, group.minAmount === group.maxAmount ? String(group.minAmount) : ''])));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!groups.length) return null;
  const current = (group: ShippingRegionFeeGroup) => group.minAmount === group.maxAmount ? krw(group.minAmount) : `${krw(group.minAmount)}~${krw(group.maxAmount)}`;
  const entries = groups.flatMap((group) => {
    const raw = (values[group.regionLabel] ?? '').trim();
    if (!raw) return [];
    const amount = Number(raw);
    const valid = /^\d{1,7}$/.test(raw) && amount <= MAX_SHIPPING_REGION_FEE;
    return group.minAmount === group.maxAmount && group.minAmount === amount ? [] : [{ group, amount, valid }];
  });
  const invalid = entries.some((entry) => !entry.valid);
  async function submit() {
    if (!entries.length || invalid || pending) return;
    setError(null);
    /* 확인창은 전환 밖에서 받는다 — 전환 안에서 띄우면 호스트의 상태 갱신이 전환이 끝날 때까지 미뤄져 확인창이 뜨지 않는다. */
    const confirmed = await adminConfirm({ title: '추가배송비 금액 바꾸기', confirmLabel: '금액 바꾸기', cancelLabel: '돌아가기',
      message: `${[originName, policy.name].filter(Boolean).join(' · ')}\n${entries.map(({ group, amount }) => `${group.regionLabel} ${current(group)} → ${krw(amount)} (${group.rowCount}줄)`).join('\n')}\n\n${SHIPPING_REGION_EFFECT_NOW}` });
    if (!confirmed) return;
    startTransition(async () => {
      try {
        const result = await changeShippingRegionFeesAction(policy.id, policy.revision, Object.fromEntries(entries.map(({ group, amount }) => [group.regionLabel, amount])));
        if (result.ok) onReplaced(result.policy, policy.id, result.message); else setError(result.error);
      } catch { setError('금액이 바뀌었는지 확인하지 못했습니다. 새로고침해 적용 중인 금액을 확인해 주세요.'); }
    });
  }
  return <section className="flex flex-col gap-3 rounded-lg border p-4" data-region-fee-changer="">
    <h3 className="text-sm font-semibold">추가배송비 금액</h3>
    <div className={FIELD_GRID}>
      {groups.map((group) => <label className={FIELD_LABEL} key={group.regionLabel}>
        <span>{group.regionLabel} <span className="font-normal text-muted-foreground">· 지역표 {group.rowCount}줄{group.minAmount === group.maxAmount ? '' : ` · 지금 ${current(group)}`}</span></span>
        <span className="flex items-center gap-2"><Input className="w-36 text-right tabular-nums" disabled={pending} inputMode="numeric" maxLength={7}
          placeholder={group.minAmount === group.maxAmount ? undefined : '새 금액'} value={values[group.regionLabel] ?? ''}
          aria-invalid={entries.some((entry) => entry.group === group && !entry.valid) || undefined}
          onChange={(event) => { setValues({ ...values, [group.regionLabel]: event.target.value }); setError(null); }} />원</span>
      </label>)}
    </div>
    {invalid ? <p className="text-sm text-destructive" role="alert">추가배송비는 0원부터 1,000,000원까지 원 단위 숫자로 적어 주세요.</p> : null}
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button disabled={pending || !entries.length || invalid} onClick={submit} type="button">금액 바꾸기</Button>
      <p className={NOTE}>바꾸면 지금부터 새 주문에 적용됩니다.</p>
    </div>
  </section>;
}

type EditorOrigin = Pick<GoodsFulfillmentOrigin, 'id' | 'name' | 'defaultCarrier' | 'baseFee' | 'freeThreshold' | 'active'>;

/** 한 건을 만들고 고치는 칸. 저장하는 순간 주문에 적용되므로 [저장하고 적용]은 확인창 한 번을 거친다. */
export function ShippingRegionEditor({ policy, initialCopy, origins, carriers, adoptions, canEdit, policies, now, onSaved, onApplied, onReplaced, onPoliciesRefreshed, onTouched }: {
  policy: ShippingRegionPolicy | null; initialCopy: ShippingRegionPolicyInput | null;
  origins: EditorOrigin[]; carriers: EditableCarrier[]; adoptions: ShippingRegionAdoption[]; canEdit: boolean;
  /** 화면이 가진 전체 목록 — 적용할 때 함께 바뀌는 설정을 여기서 찾는다. */
  policies: ShippingRegionPolicy[]; now: number;
  onSaved: (policy: ShippingRegionPolicy, message: string) => void;
  onApplied: (policy: ShippingRegionPolicy, replaced: ShippingRegionPolicy[], message: string) => void;
  /** 금액 바꾸기로 새 설정이 이전 설정을 대신했다. */
  onReplaced: (policy: ShippingRegionPolicy, replacedId: string, message: string) => void;
  /** 적용하려던 사이에 목록이 달라져 서버가 다시 읽어 준 목록. */
  onPoliciesRefreshed: (policies: ShippingRegionPolicy[]) => void;
  /** 저장하지 않은 입력이 생겼다. */
  onTouched: () => void;
}) {
  const fieldId = useId();
  const stored = parseShippingRegionPolicyInput(policy);
  /* 적용한 설정은 저장된 값 그대로 보이고, 고칠 수 있는 설정(새로 만들기·준비 중)에만 기본값을 채운다. */
  const [input, setInput] = useState<ShippingRegionPolicyInput>(() => stored
    ? policy?.status === 'draft' ? withShippingRegionPolicyDefaults(stored) : stored
    : initialCopy ? withShippingRegionPolicyDefaults(initialCopy) : defaultShippingRegionPolicy());
  const [tsv, setTsv] = useState(() => { const rules = policy?.rules ?? initialCopy?.rules ?? []; return rules.length ? shippingRegionRulesTsv(rules) : ''; });
  /* '저장하면 바로'가 기본이다. 날짜를 정해 둔 설정만 날짜 칸을 연다. */
  const [startNow, setStartNow] = useState(() => !(policy?.startsAt ?? initialCopy?.startsAt));
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const readOnly = !canEdit || (policy !== null && policy.status !== 'draft');
  const origin = origins.find((row) => row.id === input.originId);
  /* 택배사는 고르지 않는다. 출고지의 기본 택배사와 다르면 어차피 주문에 쓰이지 않는다. 저장해 둔 설정의 택배사는 바뀌지 않는다. */
  const carrierCode = policy ? policy.carrierCode : origin?.defaultCarrier ?? '';
  const carrier = carriers.find((row) => row.code === carrierCode);
  const carrierLabel = (code: string | null) => carriers.find((row) => row.code === code)?.label ?? '없음';
  const parsed = input.noRulesConfirmed ? { rules: [] } : parseShippingRegionRulesTsv(tsv, policy?.rules);
  const rules = parsed.rules ?? [];
  const current: ShippingRegionPolicyInput = { ...input, carrierCode, startsAt: startNow ? null : input.startsAt, rules };
  const originProblems = !input.originId ? ['출고지를 골라 주세요.']
    : !origin ? ['출고지를 다시 골라 주세요.']
    : !origin.active ? [`${origin.name} 출고지가 ‘사용 안 함’입니다. 배송정보 관리에서 ‘사용’으로 바꾼 뒤 적용해 주세요.`]
    : !origin.defaultCarrier ? [`${origin.name} 출고지에 기본 택배사가 없습니다. 배송정보 관리에서 기본 택배사를 먼저 골라 주세요.`]
    : origin.defaultCarrier !== carrierCode ? [`이 설정의 택배사(${carrierLabel(carrierCode)})가 ${origin.name} 출고지의 지금 기본 택배사(${carrierLabel(origin.defaultCarrier)})와 다릅니다. [이 내용으로 새로 만들기]로 다시 만들어 주세요.`]
    : !carrier?.active ? [`${origin.name} 출고지의 기본 택배사(${carrierLabel(carrierCode)})가 ‘사용 안 함’입니다. 택배사 관리에서 ‘사용’으로 바꾸거나 배송정보 관리에서 기본 택배사를 바꿔 주세요.`]
    : [];
  /* 지역표를 읽지 못했거나 줄이 틀린 것은 붙여넣자마자 말하고, 빈 칸은 [저장하고 적용]을 눌렀을 때 말한다. */
  const policyProblems = parsed.error ? [] : shippingRegionPolicyProblems({ ...current, startsAt: startNow ? new Date(now).toISOString() : current.startsAt });
  const tableProblems = parsed.error ? [parsed.error] : policyProblems.filter(isTableProblem);
  const fieldProblems = [...originProblems, ...policyProblems.filter((problem) => !isTableProblem(problem)),
    ...(!startNow && current.endsAt && Date.parse(current.endsAt) <= now ? ['적용 종료가 이미 지났습니다. 지금보다 뒤로 고쳐 주세요.'] : [])];
  const example = shippingRegionExampleLines(current, origin ?? null);

  function touch() { setError(null); onTouched(); }
  function change(patch: Partial<ShippingRegionPolicyInput>) { setInput({ ...input, ...patch }); touch(); }
  function saveDraft() {
    if (pending) return;
    setError(null);
    /* 출고지와 택배사가 있어야 저장해 둘 수 있다. 무엇이 빠졌는지는 아래 안내 상자가 말한다. */
    if (parsed.error || !origin || !carrierCode) { setAttempted(true); return; }
    startTransition(async () => {
      try {
        const result = await saveShippingRegionPolicyAction(policy?.id ?? null, policy?.revision ?? null, current);
        if (result.ok) onSaved(result.policy, result.message); else setError(result.error);
      } catch { setError('저장하지 못했습니다. 적어 둔 내용은 그대로 있으니 다시 눌러 주세요.'); }
    });
  }
  /* `clock`은 누른 순간의 시각이다(버튼의 onClick에서 읽어 넘긴다). */
  async function apply(clock: number) {
    if (pending) return;
    setError(null);
    if (tableProblems.length || fieldProblems.length || !origin) { setAttempted(true); return; }
    /* 저장하는 순간 주문에 적용된다. 지금 시각으로 함께 바뀌는 설정을 찾아 확인창에 보이고, 같은 목록을 서버에 보낸다. */
    const candidate = { ...current, startsAt: startNow ? new Date(clock).toISOString() : current.startsAt };
    const replacements = shippingRegionReplacements(candidate, policies, policy?.id ?? null, clock);
    const adoption = adoptions.find((row) => row.originId === origin.id);
    const confirmed = await adminConfirm({ title: '지역별 추가배송비 적용', confirmLabel: '적용', cancelLabel: '돌아가기',
      message: shippingRegionApplyConfirmMessage({ input: candidate, startNow, originName: origin.name, carrierLabel: carrierLabel(carrierCode), replacements,
        adoption: !adoption ? 'none' : Date.parse(adoption.managedFrom) > clock ? 'scheduled' : 'started',
        coveredNow: policies.some((row) => shippingRegionPolicyInEffect(row, origin, clock)), now: clock, formatDate: formatOrderDateTime }) });
    if (!confirmed) return;
    startTransition(async () => {
      try {
        const result = await applyShippingRegionPolicyAction(policy?.id ?? null, policy?.revision ?? null, current, replacements.map((row) => row.policy.id), startNow);
        if (result.ok) onApplied(result.policy, result.replaced, result.message);
        else { setError(result.error); if (result.policies) onPoliciesRefreshed(result.policies); }
      } catch { setError(APPLY_UNKNOWN); }
    });
  }
  async function end(clock: number) {
    if (!policy || pending) return;
    setError(null);
    const state = shippingRegionPolicyState(policy, origin, Boolean(carriers.find((row) => row.code === origin?.defaultCarrier)?.active), clock);
    const confirmed = await adminConfirm({ title: '지역별 추가배송비 끝내기', confirmLabel: '끝내기', cancelLabel: '돌아가기', destructive: true,
      message: shippingRegionEndConfirmMessage({ policy, originName: origin?.name ?? '', state, formatDate: formatOrderDateTime }) });
    if (!confirmed) return;
    startTransition(async () => {
      try {
        const result = await endShippingRegionPolicyAction(policy.id, policy.revision);
        if (result.ok) onSaved(result.policy, result.message); else setError(result.error);
      } catch { setError('끝냈는지 확인하지 못했습니다. 새로고침해 목록에서 상태를 확인해 주세요.'); }
    });
  }
  function chargeBox(key: 'chargePolicyGoods' | 'chargeFreeGoods' | 'chargeIndividualGoods' | 'waivePolicyThreshold', label: string) {
    return <label className={CHECK_LABEL}><input type="checkbox" checked={input[key] === true} onChange={(event) => change({ [key]: event.target.checked })} />{label}</label>;
  }
  /* 끝난 설정은 금액을 바꿔도 적용할 기간이 없다(DB도 거절한다). */
  const feeChangeable = canEdit && policy?.status === 'active' && !(policy.endsAt && Date.parse(policy.endsAt) <= now);
  const selectableOrigins = origins.filter((row) => row.active || row.id === input.originId);
  return <div className="flex min-w-0 flex-col gap-4" data-region-editor="">
    {feeChangeable && policy ? <ShippingRegionFeeChanger onReplaced={onReplaced} originName={origin?.name} policy={policy} /> : null}
    <fieldset disabled={pending || readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <legend className="sr-only">지역별 추가배송비 입력</legend>
      <div className={FIELD_GRID}>
        <label className={FIELD_LABEL}>출고지<NativeSelect className="w-full" value={input.originId} disabled={Boolean(policy)} onChange={(event) => change({ originId: event.target.value })}>
          <option value="">골라 주세요</option>{selectableOrigins.map((row) => <option key={row.id} value={row.id}>{row.name}{row.active ? '' : ' · 사용 안 함'}</option>)}
        </NativeSelect>{origin ? <small className={FIELD_HINT}>택배사: {carrierLabel(carrierCode)} · 이 출고지의 기본 택배사로 적용합니다.</small> : null}</label>
        <label className={FIELD_LABEL}>이름<Input value={input.name} maxLength={100} placeholder="예: 2026 겨울 제주·도서산간" onChange={(event) => change({ name: event.target.value })} /></label>
        <label className={FIELD_LABEL}>적용 시작<NativeSelect className="w-full" value={startNow ? 'now' : 'date'} onChange={(event) => { setStartNow(event.target.value === 'now'); touch(); }}>
          <option value="now">저장하면 바로</option><option value="date">날짜와 시각 정하기</option>
        </NativeSelect></label>
        {startNow ? null : <label className={FIELD_LABEL}>적용 시작 (KST)<Input type="datetime-local" value={koreaInput(input.startsAt)} onChange={(event) => change({ startsAt: fromKoreaInput(event.target.value) })} /></label>}
        <label className={FIELD_LABEL}>적용 종료<NativeSelect className="w-full" value={input.openEnded === false ? 'date' : 'open'} onChange={(event) => change(event.target.value === 'open' ? { openEnded: true, endsAt: null } : { openEnded: false })}>
          <option value="open">정하지 않음 · 계속 적용</option><option value="date">날짜와 시각 정하기</option>
        </NativeSelect></label>
        {input.openEnded === false ? <label className={FIELD_LABEL}>적용 종료 (KST)<Input type="datetime-local" value={koreaInput(input.endsAt)} onChange={(event) => change({ endsAt: fromKoreaInput(event.target.value) })} />
          <small className={FIELD_HINT}>이 시각 뒤에 이어서 적용할 설정이 없으면 이 출고지의 새 주문이 막힙니다.</small></label> : null}
      </div>
      <div className={FIELD_GRID}>
        <label className={FIELD_LABEL}>추가배송비를 받는 지역<NativeSelect className="w-full" value={input.noRulesConfirmed ? 'none' : 'table'} onChange={(event) => change({ noRulesConfirmed: event.target.value === 'none' })}>
          <option value="table">지역표로 정하기</option><option value="none">추가배송비를 받는 지역 없음</option>
        </NativeSelect></label>
        <label className={FIELD_LABEL}>표에 없는 지역<NativeSelect className="w-full" value={input.unlistedDisposition ?? 'standard'} onChange={(event) => change({ unlistedDisposition: event.target.value as ShippingRegionPolicyInput['unlistedDisposition'] })}>
          <option value="standard">추가배송비 없이 주문받기</option><option value="manual_review">주문받지 않기</option>
        </NativeSelect></label>
      </div>
      {input.noRulesConfirmed ? null : <div className={FIELD_LABEL}>
        <AdminLabelWithHelp help={SHIPPING_REGIONS_HELP.regionTable} label="지역표"><label htmlFor={`${fieldId}-table`}>지역표</label></AdminLabelWithHelp>
        <Textarea className={TSV_TEXTAREA} id={`${fieldId}-table`} maxLength={500000} placeholder={SHIPPING_REGION_TSV_EXAMPLE} rows={9} spellCheck={false} value={tsv}
          onChange={(event) => { setTsv(event.target.value); touch(); }} />
      </div>}
    </fieldset>
    {!readOnly && tableProblems.length ? <AdminNotice role="alert" title="지역표를 고쳐 주세요" tone="warning"><ul className="flex list-disc flex-col gap-1 pl-5">{tableProblems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></AdminNotice> : null}
    {rules.length ? <section className="flex min-w-0 flex-col gap-2" data-region-preview="">
      <AdminLabelWithHelp help={SHIPPING_REGIONS_HELP.regionPreview} label="지역표 미리보기"><h3 className="text-sm font-semibold">지역표 미리보기 · {rules.length}줄</h3></AdminLabelWithHelp>
      <div className={TABLE_BOX}><Table className="min-w-[40rem]">
        <caption className="sr-only">지역표 미리보기</caption>
        <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead className="w-12 text-right" scope="col">줄</TableHead><TableHead scope="col">우편번호</TableHead>
          <TableHead scope="col"><AdminLabelWithHelp help={SHIPPING_REGIONS_HELP.addressPrefix} label="주소 시작문구"><span>주소 시작문구</span></AdminLabelWithHelp></TableHead>
          <TableHead scope="col">지역명</TableHead><TableHead scope="col">처리</TableHead><TableHead className="text-right" scope="col">추가배송비</TableHead></TableRow></TableHeader>
        <TableBody>{rules.slice(0, 50).map((rule, index) => <TableRow key={rule.id ?? index}><TableCell className="text-right tabular-nums text-muted-foreground">{index + 1}</TableCell>
          <TableCell className="tabular-nums">{rule.postalFrom || '빈칸'}~{rule.postalTo || '빈칸'}</TableCell>
          <TableCell className="whitespace-normal">{rule.addressPrefix || '우편번호만 봄'}</TableCell><TableCell>{rule.regionLabel || '빈칸'}</TableCell><TableCell>{rule.disposition ? REGION_DISPOSITION_LABELS[rule.disposition] : '빈칸'}</TableCell>
          <TableCell className="text-right tabular-nums">{rule.amount === null ? rule.disposition === 'surcharge' ? '빈칸' : '-' : krw(rule.amount)}</TableCell></TableRow>)}</TableBody></Table>
        {rules.length > 50 ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">앞의 50줄만 보입니다. 나머지 {rules.length - 50}줄도 함께 저장합니다.</p> : null}</div>
    </section> : null}
    <fieldset disabled={pending || readOnly} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="text-sm font-semibold">추가배송비를 받는 상품</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {chargeBox('chargePolicyGoods', '‘출고지 정책 따름’ 상품')}{chargeBox('chargeFreeGoods', '‘무료배송’ 상품')}{chargeBox('chargeIndividualGoods', '‘개별 배송비’ 상품')}
      </div>
      {input.chargePolicyGoods && origin?.freeThreshold != null ? chargeBox('waivePolicyThreshold', `무료 배송 기준(${krw(origin.freeThreshold)})을 채운 주문은 추가배송비도 받지 않기`) : null}
      <label className={`${FIELD_LABEL} max-w-xs`}>받는 단위<NativeSelect className="w-full" value={input.feeUnit ?? 'per_shipment'} onChange={(event) => change({ feeUnit: event.target.value as ShippingRegionPolicyInput['feeUnit'] })}>
        <option value="per_shipment">한 주문에 한 번</option><option value="per_good">상품 종류마다 한 번</option>
      </NativeSelect></label>
    </fieldset>
    {example.length ? <div className={INFO_PANEL} data-region-example=""><p className="font-medium">{example[0]}</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-muted-foreground">{example.slice(1).map((line) => <li key={line}>{line}</li>)}</ul></div> : null}
    {!readOnly && attempted && fieldProblems.length ? <AdminNotice role="alert" title="적용하려면 채워 주세요" tone="warning"><ul className="flex list-disc flex-col gap-1 pl-5">{fieldProblems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></AdminNotice> : null}
    {error ? <AdminNotice role="alert" tone="danger">{error}</AdminNotice> : null}
    {!readOnly ? <div className={STICKY_ACTIONS} data-admin-savebar="">
      <Button disabled={pending} onClick={saveDraft} type="button" variant="outline">적용하지 않고 저장</Button>
      <Button disabled={pending} onClick={() => apply(Date.now())} type="button">{APPLY_LABEL}</Button>
    </div> : null}
    {canEdit && policy?.status === 'active' ? <Button className="w-fit" disabled={pending} onClick={() => end(Date.now())} type="button" variant="destructive">끝내기</Button> : null}
  </div>;
}

export function ShippingRegionsScreen({ policies: initialPolicies, adoptions, origins, carriers, canEdit, now = new Date() }: {
  policies: ShippingRegionPolicy[]; adoptions: ShippingRegionAdoption[]; origins: GoodsFulfillmentOrigin[];
  carriers: EditableCarrier[]; canEdit: boolean;
  /** 서버가 요청 시각을 넘긴다. 적용 상태 판정에 쓴다. */
  now?: Date;
}) {
  const [policies, setPolicies] = useState(initialPolicies); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copy, setCopy] = useState<ShippingRegionPolicyInput | null>(null); const [editorKey, setEditorKey] = useState(0);
  /* 설정이 있으면 첫 화면은 적용 상태와 목록이다 — 빈 입력칸은 [새로 만들기]를 눌렀을 때 연다. 하나도 없으면 쓸 곳이 입력뿐이라 열어 둔다. */
  const [composing, setComposing] = useState(initialPolicies.length === 0);
  const [message, setMessage] = useState<string | null>(null);
  /* 저장하지 않은 입력이 있는 동안에는 다른 설정을 열거나 닫기 전에, 화면을 떠나기 전에 묻는다. */
  const [touched, setTouched] = useState(false);
  /* 방금 적용한 설정은 페이지를 연 시각보다 뒤에 시작한다. 적용한 시각까지 시계를 당겨 '적용 중'으로 보이게 한다. */
  const [clock, setClock] = useState(0);
  /* 방금 처음 적용한 출고지. 페이지를 다시 읽기 전에도 '안 씀'으로 보이지 않게 한다. */
  const [adopted, setAdopted] = useState<ShippingRegionAdoption[]>([]);
  useAdminLeaveGuard({ dirty: touched, message: '저장하지 않은 지역별 추가배송비 입력이 사라집니다. 화면을 나갈까요?', recover: false });
  const nowMs = Math.max(now.getTime(), clock);
  const selected = policies.find((policy) => policy.id === selectedId) ?? null;
  const editorOpen = Boolean(selected) || (canEdit && (composing || copy !== null));
  const originOf = (originId: string) => origins.find((origin) => origin.id === originId);
  const carrierActive = (code: string | null) => carriers.some((carrier) => carrier.code === code && carrier.active);
  const stateOf = (policy: ShippingRegionPolicy) => shippingRegionPolicyState(policy, originOf(policy.originId), carrierActive(originOf(policy.originId)?.defaultCarrier ?? null), nowMs);
  /* 편집 카드는 목록 아래에 있어 눌러도 변화가 안 보인다 — 열린 카드로 데려간다. */
  function showEditor() { requestAnimationFrame(() => document.getElementById(POLICY_EDITOR_ID)?.scrollIntoView({ block: 'start' })); }
  async function discardOk() { return !touched || adminConfirm({ ...TEMPLATE_CLOSE_DIRTY_CONFIRM, cancelLabel: '계속 작성' }); }
  function show(next: { selectedId: string | null; copy: ShippingRegionPolicyInput | null; composing: boolean }) {
    setSelectedId(next.selectedId); setCopy(next.copy); setComposing(next.composing); setEditorKey((key) => key + 1); setMessage(null); setTouched(false);
  }
  async function openPolicy(id: string) { if (!await discardOk()) return; show({ selectedId: id, copy: null, composing: false }); showEditor(); }
  async function startNew() { if (!await discardOk()) return; show({ selectedId: null, copy: null, composing: true }); showEditor(); }
  async function closeEditor() { if (!await discardOk()) return; show({ selectedId: null, copy: null, composing: false }); }
  async function copySelected() {
    const source = selected ? parseShippingRegionPolicyInput(selected) : null;
    if (!source || !await discardOk()) return;
    /* 기간은 새로 정한다. 택배사는 출고지의 지금 기본 택배사를 따른다. */
    show({ selectedId: null, composing: true, copy: { ...source, startsAt: null, endsAt: null, openEnded: null, rules: source.rules.map((rule) => ({ ...rule, id: null })) } });
    showEditor();
  }
  /* 목록은 출고지·택배사별로 새로 만든 것이 위다 — 새 설정을 같은 출고지·택배사의 첫 줄 위에 둔다. */
  function upsert(list: ShippingRegionPolicy[], policy: ShippingRegionPolicy): ShippingRegionPolicy[] {
    if (list.some((row) => row.id === policy.id)) return list.map((row) => row.id === policy.id ? policy : row);
    const index = list.findIndex((row) => row.originId === policy.originId && row.carrierCode === policy.carrierCode);
    return index < 0 ? [...list, policy] : [...list.slice(0, index), policy, ...list.slice(index)];
  }
  function finish(policyId: string, success: string) {
    setSelectedId(policyId); setCopy(null); setEditorKey((key) => key + 1); setMessage(success); setComposing(false); setTouched(false);
  }
  function saved(policy: ShippingRegionPolicy, success: string) { setPolicies((current) => upsert(current, policy)); finish(policy.id, success); }
  function applied(policy: ShippingRegionPolicy, replacedRows: ShippingRegionPolicy[], success: string) {
    setPolicies((current) => upsert(replacedRows.reduce((list, row) => upsert(list, row), current), policy));
    /* 지금 시작한 설정이 '예정'으로 보이지 않게 한다. 나중에 시작하는 설정의 시작 시각까지 당기지는 않는다. */
    setClock((current) => Math.max(current, Date.now())); finish(policy.id, success);
    if (policy.startsAt) setAdopted((current) => [...current, { originId: policy.originId, managedFrom: policy.startsAt! }]);
  }
  /* 금액 바꾸기: 서버가 이전 설정을 끝냈다. 목록의 이전 줄도 끝냄으로 맞춘다(새로고침하면 서버 값으로 바뀐다). */
  function replaced(policy: ShippingRegionPolicy, replacedId: string, success: string) {
    setPolicies((current) => current.flatMap((row) => row.id === replacedId ? [policy, { ...row, status: 'retired' as const, revision: row.revision + 1 }] : [row]));
    finish(policy.id, success);
  }
  /* 지역별 추가배송비를 쓰기 시작한 출고지에 지금 적용 중인 설정이 없으면 새 주문이 막힌다 — 견적 판정과 같은 조건으로 본다. */
  const inEffect = (origin: GoodsFulfillmentOrigin) => carrierActive(origin.defaultCarrier) ? policies.find((policy) => shippingRegionPolicyInEffect(policy, origin, nowMs)) : undefined;
  /* 쓰기 시작한 시각(첫 설정의 적용 시작) 전에는 지금처럼 추가배송비 없이 주문받는다. */
  const allAdoptions = [...adoptions, ...adopted];
  const adoptionOf = (origin: GoodsFulfillmentOrigin) => allAdoptions.filter((row) => row.originId === origin.id).sort((a, b) => Date.parse(a.managedFrom) - Date.parse(b.managedFrom))[0];
  const started = (origin: GoodsFulfillmentOrigin) => { const adoption = adoptionOf(origin); return Boolean(adoption) && Date.parse(adoption!.managedFrom) <= nowMs; };
  const uncovered = origins.filter((origin) => started(origin) && !inEffect(origin));
  function uncoveredReason(origin: GoodsFulfillmentOrigin): string {
    if (!carrierActive(origin.defaultCarrier)) return '기본 택배사가 없거나 ‘사용 안 함’입니다';
    if (policies.some((policy) => policy.originId === origin.id && policy.carrierCode !== origin.defaultCarrier
      && shippingRegionPolicyInEffect(policy, { id: origin.id, defaultCarrier: policy.carrierCode }, nowMs))) return '출고지의 기본 택배사가 적용해 둔 설정의 택배사와 다릅니다';
    const next = policies.filter((policy) => policy.originId === origin.id && stateOf(policy) === 'scheduled').map((policy) => policy.startsAt!).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return next ? `다음 설정이 ${formatOrderDateTime(next)}에 시작합니다. 그때까지 막혀 있습니다` : '적용 기간이 끝났거나 끝낸 설정만 있습니다';
  }
  const hasDraft = policies.some((policy) => policy.status === 'draft');
  return <div className="flex min-w-0 flex-col gap-4" data-admin-screen="shipping-regions">
    <AdminPageHeader title="지역별 추가배송비 관리" description="제주·도서산간처럼 배송비를 더 받는 지역과 금액을 출고지마다 정합니다." actions={<StoreSettingsRelatedLinks label="배송 설정" links={[{ href: '/admin/settings/origins', label: '배송정보 관리' }, { href: '/admin/settings/carriers', label: '택배사 관리' }]} />} />
    {message ? <AdminNotice role="status" tone="success">{message}</AdminNotice> : null}
    <AdminSectionCard title="출고지별 적용 상태">
      <ul className="flex flex-col divide-y">{origins.map((origin) => {
        const adoption = adoptionOf(origin); const policy = inEffect(origin);
        const state = !adoption ? { tone: 'neutral', label: '안 씀', detail: '추가배송비 없이 주문받습니다' } as const
          : !started(origin) ? { tone: 'info', label: '예정', detail: `${formatOrderDateTime(adoption.managedFrom)}부터 적용 · 그 전에는 추가배송비 없이 주문받습니다` } as const
          : policy ? { tone: 'success', label: '적용 중', detail: shippingRegionFeeSummary(policy.rules) || '추가배송비를 받는 지역 없음' } as const
          : { tone: 'warning', label: '적용 중인 설정 없음', detail: '새 주문이 막혀 있습니다' } as const;
        return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0" key={origin.id}><span className="font-medium">{origin.name}</span><AdminStatusBadge tone={state.tone}>{state.label}</AdminStatusBadge><span className="text-muted-foreground">{state.detail}</span></li>;
      })}</ul>
      {uncovered.length ? <AdminNotice title="새 주문이 막혀 있는 출고지가 있습니다" tone="warning">
        <ul className="flex flex-col gap-0.5">{uncovered.map((origin) => <li key={origin.id}>{origin.name}: {uncoveredReason(origin)}.</li>)}</ul>
        {canEdit ? <p className="mt-1">[새로 만들기]로 지금 기본 택배사에 맞는 설정을 적용하면 주문을 다시 받습니다.</p> : null}
      </AdminNotice> : null}
    </AdminSectionCard>
    <AdminSectionCard title="설정 목록" summary={hasDraft ? '‘준비 중’은 아직 주문에 적용되지 않습니다.' : undefined}>
      {policies.length ? <ul className="flex flex-col gap-1.5">{policies.map((policy) => {
        const pressed = selectedId === policy.id; const state = stateOf(policy);
        return <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-1.5 data-[selected=true]:border-primary data-[selected=true]:bg-primary-soft" data-selected={pressed || undefined} key={policy.id}>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{originOf(policy.originId)?.name} · {policy.name || '이름 없음'} <span className="text-muted-foreground">· {periodText(policy)}</span></span>
          <AdminStatusBadge className="shrink-0" tone={statusTone('regionPolicy', STATE_TONE_KEY[state])}>{SHIPPING_REGION_STATE_LABELS[state]}</AdminStatusBadge>
          <Button aria-pressed={pressed} onClick={() => openPolicy(policy.id)} size="sm" type="button" variant={canEdit && state === 'draft' ? 'outline' : 'ghost'}>열기<ChevronRight aria-hidden="true" /></Button>
        </li>;
      })}</ul> : <p className={NOTE}>아직 만든 설정이 없습니다.</p>}
      {/* 새로 만드는 입력칸이 이미 열려 있으면 이 버튼은 할 일이 없다(주 행동은 그 칸의 저장이다). */}
      {canEdit && (selected || !composing) ? <Button className="w-fit" onClick={startNew} type="button">새로 만들기</Button> : null}
    </AdminSectionCard>
    {editorOpen && <AdminSectionCard id={POLICY_EDITOR_ID} summary={selected ? <AdminStatusBadge tone={statusTone('regionPolicy', STATE_TONE_KEY[stateOf(selected)])}>{SHIPPING_REGION_STATE_LABELS[stateOf(selected)]}</AdminStatusBadge> : undefined}
      title={selected ? `${originOf(selected.originId)?.name ?? ''} · ${selected.name || '이름 없음'}` : '새로 만들기'}>
      {selected?.confirmedAt ? <p className={NOTE}>적용한 사람: {selected.confirmedBy} · {formatOrderDateTime(selected.confirmedAt)}</p> : null}
      {(canEdit && selected) || policies.length ? <div className="flex flex-wrap items-center gap-2">
        {canEdit && selected ? <Button onClick={copySelected} type="button" variant="outline">이 내용으로 새로 만들기</Button> : null}
        {policies.length ? <Button className="ml-auto" onClick={closeEditor} type="button" variant="ghost">닫기</Button> : null}
      </div> : null}
      <ShippingRegionEditor key={editorKey} adoptions={allAdoptions} canEdit={canEdit} carriers={carriers} initialCopy={copy} now={nowMs} onApplied={applied}
        onPoliciesRefreshed={setPolicies} onReplaced={replaced} onSaved={saved} onTouched={() => setTouched(true)} origins={origins} policies={policies} policy={selected} />
    </AdminSectionCard>}
  </div>;
}

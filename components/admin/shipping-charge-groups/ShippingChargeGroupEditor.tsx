'use client';

import { ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM } from '@/lib/admin/dialog-close';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { getShippingChargeGroupAction, listShippingChargeGroupsAction } from '@/app/admin/shipping-charge-group-actions';
import type { GoodsFulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import { adminConfirm } from '@/lib/admin/confirm';
import {
  CHANGED_BY_OTHER, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, TEMPLATE_DISCARD_INPUT_CONFIRM, TEMPLATE_DISCARD_INPUT_LABEL,
  TEMPLATE_LATEST_UNREAD_MESSAGE, TEMPLATE_SAVE_OVER_LATEST_LABEL, TEMPLATE_SAVE_OVER_LATEST_NOTE, reopenClosedDialog,
} from '@/lib/admin/goods-template-save';
import { SHIPPING_REGIONS_HELP } from '@/lib/admin/help/shipping-regions';
import {
  SHIPPING_CHARGE_GROUP_RUNTIME_OFF, SHIPPING_CHARGE_GROUP_STOP_LABEL, defaultShippingChargeGroupRegionPolicy, emptyShippingChargeGroupValues,
  parseShippingChargeGroupSaveRequest, shippingChargeGroupRegionBlock, shippingChargeGroupRegionConfirmMessage, shippingChargeGroupRegionalProblems,
  type ShippingChargeGroup, type ShippingChargeGroupData, type ShippingChargeGroupIdentity, type ShippingChargeGroupListData,
  type ShippingChargeGroupOperationReceipt, type ShippingChargeGroupOriginGuard, type ShippingChargeGroupRegionPolicy, type ShippingChargeGroupValues,
} from '@/lib/admin/shipping-charge-groups';
import {
  REGION_DISPOSITION_LABELS, SHIPPING_REGION_TSV_EXAMPLE, parseShippingRegionRulesTsv, shippingRegionRulesTsv, type ShippingRegionRuleInput,
} from '@/lib/admin/shipping-regions';
import { krwAmountWords } from '@/lib/format';
import { formatOrderDateTime } from '@/lib/orders';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { AdminLabelWithHelp } from '@/components/admin/console/AdminHelpTip';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/admin/kit/ui/table';
import { ACTIONS, CHECK_LABEL, FIELD_HINT, FIELD_LABEL, NOTE, TABLE_BOX, TSV_TEXTAREA } from '@/components/admin/settings-kit';
import { CustomerServiceDialog } from '../screens/CustomerServiceDialog';
import { SHIPPING_CHARGE_GROUP_MODE_LABELS, ShippingChargeGroupSummary } from '../ShippingChargeGroupField';
import { useShippingChargeGroupOperation, type ShippingChargeGroupScope } from './useShippingChargeGroupOperation';

/** 묶음그룹의 저장 값만 뽑는다(번호·수정일·상품 수는 저장 값이 아니다). */
export function shippingChargeGroupValuesOf(group: ShippingChargeGroup): ShippingChargeGroupValues {
  return { name: group.name, enabled: group.enabled, archived: group.archived, isDefault: group.isDefault,
    calculationMode: group.calculationMode, regional: structuredClone(group.regional) };
}
/* 지역표 줄의 키 순서를 맞춘다. 서버가 돌려준 줄은 키 순서가 달라, 그대로 두면 지역표를 고치지 않았는데도 줄 번호가 새로 매겨져 '지역 설정이 바뀐 저장'으로 읽힌다. */
const orderedRule = (rule: ShippingRegionRuleInput): ShippingRegionRuleInput => ({ id: rule.id, postalFrom: rule.postalFrom, postalTo: rule.postalTo,
  addressPrefix: rule.addressPrefix, regionLabel: rule.regionLabel, disposition: rule.disposition, amount: rule.amount });
const orderedPolicy = (policy: ShippingChargeGroupRegionPolicy): ShippingChargeGroupRegionPolicy => ({ ...structuredClone(policy), rules: policy.rules.map(orderedRule) });
function regionalKey(value: ShippingChargeGroupValues['regional']) {
  if (value.mode === 'inherit') return 'inherit';
  const p = value.policy;
  return JSON.stringify([p.carrierCode, p.startsAt, p.endsAt, p.openEnded, p.sourceEvidence, p.unlistedDisposition, p.noRulesConfirmed,
    p.rules.map(row => [row.id, row.postalFrom, row.postalTo, row.addressPrefix, row.regionLabel, row.disposition, row.amount])]);
}
const tsvOf = (rules: readonly ShippingRegionRuleInput[]) => rules.length ? shippingRegionRulesTsv(rules) : '';
type ParsedRegionRules = ReturnType<typeof parseShippingRegionRulesTsv>;
/** 버튼을 누른 순간의 시각. 저장 버튼의 핸들러에서만 부른다(그리는 중에는 창을 연 시각 `now`를 쓴다). */
const pressedAt = () => Date.now();
function koreaInput(value: string | null): string { return value ? new Date(Date.parse(value) + 9 * 3_600_000).toISOString().slice(0, 16) : ''; }
function fromKoreaInput(value: string): string | null {
  if (!value) return null;
  const milliseconds = Date.parse(`${value}:00+09:00`);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

/**
 * 이 묶음그룹만의 지역표. 지역별 추가배송비 관리 화면과 같은 칸·같은 말을 쓴다(lib/admin/shipping-regions.ts).
 *   - 택배사는 고르지 않는다. 출고지의 기본 택배사와 다르면 주문이 막히므로(견적 `shipping_unresolved`) 그 택배사로 정해 둔다.
 *   - 물류사 회신·계약 근거 칸과 '예외 지역 없음' 체크는 없다. 받는 지역이 없으면 '추가배송비를 받는 지역 없음'을 고른다.
 *   - 적용 기간 밖에는 이 묶음그룹 상품의 주문이 막힌다. 그 결과만 칸 아래 한 줄로 알린다.
 */
function RegionFields({ policy, onChange, tsv, onTsvChange, disabled, carriers, origin, now }: {
  policy: ShippingChargeGroupRegionPolicy; onChange: (value: ShippingChargeGroupRegionPolicy) => void;
  tsv: string; onTsvChange: (value: string) => void; disabled: boolean; carriers: EditableCarrier[];
  origin: ShippingChargeGroupOriginGuard | null; now: number;
}) {
  const fieldId = useId();
  const patch = (value: Partial<ShippingChargeGroupRegionPolicy>) => onChange({ ...policy, ...value });
  /* 읽은 결과의 모양을 적어 둔다 — 적지 않으면 오류가 없는 갈래에서 `error`를 읽는 줄이 타입 검사 순서에 따라 오류가 된다. */
  const parsed: ParsedRegionRules = policy.noRulesConfirmed ? { rules: [] } : parseShippingRegionRulesTsv(tsv, policy.rules);
  const rules = parsed.rules ?? [];
  const carrierLabel = (code: string | null | undefined) => carriers.find(carrier => carrier.code === code)?.label ?? (code || '없음');
  const carrier = carriers.find(item => item.code === policy.carrierCode);
  const mismatch = Boolean(origin) && policy.carrierCode !== (origin?.defaultCarrier ?? '');
  return <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border p-3 sm:p-4" data-charge-group-region="">
    <legend className="float-left w-full p-0 text-sm font-medium">이 묶음그룹의 지역표</legend>
    <p className={`${NOTE} clear-both`} data-charge-group-region-carrier="">택배사: {carrierLabel(policy.carrierCode)} · 추가배송비는 묶음그룹마다 한 번만 받습니다.</p>
    {mismatch ? <AdminNotice role="alert" tone="warning"><p>지역표의 택배사({carrierLabel(policy.carrierCode)})가 출고지의 지금 기본 택배사({carrierLabel(origin?.defaultCarrier)})와 달라 &lsquo;사용&rsquo;으로 저장할 수 없습니다.</p>
      {origin?.defaultCarrier ? <Button className="mt-2" onClick={() => patch({ carrierCode: origin.defaultCarrier ?? '' })} size="sm" type="button" variant="outline">출고지의 기본 택배사로 바꾸기</Button>
        : <p className="mt-1">배송정보 관리에서 출고지의 기본 택배사를 먼저 골라 주세요.</p>}</AdminNotice>
      : carrier && !carrier.active ? <AdminNotice role="alert" tone="warning">출고지의 기본 택배사({carrier.label})가 &lsquo;사용 안 함&rsquo;이라 &lsquo;사용&rsquo;으로 저장할 수 없습니다. 택배사 관리에서 &lsquo;사용&rsquo;으로 바꾸거나 배송정보 관리에서 기본 택배사를 바꿔 주세요.</AdminNotice> : null}
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={FIELD_LABEL}>추가배송비를 받는 지역<NativeSelect className="w-full" value={policy.noRulesConfirmed ? 'none' : 'table'} onChange={event => patch({ noRulesConfirmed: event.target.value === 'none' })}>
        <option value="table">지역표로 정하기</option><option value="none">추가배송비를 받는 지역 없음</option>
      </NativeSelect></label>
      <label className={FIELD_LABEL}>표에 없는 지역<NativeSelect className="w-full" value={policy.unlistedDisposition ?? ''} onChange={event => patch({ unlistedDisposition: event.target.value === '' ? null : event.target.value as 'standard' | 'manual_review' })}>
        {policy.unlistedDisposition === null ? <option value="">골라 주세요</option> : null}<option value="standard">추가배송비 없이 주문받기</option><option value="manual_review">주문받지 않기</option>
      </NativeSelect></label>
      <label className={FIELD_LABEL}>적용 시작 (KST)<Input type="datetime-local" value={koreaInput(policy.startsAt)} onChange={event => patch({ startsAt: fromKoreaInput(event.target.value) })} />
        {policy.startsAt && Date.parse(policy.startsAt) > now ? <small className={FIELD_HINT} data-charge-group-region-start="">이 시각 전에는 이 묶음그룹 상품의 새 주문이 막힙니다.</small> : null}</label>
      <label className={FIELD_LABEL}>적용 종료<NativeSelect className="w-full" value={policy.openEnded === null ? '' : policy.openEnded ? 'open' : 'date'} onChange={event => patch(event.target.value === 'open' ? { openEnded: true, endsAt: null } : event.target.value === 'date' ? { openEnded: false } : { openEnded: null })}>
        {policy.openEnded === null ? <option value="">골라 주세요</option> : null}<option value="open">정하지 않음 · 계속 적용</option><option value="date">날짜와 시각 정하기</option>
      </NativeSelect></label>
      {policy.openEnded === false ? <label className={FIELD_LABEL}>적용 종료 (KST)<Input type="datetime-local" value={koreaInput(policy.endsAt)} onChange={event => patch({ endsAt: fromKoreaInput(event.target.value) })} />
        <small className={FIELD_HINT} data-charge-group-region-end="">이 시각 뒤에는 이 묶음그룹 상품의 새 주문이 막힙니다.</small></label> : null}
    </div>
    {policy.noRulesConfirmed ? null : <div className={FIELD_LABEL}>
      <AdminLabelWithHelp help={SHIPPING_REGIONS_HELP.regionTable} label="지역표"><label htmlFor={`${fieldId}-table`}>지역표</label></AdminLabelWithHelp>
      <Textarea className={TSV_TEXTAREA} id={`${fieldId}-table`} maxLength={500000} placeholder={SHIPPING_REGION_TSV_EXAMPLE} rows={7} spellCheck={false} value={tsv} onChange={event => onTsvChange(event.target.value)} />
    </div>}
    {parsed.error ? <AdminNotice role="alert" title="지역표를 고쳐 주세요" tone="warning">{parsed.errors.length > 1 ? <ul className="flex list-disc flex-col gap-1 pl-5">{parsed.errors.map((problem, index) => <li key={index}>{problem}</li>)}</ul> : parsed.error}</AdminNotice> : null}
    {rules.length ? <section className="flex min-w-0 flex-col gap-2" data-charge-group-region-preview="">
      <h4 className="text-sm font-semibold">지역표 미리보기 · {rules.length}줄</h4>
      <div className={TABLE_BOX}><Table className="min-w-[40rem]"><caption className="sr-only">지역표 미리보기</caption>
        <TableHeader className="bg-muted/50"><TableRow className="hover:bg-transparent"><TableHead className="w-12 text-right" scope="col">줄</TableHead><TableHead scope="col">우편번호</TableHead><TableHead scope="col">주소 시작문구</TableHead><TableHead scope="col">지역명</TableHead><TableHead scope="col">처리</TableHead><TableHead className="text-right" scope="col">추가배송비</TableHead></TableRow></TableHeader>
        <TableBody>{rules.slice(0, 50).map((row, index) => <TableRow key={row.id ?? index}><TableCell className="text-right tabular-nums text-muted-foreground">{index + 1}</TableCell>
          <TableCell className="tabular-nums">{row.postalFrom || '빈칸'}~{row.postalTo || '빈칸'}</TableCell><TableCell className="whitespace-normal">{row.addressPrefix || '우편번호만 봄'}</TableCell><TableCell>{row.regionLabel || '빈칸'}</TableCell>
          <TableCell>{row.disposition ? REGION_DISPOSITION_LABELS[row.disposition] : '빈칸'}</TableCell><TableCell className="text-right tabular-nums">{row.amount === null ? row.disposition === 'surcharge' ? '빈칸' : '-' : krwAmountWords(row.amount)}</TableCell></TableRow>)}</TableBody></Table>
        {rules.length > 50 ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">앞의 50줄만 보입니다. 나머지 {rules.length - 50}줄도 함께 저장합니다.</p> : null}</div>
    </section> : null}
  </fieldset>;
}

export type ShippingChargeGroupEditorStart = { id: string; data: ShippingChargeGroupData | null; originId: string };

/**
 * 배송비 묶음그룹 편집 창. 템플릿 편집 창(사이즈·A/S·이벤트·배송정보)과 같은 말을 쓴다(lib/admin/goods-template-save.ts).
 *   - 고른 값의 뜻을 요약 상자가 예시 금액으로 바로 되읽는다(설명 문단을 두지 않는다).
 *   - 보관·복원은 목록의 줄에서 한다. 이 창에는 사용 여부만 있다.
 *   - 지역별 추가배송비가 바뀌는 저장은 확인창 한 번을 거친다(대상·금액·적용 기간·주문이 막히는 경우). 근거 칸과 확인 체크는 없다.
 *   - 적은 내용이 있으면 닫기 전에 묻는다.
 *   - 다른 사람이 먼저 바꿨으면 입력을 그대로 둔 채 두 길을 고른다: 내 입력으로 덮어쓰기 / 내 입력 버리기.
 * `onClose(true)`는 목록을 다시 읽어야 하는 닫기다.
 */
export function ShippingChargeGroupEditor({ start, identity, scope, origins, carriers, canEdit, canManageRegional, initialList, otherPending, onClose, onSaved }: {
  start: ShippingChargeGroupEditorStart; identity: ShippingChargeGroupIdentity; scope: ShippingChargeGroupScope; origins: GoodsFulfillmentOrigin[];
  carriers: EditableCarrier[]; canEdit: boolean; canManageRegional: boolean; initialList: ShippingChargeGroupListData;
  otherPending: boolean; onClose: (refresh?: boolean) => void; onSaved: (receipt: ShippingChargeGroupOperationReceipt) => void;
}) {
  /* 창을 연 시각. 새 지역표의 적용 시작 기본값(그날 0시)과 '아직 시작 전' 안내에 쓴다. */
  const [now] = useState(() => Date.now());
  const [base, setBase] = useState(start.data?.group ?? null);
  const [values, setValues] = useState(() => start.data ? shippingChargeGroupValuesOf(start.data.group) : emptyShippingChargeGroupValues());
  const [originId, setOriginId] = useState(start.data?.origin.id ?? start.originId);
  const [origin, setOrigin] = useState<ShippingChargeGroupOriginGuard | null>(start.data?.origin ?? initialList.origins.find(item => item.id === start.originId) ?? null);
  const [capabilities, setCapabilities] = useState({ runtimeEnabled: start.data?.runtimeEnabled ?? initialList.runtimeEnabled, canManageRegional: start.data?.canManageRegional ?? initialList.canManageRegional });
  /* 창을 열 때의 지역표. 저장돼 있으면 그것, 없으면 대부분이 쓰는 값(오늘 0시부터·계속 적용·표에 없는 지역은 추가배송비 없음)을 채워 둔다. */
  const [initial] = useState(() => {
    const region = start.data?.group.regional.mode === 'override' ? orderedPolicy(start.data.group.regional.policy) : defaultShippingChargeGroupRegionPolicy(origin?.defaultCarrier ?? '', now);
    return { region, tsv: tsvOf(region.rules) };
  });
  const [regional, setRegional] = useState(initial.region), [tsv, setTsv] = useState(initial.tsv);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempted, setAttempted] = useState(false);
  const [reading, setReading] = useState(false), [conflict, setConflict] = useState(false), [latest, setLatest] = useState<ShippingChargeGroupData | null>(null);
  const readLane = useRef(false), alive = useRef(true), touched = useRef(false), root = useRef<HTMLFormElement>(null);
  const operation = useShippingChargeGroupOperation({ identity, scope, groupId: start.id, command: 'save',
    onReceipt: receipt => {
      if (receipt.state === 'saved') onSaved(receipt);
      else if (receipt.state === 'sealed') setNotice('저장하지 않았습니다. 적은 내용은 그대로 있습니다. 확인한 뒤 다시 저장해 주세요.');
    },
    /* 저장되지 않은 것이 확실한 실패. 다른 사람이 먼저 바꾼 경우에는 지금 저장된 내용을 읽어 두 길을 보인다. 그 밖의 이유는 operation.error에 남는다. */
    onFailure: failure => { if (failure.changed) { setConflict(true); void readLatest(); } },
  });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /* 지역표 글을 고치지 않았으면 저장돼 있던 줄을 그대로 보낸다(줄 번호가 새로 매겨지면 고치지 않은 지역표도 바뀐 것으로 저장된다). */
  const parsed: ParsedRegionRules = regional.noRulesConfirmed ? { rules: [] } : tsv === initial.tsv ? { rules: regional.rules } : parseShippingRegionRulesTsv(tsv, regional.rules);
  const currentRegional: ShippingChargeGroupValues['regional'] = values.regional.mode === 'inherit' ? { mode: 'inherit', policy: null }
    : { mode: 'override', policy: { ...regional, sourceEvidence: regional.sourceEvidence.trim(), rules: parsed.rules ?? regional.rules } };
  const current: ShippingChargeGroupValues = { ...values, name: values.name.trim(), regional: currentRegional };
  const pending = operation.busy || reading, unknown = Boolean(operation.context), locked = pending || unknown || conflict || otherPending;
  const inUse = (base?.assignedCount ?? 0) > 0;
  const regionalAllowed = canManageRegional && capabilities.canManageRegional;
  const regionProblems = currentRegional.mode === 'override' && !parsed.error ? shippingChargeGroupRegionalProblems(currentRegional.policy) : [];
  const carrierActive = (code: string) => carriers.find(carrier => carrier.code === code)?.active;
  const touch = () => { touched.current = true; };
  function change(patch: Partial<ShippingChargeGroupValues>) { setValues(previous => ({ ...previous, ...patch })); touch(); setError(''); }
  function changeRegion(value: ShippingChargeGroupRegionPolicy) { setRegional(value); touch(); setError(''); }
  /** 지역 설정이 바뀌는 저장인가. DB(`admin_save_shipping_charge_group`)와 같은 판정이다: 지역 설정이 달라졌거나, 지역표를 쓰는 묶음그룹을 '사용'으로 켠다. */
  function regionalReview(target: ShippingChargeGroup | null) {
    const changed = regionalKey(currentRegional) !== regionalKey(target?.regional ?? { mode: 'inherit', policy: null });
    return changed || currentRegional.mode === 'override' && current.enabled && !current.archived && !(target?.enabled && !target.archived);
  }
  async function readOrigin(id: string) {
    if (readLane.current || locked || !id) return;
    const ticket = scope.capture(); if (!ticket) return;
    readLane.current = true; setReading(true); setError('');
    try {
      const result = await listShippingChargeGroupsAction({ originId: id, query: '', status: 'all', page: 1 }, identity);
      if (!alive.current || !scope.canApply(ticket)) return;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return; }
      const found = result.data.origins.find(item => item.id === id) ?? null;
      setOrigin(found); setCapabilities({ runtimeEnabled: result.data.runtimeEnabled, canManageRegional: result.data.canManageRegional });
      /* 새 묶음그룹의 지역표는 고른 출고지의 기본 택배사를 따른다. */
      if (!base) setRegional(previous => ({ ...previous, carrierCode: found?.defaultCarrier ?? '' }));
    } catch { if (alive.current && scope.canApply(ticket)) setError('출고지를 불러오지 못했습니다. 적은 내용은 그대로 있습니다. 출고지를 다시 골라 주세요.'); }
    finally { readLane.current = false; if (alive.current && scope.canApply(ticket)) setReading(false); }
  }
  /** 지금 저장된 묶음그룹(새로 만드는 중이면 출고지)을 읽는다. 읽지 못했으면 null(화면에 이유를 보인다). */
  async function readLatest(): Promise<{ group: ShippingChargeGroup | null; origin: ShippingChargeGroupOriginGuard; capabilities: typeof capabilities } | null> {
    if (readLane.current) return null;
    const ticket = scope.capture(); if (!ticket) return null;
    readLane.current = true; setReading(true); setError('');
    try {
      if (base) {
        const result = await getShippingChargeGroupAction(start.id, identity);
        if (!alive.current || !scope.canApply(ticket)) return null;
        if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return null; }
        setLatest(result.data);
        return { group: result.data.group, origin: result.data.origin, capabilities: { runtimeEnabled: result.data.runtimeEnabled, canManageRegional: result.data.canManageRegional } };
      }
      const result = await listShippingChargeGroupsAction({ originId, query: '', status: 'all', page: 1 }, identity);
      if (!alive.current || !scope.canApply(ticket)) return null;
      if ('error' in result) { setError(result.error); if (result.authChanged) scope.authenticate(null, null); return null; }
      const found = result.data.origins.find(item => item.id === originId);
      if (!found) { setError(TEMPLATE_LATEST_UNREAD_MESSAGE); return null; }
      return { group: null, origin: found, capabilities: { runtimeEnabled: result.data.runtimeEnabled, canManageRegional: result.data.canManageRegional } };
    } catch { if (alive.current && scope.canApply(ticket)) setError(TEMPLATE_LATEST_UNREAD_MESSAGE); return null; }
    finally { readLane.current = false; if (alive.current && scope.canApply(ticket)) setReading(false); }
  }
  /** 적은 값을 `target`(지금 저장된 묶음그룹) 위에 저장한다. 저장하기 전에 막을 것은 여기서 말하고, 지역 설정이 바뀌면 확인창을 거친다. `clock`은 누른 순간의 시각이다. */
  async function save(target: ShippingChargeGroup | null, guard: ShippingChargeGroupOriginGuard | null, allowed: typeof capabilities, clock: number) {
    if (!canEdit) return;
    if (!guard || guard.id !== originId) { setError('출고지를 골라 주세요.'); return; }
    if (!current.name || [...current.name].length > 80) { setError('묶음그룹 이름을 80자 안으로 적어 주세요.'); return; }
    if ((target?.assignedCount ?? 0) > 0 && (!current.enabled || current.archived)) { setError(`상품 ${target?.assignedCount.toLocaleString('ko-KR')}개가 들어 있어 '사용 안 함'으로 바꿀 수 없습니다. 목록의 상품 수를 눌러 상품을 먼저 빼거나 다른 묶음그룹으로 옮겨 주세요.`); return; }
    if (current.enabled && !allowed.runtimeEnabled) { setError(SHIPPING_CHARGE_GROUP_RUNTIME_OFF); return; }
    if (current.enabled && !guard.isActive) { setError("출고지가 '사용 안 함'이라 '사용'으로 저장할 수 없습니다. 배송정보 관리에서 출고지를 '사용'으로 바꾸거나 '사용 안 함'으로 저장해 주세요."); return; }
    if (currentRegional.mode === 'override' && parsed.error) { setAttempted(true); setError('지역표를 읽지 못했습니다. 지역표 아래 안내대로 고친 뒤 다시 저장해 주세요.'); return; }
    const review = regionalReview(target);
    if (review && !(canManageRegional && allowed.canManageRegional)) { setError('지역별 추가배송비 설정을 바꾸는 저장은 최고 관리자만 할 수 있습니다. 지역 설정을 그대로 두면 이름·사용 여부·계산 방식은 지금 권한으로 저장됩니다.'); return; }
    if (current.enabled && !current.archived && currentRegional.mode === 'override') {
      if (regionProblems.length) { setAttempted(true); setError("'사용'으로 저장하려면 지역표 아래 안내대로 채워 주세요. 아직 정하지 못했으면 '사용 안 함'으로 저장해 둘 수 있습니다."); return; }
      const block = shippingChargeGroupRegionBlock(currentRegional.policy, guard, carrierActive(currentRegional.policy.carrierCode), clock);
      if (block === 'carrier_mismatch' || block === 'carrier_inactive') { setError("지역표의 택배사가 출고지의 기본 택배사와 다르거나 '사용 안 함'이라 '사용'으로 저장할 수 없습니다. 지역표 위 안내대로 맞춘 뒤 다시 저장해 주세요."); return; }
    }
    const request = parseShippingChargeGroupSaveRequest({ operationId: crypto.randomUUID(), command: 'save', groupId: start.id,
      expectedRevision: target?.revision ?? 0, ...identity, originId, originUpdatedAt: guard.updatedAt,
      expectedDefaultGroupId: guard.defaultGroupId, expectedDefaultGroupRevision: guard.defaultGroupRevision,
      values: current, attestRegional: review });
    if (!request) { setError('적은 값의 형식이 맞지 않아 저장하지 않았습니다. 이름과 지역표를 확인한 뒤 다시 저장해 주세요.'); return; }
    /* 저장하는 순간 이 묶음그룹 상품의 주문에 적용된다. 확인 체크 대신 대상·금액·적용 기간을 보여 주고 한 번 묻는다. */
    if (review && !await adminConfirm({ title: '묶음그룹의 지역별 추가배송비 바꾸기', confirmLabel: '저장', cancelLabel: '돌아가기',
      message: shippingChargeGroupRegionConfirmMessage({ name: current.name, originName: guard.name, assignedCount: target?.assignedCount ?? 0,
        enabled: current.enabled && !current.archived, regional: currentRegional, now: clock, formatDate: formatOrderDateTime }) })) { reopenClosedDialog(root.current); return; }
    setError(''); setNotice(''); setAttempted(false);
    await operation.send(request);
  }
  async function submit(event: FormEvent<HTMLFormElement>, clock: number) {
    event.preventDefault();
    if (locked) return;
    await save(base, origin, capabilities, clock);
  }
  /** [내 입력으로 덮어쓰기]: 적은 값을 지금 저장된 묶음그룹 위에 다시 저장한다. */
  async function saveOverLatest(clock: number) {
    if (pending || unknown || otherPending) return;
    const target = await readLatest(); if (!target) return;
    setBase(target.group); setOrigin(target.origin); setCapabilities(target.capabilities); setConflict(false); setLatest(null);
    await save(target.group, target.origin, target.capabilities, clock);
  }
  async function discardInput() {
    if (pending || unknown) return;
    if (await adminConfirm(TEMPLATE_DISCARD_INPUT_CONFIRM)) onClose(true); else reopenClosedDialog(root.current);
  }
  async function close() {
    if (pending || unknown) return;
    if (touched.current && canEdit && !await adminConfirm(ADMIN_DIALOG_CLOSE_DIRTY_CONFIRM)) { reopenClosedDialog(root.current); return; }
    onClose(conflict);
  }
  /* 사용 안 하는 출고지는 새로 고를 수 없다. 이미 그 출고지에 만든 묶음그룹의 출고지만 목록에 남긴다. */
  const originOptions = origins.filter(item => item.active || item.id === originId);
  /* 고른 값의 뜻을 요약 상자로 되읽는다(이름이 비면 자리만 채운다). */
  const readback = { id: start.id, originId, revision: base?.revision ?? 0, name: current.name || '새 묶음그룹', enabled: current.enabled, archived: current.archived,
    calculationMode: current.calculationMode, regionalMode: currentRegional.mode };
  const enableBlocked = !capabilities.runtimeEnabled ? SHIPPING_CHARGE_GROUP_RUNTIME_OFF
    : origin && !origin.isActive ? "출고지가 '사용 안 함'이라 '사용'을 고를 수 없습니다. 배송정보 관리에서 출고지를 '사용'으로 바꿔 주세요." : '';
  return <CustomerServiceDialog title={!canEdit ? '배송비 묶음그룹' : base ? '배송비 묶음그룹 수정' : '배송비 묶음그룹 추가'} onClose={() => { void close(); }} busy={pending || unknown} wide>
    <form className="flex min-w-0 flex-col gap-4" data-charge-group-editor="" onChange={touch} onSubmit={event => { void submit(event, pressedAt()); }} ref={root}>
      <fieldset disabled={locked || !canEdit} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={FIELD_LABEL}>출고지<NativeSelect className="w-full" value={originId} disabled={Boolean(base)} onChange={event => { const id = event.target.value; setOriginId(id); setOrigin(null); touch(); if (id) void readOrigin(id); }}>
            <option value="">골라 주세요</option>{originOptions.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' · 사용 안 함'}</option>)}
          </NativeSelect></label>
          <label className={FIELD_LABEL}>묶음그룹 이름<Input value={values.name} maxLength={80} required placeholder="예: 김포 기본 묶음" onChange={event => change({ name: event.target.value })} /></label>
          <label className={FIELD_LABEL}>사용 여부<NativeSelect className="w-full" value={String(values.enabled)} disabled={inUse || values.archived || (!regionalAllowed && base?.regional.mode === 'override' && !base.enabled)} onChange={event => {
            const enabled = event.target.value === 'true'; change({ enabled, ...(!enabled ? { isDefault: false } : {}) });
          }}><option value="false">사용 안 함</option><option value="true" disabled={Boolean(enableBlocked)}>사용</option></NativeSelect>
            {values.archived ? <small className={FIELD_HINT} data-charge-group-archived="">보관한 묶음그룹입니다. 목록에서 [복원]한 뒤 &lsquo;사용&rsquo;으로 바꿀 수 있습니다.</small>
              : inUse ? <small className={FIELD_HINT} data-charge-group-in-use="">상품 {base?.assignedCount.toLocaleString('ko-KR')}개가 들어 있어 &lsquo;사용 안 함&rsquo;으로 바꿀 수 없습니다. 목록의 상품 수를 눌러 상품을 먼저 빼 주세요.</small>
              : !regionalAllowed && base?.regional.mode === 'override' && !base.enabled ? <small className={FIELD_HINT} data-charge-group-enable-locked="">지역표를 쓰는 묶음그룹은 최고 관리자만 &lsquo;사용&rsquo;으로 바꿀 수 있습니다.</small> : null}</label>
          <label className={FIELD_LABEL}>배송비 계산<NativeSelect className="w-full" value={values.calculationMode} onChange={event => change({ calculationMode: event.target.value as 'min' | 'max' })}><option value="min">{SHIPPING_CHARGE_GROUP_MODE_LABELS.min}</option><option value="max">{SHIPPING_CHARGE_GROUP_MODE_LABELS.max}</option></NativeSelect></label>
        </div>
        {enableBlocked && !values.archived ? <AdminNotice role="status" tone="warning"><p data-charge-group-enable-blocked="">{enableBlocked}</p></AdminNotice> : null}
        <ShippingChargeGroupSummary group={readback} example />
        <label className={CHECK_LABEL}><input type="checkbox" checked={values.isDefault} disabled={!values.enabled || values.archived} onChange={event => change({ isDefault: event.target.checked })} /><span>묶음그룹 고르기 창에서 &lsquo;추천&rsquo;으로 보이기</span></label>
        {values.isDefault && origin?.defaultGroupId && origin.defaultGroupId !== start.id ? <p className={NOTE} data-charge-group-default-note="">추천은 출고지마다 하나입니다. 저장하면 지금 추천인 다른 묶음그룹에서 표시가 빠집니다.</p> : null}
        <label className={FIELD_LABEL}>지역별 추가배송비<NativeSelect className="w-full sm:max-w-md" value={values.regional.mode} disabled={!regionalAllowed} onChange={event => change({ regional: event.target.value === 'inherit' ? { mode: 'inherit', policy: null } : { mode: 'override', policy: regional } })}>
          <option value="inherit">출고지 설정 그대로</option><option value="override">이 묶음그룹의 지역표로 정하기</option>
        </NativeSelect>
          {!regionalAllowed ? <small className={FIELD_HINT} data-charge-group-region-locked="">지역별 추가배송비 설정은 최고 관리자만 바꿀 수 있습니다. 이름·사용 여부·계산 방식은 지금 권한으로 저장됩니다.</small> : null}</label>
        {values.regional.mode === 'override' ? <RegionFields policy={regional} onChange={changeRegion} tsv={tsv} onTsvChange={value => { setTsv(value); touch(); setError(''); }}
          disabled={!regionalAllowed} carriers={carriers} origin={origin} now={now} /> : null}
        {attempted && values.regional.mode === 'override' && regionProblems.length ? <AdminNotice role="alert" title="'사용'으로 저장하려면 채워 주세요" tone="warning"><ul className="flex list-disc flex-col gap-1 pl-5" data-charge-group-region-problems="">{regionProblems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></AdminNotice> : null}
      </fieldset>
      {conflict ? <AdminNotice role="alert" tone="warning">
        <p>{CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다.</p>
        {latest ? <div className="mt-2 flex min-w-0 flex-col gap-1" data-goods-template-latest=""><strong className="font-medium">지금 저장된 묶음그룹 · 넣은 상품 {latest.group.assignedCount.toLocaleString('ko-KR')}개</strong>
          <ShippingChargeGroupSummary group={latest.group} originName={latest.origin.name} /></div>
          : reading ? <p className="mt-2 text-muted-foreground">지금 저장된 내용을 불러오고 있습니다.</p> : null}
        <p className="mt-2 text-xs" data-goods-template-overwrite-note="">{TEMPLATE_SAVE_OVER_LATEST_NOTE}</p>
        <div className={`${ACTIONS} mt-2`}>
          <Button disabled={pending || unknown || otherPending || !canEdit} onClick={() => { void saveOverLatest(pressedAt()); }} size="sm" type="button">{TEMPLATE_SAVE_OVER_LATEST_LABEL}</Button>
          <Button disabled={pending || unknown} onClick={() => { void discardInput(); }} size="sm" type="button" variant="outline">{TEMPLATE_DISCARD_INPUT_LABEL}</Button>
        </div>
      </AdminNotice> : null}
      {otherPending ? <AdminNotice role="status" tone="neutral">저장됐는지 확인하지 못한 다른 일이 남아 있습니다. 이 창을 닫고 목록 위에서 먼저 확인해 주세요.</AdminNotice> : null}
      {error || !conflict && !unknown && operation.error ? <AdminNotice role="alert" tone="danger">{error || operation.error}</AdminNotice> : null}
      {notice && !unknown && !conflict ? <AdminNotice role="status" tone="neutral">{notice}</AdminNotice> : null}
      {unknown ? <AdminNotice role="alert" tone="warning">
        <p>{operation.error || SAVE_UNKNOWN_MESSAGE}</p>{operation.message ? <p className="mt-1">{operation.message}</p> : null}
        <div className={`${ACTIONS} mt-2`}><Button disabled={pending} onClick={() => { void operation.recover(); }} size="sm" type="button">{SAVE_CHECK_LABEL}</Button>
          <Button disabled={pending || !canEdit} onClick={() => { void operation.recover(true); }} size="sm" type="button" variant="outline">{SHIPPING_CHARGE_GROUP_STOP_LABEL}</Button></div>
      </AdminNotice> : null}
      <div className={`${ACTIONS} justify-end border-t pt-4`}>
        <Button disabled={pending || unknown} onClick={() => { void close(); }} type="button" variant="ghost">닫기</Button>
        {conflict || !canEdit ? null : <Button disabled={locked} type="submit">{operation.busy ? '저장하는 중…' : base ? '저장' : '묶음그룹 추가'}</Button>}
      </div>
    </form>
  </CustomerServiceDialog>;
}

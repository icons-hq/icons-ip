'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { saveShippingRegionPolicyAction, setShippingRegionPolicyStatusAction } from '@/app/admin/shipping-region-actions';
import { AdminPageHeader, AdminSectionCard } from '../console/AdminKit';
import type { FulfillmentOrigin } from '@/lib/admin/fulfillment-origins';
import type { EditableCarrier } from '@/lib/admin/store-settings';
import {
  emptyShippingRegionPolicy, parseShippingRegionPolicyInput, parseShippingRegionRulesTsv, REGION_DISPOSITION_LABELS, shippingRegionPolicyProblems,
  shippingRegionRulesTsv, type ShippingRegionPolicy, type ShippingRegionPolicyInput,
} from '@/lib/admin/shipping-regions';
import type { ShippingRegionAdoption } from '@/lib/admin/shipping-regions.server';
import { formatOrderDateTime } from '@/lib/orders';
import { krw } from '@/lib/format';

function koreaInput(value: string | null): string { return value ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16) : ''; }
function fromKoreaInput(value: string): string | null { return value ? new Date(`${value}:00+09:00`).toISOString() : null; }
function yesNo(value: boolean | null): string { return value === null ? '' : value ? 'yes' : 'no'; }
function fromYesNo(value: string): boolean | null { return value === '' ? null : value === 'yes'; }
const STATUS_LABELS = { draft: '초안', active: '활성', retired: '중단' };

function ShippingRegionEditor({ policy, initialCopy, origins, carriers, canEdit, onSaved }: {
  policy: ShippingRegionPolicy | null; origins: FulfillmentOrigin[]; carriers: EditableCarrier[]; canEdit: boolean;
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
    return <label>{label}<select value={yesNo(input[key])} onChange={(event) => change({ [key]: fromYesNo(event.target.value) })}>
      <option value="">미확인</option><option value="yes">예</option><option value="no">아니요</option>
    </select></label>;
  }
  return <div className="col" style={{ gap: 16 }}>
    <fieldset disabled={pending || readOnly} className="col" style={{ gap: 16, border: 0, padding: 0, margin: 0 }}>
      <legend className="sr-only">지역 배송 정책 입력</legend>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <label>출고지<select value={input.originId} disabled={Boolean(policy)} onChange={(event) => change({ originId: event.target.value })}>
          <option value="">선택해주세요</option>{origins.map((origin) => <option key={origin.id} value={origin.id}>{origin.name}{origin.active ? '' : ' · 비활성'}</option>)}
        </select></label>
        <label>계약 택배사<select value={input.carrierCode} disabled={Boolean(policy)} onChange={(event) => change({ carrierCode: event.target.value })}>
          <option value="">선택해주세요</option>{carriers.map((carrier) => <option key={carrier.code} value={carrier.code}>{carrier.label}{carrier.active ? '' : ' · 비활성'}</option>)}
        </select></label>
        <label>정책 이름<input value={input.name} maxLength={100} onChange={(event) => change({ name: event.target.value })} /></label>
        <label>적용 시작 · 한국 시각<input type="datetime-local" value={koreaInput(input.startsAt)} onChange={(event) => change({ startsAt: fromKoreaInput(event.target.value) })} /></label>
        <label>적용 종료 방식<select value={yesNo(input.openEnded)} onChange={(event) => {
          const openEnded = fromYesNo(event.target.value); change({ openEnded, ...(openEnded ? { endsAt: null } : {}) });
        }}><option value="">미확인</option><option value="yes">무기한</option><option value="no">종료 일시 지정</option></select></label>
        <label>적용 종료 · 한국 시각<input type="datetime-local" disabled={input.openEnded === true} value={koreaInput(input.endsAt)}
          onChange={(event) => change({ endsAt: fromKoreaInput(event.target.value) })} /></label>
      </div>
      <label>물류사 원본 회신·계약 근거<textarea rows={3} maxLength={2000} value={input.sourceEvidence}
        onChange={(event) => change({ sourceEvidence: event.target.value })} /></label>
      <p className="muted">실제 회신·계약을 찾을 수 있는 사내 문서번호나 접근 제한 문서 주소를 입력하세요. 근거 참조는 고객에게 공개되지 않습니다.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
        <label>표에 없는 지역<select value={input.unlistedDisposition ?? ''} onChange={(event) => change({ unlistedDisposition: (event.target.value || null) as ShippingRegionPolicyInput['unlistedDisposition'] })}>
          <option value="">미확인</option><option value="standard">추가료 없음</option><option value="manual_review">개별 확인 필요</option>
        </select></label>
        <label>추가료 부과 단위<select value={input.feeUnit ?? ''} onChange={(event) => change({ feeUnit: (event.target.value || null) as ShippingRegionPolicyInput['feeUnit'] })}>
          <option value="">미확인</option><option value="per_shipment">출고지 배송 건당 한 번</option><option value="per_good">대상 상품당 한 번 · 옵션·수량 무관</option>
        </select></label>
        {booleanField('chargePolicyGoods', '정책 배송비 상품에 지역 추가료 부과')}
        {booleanField('waivePolicyThreshold', '무료 기준 금액을 채운 정책 상품은 지역료 면제')}
        {booleanField('chargeFreeGoods', '무료배송 상품에 지역 추가료 부과')}
        {booleanField('chargeIndividualGoods', '개별 배송비 상품에 지역 추가료 부과')}
      </div>
      <label>지역표 · 스프레드시트의 6개 열을 붙여넣기<textarea rows={9} value={tsv} maxLength={500000}
        spellCheck={false} onChange={(event) => { setTsv(event.target.value); setAttested(false); }} /></label>
      <p className="muted">우편번호 시작·끝은 5자리이며 양 끝을 포함합니다. 주소 시작문구는 공백을 정리한 기본주소의 시작 부분과 단어 경계가 정확히 일치해야 합니다.
        처리 열은 ‘추가료 없음’, ‘추가료 부과’, ‘배송 불가’, ‘개별 확인 필요’ 중 하나입니다. 추가료 부과 행에만 원 단위 정수를 입력하며, 0원도 명시해야 합니다. 최대 1,000행입니다.</p>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={input.noRulesConfirmed} onChange={(event) => change({ noRulesConfirmed: event.target.checked })} />
        실제 회신에 예외 지역이 없으며 지역표가 비어 있음을 확인했습니다.</label>
    </fieldset>
    <details><summary>지역표·고객 안내 미리보기 · {parsed.rules?.length ?? 0}행</summary>
      <p>배송비는 아래 판정과 실제 주문의 무료·묶음 적용 기준을 함께 계산합니다. 배송 불가·개별 확인 필요 주소는 결제할 수 없습니다.</p>
      {parsed.rules?.length ? <div className="admin-console-grid-scroll"><table className="admin-console-grid-table" style={{ minWidth: 640 }}>
        <caption className="sr-only">지역 추가 배송비 적용 구간</caption>
        <thead><tr><th scope="col">우편번호</th><th scope="col">기본주소 시작</th><th scope="col">고객 지역명</th><th scope="col">처리</th><th scope="col" data-align="end">계약 추가료</th></tr></thead>
        <tbody>{parsed.rules.slice(0, 50).map((rule, index) => <tr key={rule.id ?? index}><td>{rule.postalFrom || '미입력'}~{rule.postalTo || '미입력'}</td>
          <td>{rule.addressPrefix || '우편번호만 판정'}</td><td>{rule.regionLabel || '미입력'}</td><td>{rule.disposition ? REGION_DISPOSITION_LABELS[rule.disposition] : '미입력'}</td>
          <td data-align="end">{rule.amount === null ? rule.disposition === 'surcharge' ? '미입력' : '해당 없음' : krw(rule.amount)}</td></tr>)}</tbody></table>
        {parsed.rules.length > 50 ? <p>앞의 50행을 표시합니다. 저장·서버 검증은 전체 {parsed.rules.length}행에 적용합니다.</p> : null}</div> : <p>입력된 지역표가 없습니다.</p>}
    </details>
    {!readOnly && problems.length > 0 ? <div><strong>활성화 전 확인</strong><ul>{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div> : null}
    {!readOnly ? <>
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={save}>초안 저장</button>
      {policy && <>
        <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={attested} disabled={pending || dirty || problems.length > 0}
          onChange={(event) => setAttested(event.target.checked)} /><span>저장된 정책이 실제 물류사 원본·적용 기간·지역·요금·무료/묶음 기준과 일치함을 확인했습니다.</span></label>
        {dirty ? <p className="muted">수정한 내용을 먼저 초안으로 저장해주세요.</p> : null}
        <button type="button" className="btn" disabled={pending || dirty || problems.length > 0 || !attested} onClick={() => setStatus('active')}>저장된 정책 활성화</button>
      </>}
    </> : null}
    {canEdit && policy?.status === 'active' ? <>
      <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={attested} disabled={pending} onChange={(event) => setAttested(event.target.checked)} />
        <span>정책을 중단하면 적용할 다른 정책이 없는 출고지의 신규 주문이 차단됩니다. 기존 주문의 배송비는 그대로 보존됨을 확인했습니다.</span></label>
      <button type="button" className="btn btn-ghost" disabled={pending || !attested} onClick={() => setStatus('retired')}>정책 중단</button>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

export function ShippingRegionsScreen({ policies: initialPolicies, adoptions, origins, carriers, canEdit }: {
  policies: ShippingRegionPolicy[]; adoptions: ShippingRegionAdoption[]; origins: FulfillmentOrigin[];
  carriers: EditableCarrier[]; canEdit: boolean;
}) {
  const [policies, setPolicies] = useState(initialPolicies); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copy, setCopy] = useState<ShippingRegionPolicyInput | null>(null); const [editorKey, setEditorKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const selected = policies.find((policy) => policy.id === selectedId) ?? null;
  function saved(policy: ShippingRegionPolicy, success: string) {
    setPolicies((current) => current.some((row) => row.id === policy.id) ? current.map((row) => row.id === policy.id ? policy : row) : [...current, policy]);
    setSelectedId(policy.id); setCopy(null); setEditorKey((key) => key + 1); setMessage(success);
  }
  return <section className="wc-admin-kit">
    <AdminPageHeader title="지역 추가 배송비" description="실제 물류사 회신을 출고지·계약 택배사·적용 기간별로 관리합니다. 확정된 정책만 배송지별 견적과 주문에 적용합니다." />
    <nav className="wc-admin-kit__actions" aria-label="배송 설정"><Link href="/admin/settings/origins">출고지·배송비</Link><Link href="/admin/settings/carriers">택배사</Link></nav>
    {message ? <p role="status">{message}</p> : null}
    <AdminSectionCard title="출고지별 등록 상태">
      <ul>{origins.map((origin) => {
        const adoption = adoptions.find((row) => row.originId === origin.id);
        const newlyActive = policies.filter((policy) => policy.originId === origin.id && policy.status !== 'draft');
        return <li key={origin.id}>{origin.name} · {adoption ? `${formatOrderDateTime(adoption.managedFrom)}부터 지역 정책 필수`
          : newlyActive.length ? '지역 정책 도입 · 적용 기간을 확인해주세요' : '지역표 미등록 · 기존 배송비로 주문 확정'}</li>;
      })}</ul>
      <p className="muted">지역표 미등록은 계약 추가료가 0원이라는 뜻이 아닙니다. 현재 표시된 배송비로 주문이 확정되며, 이미 확정된 주문에 지역료를 뒤늦게 더하지 않습니다.
        지역 정책을 도입한 출고지는 정책 만료·중단·택배사 불일치 시 신규 주문을 차단합니다.</p>
    </AdminSectionCard>
    <AdminSectionCard title="정책 버전">
      {policies.length ? <div className="col" style={{ gap: 8 }}>{policies.map((policy) => <button type="button" className="btn btn-ghost" key={policy.id}
        style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'start' }}
        aria-pressed={selectedId === policy.id} onClick={() => { setSelectedId(policy.id); setCopy(null); setEditorKey((key) => key + 1); setMessage(null); }}>
        {origins.find((origin) => origin.id === policy.originId)?.name} · {policy.name || '이름 미입력'} · 버전 {policy.version} · {STATUS_LABELS[policy.status]}
      </button>)}</div> : <p>등록한 지역 정책이 없습니다. 실제 회신을 확보한 출고지부터 초안을 작성해주세요.</p>}
      {canEdit && <button type="button" className="btn btn-ghost" onClick={() => { setSelectedId(null); setCopy(null); setEditorKey((key) => key + 1); }}>새 정책 초안</button>}
    </AdminSectionCard>
    {(selected || canEdit) && <AdminSectionCard title={selected ? `${selected.name || '지역 정책'} · 버전 ${selected.version} · ${STATUS_LABELS[selected.status]}` : '새 정책 초안'}>
      {selected?.confirmedAt ? <p>원본 확인: {selected.confirmedBy} · {formatOrderDateTime(selected.confirmedAt)}</p> : null}
      {canEdit && selected && <button type="button" className="btn btn-ghost" onClick={() => {
        const source = parseShippingRegionPolicyInput(selected)!;
        setCopy({ ...source, startsAt: null, endsAt: null, openEnded: null, rules: source.rules.map((rule) => ({ ...rule, id: null })) });
        setSelectedId(null); setEditorKey((key) => key + 1); setMessage(null);
      }}>이 정책으로 새 버전 초안 만들기</button>}
      <ShippingRegionEditor key={editorKey} policy={selected} initialCopy={copy} origins={origins} carriers={carriers} canEdit={canEdit} onSaved={saved} />
      {copy ? <p>이전 정책의 원본을 기준으로 새 정책을 입력해주세요. 실제 계약과 기간을 다시 확인해야 합니다.</p> : null}
    </AdminSectionCard>}
  </section>;
}

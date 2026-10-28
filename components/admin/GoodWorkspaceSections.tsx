'use client';

import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import {
  MAX_GOODS_KC_MODELS, emptyGoodsKcModel, goodsKcReviewProblems, goodsKcSoleNotApplicable, publicGoodsKcDisclosures, type GoodsKcModelInput,
} from '@/lib/admin/goods-kc';
import { goodWorkspaceKcVariants, type GoodWorkspacePreorderDraft } from '@/lib/admin/good-workspace-sections';
import { goodsOptionRowKey } from '@/lib/admin/goods-option-editor';
import { ModelFields, ProductNotApplicable } from './GoodsKcPanel';
import { useGoodWorkspaceSections } from './GoodWorkspace';

/*
 * 등록 화면의 원자 저장 섹션(10/27 회의 R13·D6②). 입력은 GoodWorkspaceProvider(폼 키 밖)에 두고,
 * 기본 상품 폼이 저장할 때 hidden JSON 하나로 함께 보낸다. 이 카드들은 <form>을 갖지 않는다.
 * 저장 뒤에는 같은 자리(같은 id)의 독립 KC·예약판매 패널이 저장값을 읽어 이어서 관리한다.
 */

export const GOOD_WORKSPACE_KC_ATTESTATION = '원본 근거와 실제 모델·사업자·대상 옵션이 일치하고, 해당 제도의 필수 사항을 확인했습니다.';

export function GoodWorkspaceKcCard({ serverError, disabled = false }: { serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  if (!workspace) return null;
  const { sections, setSections, optionRows, sectionErrors } = workspace;
  const { models, attested } = sections.kc;
  const variants = goodWorkspaceKcVariants(optionRows);
  const problems = models.length ? goodsKcReviewProblems(models, variants) : [];
  const change = (next: GoodsKcModelInput[], nextAttested = false) => setSections((current) => ({ ...current, kc: { models: next, attested: nextAttested } }));
  const status = !models.length ? 'KC 미입력 · 저장 뒤에도 이 자리의 KC 정보에서 검토할 수 있습니다.'
    : attested ? '저장하면 KC 검토 완료로 함께 저장됩니다.' : '저장하면 KC 미검토로 함께 저장됩니다. 검토 완료는 아래 확인을 체크하세요.';
  const error = sectionErrors.workspaceKc ?? serverError;
  return <section className="card col wc-admin-kit" aria-labelledby="good-workspace-kc-title" style={{ padding: 18, gap: 16 }}>
    <div><h2 id="good-workspace-kc-title" style={{ margin: 0, fontSize: 18 }}>KC 정보</h2>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>KC 대상이 아니면 상품 전체 KC 해당 없음을 확인하고, KC 대상이면 모델·옵션별로 제도와 근거를 입력합니다.
        적용 옵션은 위 옵션목록의 현재 옵션입니다. 검토 완료는 확인 체크가 있을 때만 저장합니다.</p>
    </div>
    <p role="status">{status}</p>
    {goodsKcSoleNotApplicable(models) && attested ? null : <ProductNotApplicable variants={variants} models={models} disabled={disabled} completeLabel="해당 없음으로 검토 완료 입력"
      onNoteChange={(publicNote) => change([{ ...models[0], publicNote }], attested)} onComplete={(next) => change(next, true)} />}
    {models.map((model, index) => <ModelFields key={index} model={model} index={index} variants={variants} disabled={disabled}
      onChange={(next) => change(models.map((item, position) => position === index ? next : item))}
      onRemove={() => change(models.filter((_, position) => position !== index))} />)}
    <div><button type="button" className="btn btn-ghost" disabled={disabled || models.length >= MAX_GOODS_KC_MODELS}
      onClick={() => change([...models, emptyGoodsKcModel()])}>KC 모델 추가</button></div>
    {problems.length > 0 && <div><strong>검토 완료 전 확인</strong><ul>{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div>}
    {models.length > 0 && problems.length === 0 && <GoodsKcDisclosure title="고객 고시 미리보기" disclosures={publicGoodsKcDisclosures(models, variants)} />}
    {models.length > 0 && <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
      <input type="checkbox" checked={attested} disabled={disabled || problems.length > 0}
        onChange={(event) => setSections((current) => ({ ...current, kc: { ...current.kc, attested: event.target.checked } }))} />
      <span>{GOOD_WORKSPACE_KC_ATTESTATION}</span>
    </label>}
    {error ? <p role="alert">{error}</p> : null}
    <small className="muted">KC 내부 근거 참조는 브라우저 자동복구·임시저장에 담지 않습니다. 화면을 닫기 전에 저장해주세요.</small>
  </section>;
}

let draftSequence = 0;
function emptyPreorder(optionKey: string): GoodWorkspacePreorderDraft {
  draftSequence += 1;
  return { key: `preorder-${draftSequence}`, optionKey, state: 'draft', capacityQty: '', startsAt: '', endsAt: '', expectedShipDate: '', approvalReference: '' };
}

export function GoodWorkspacePreorderCard({ canActivate, serverError, disabled = false }: { canActivate: boolean; serverError?: string; disabled?: boolean }) {
  const workspace = useGoodWorkspaceSections();
  if (!workspace) return null;
  const { sections, setSections, optionRows, sectionErrors } = workspace;
  const entries = sections.preorders;
  const options = optionRows.map((row, index) => ({ key: goodsOptionRowKey(row), label: `${row.name.trim() || `옵션 ${index + 1}`}${row.isActive === false ? ' (사용 중지)' : ''}` }));
  const update = (key: string, changes: Partial<GoodWorkspacePreorderDraft>) =>
    setSections((current) => ({ ...current, preorders: current.preorders.map((entry) => entry.key === key ? { ...entry, ...changes } : entry) }));
  const free = options.find((option) => !entries.some((entry) => entry.optionKey === option.key));
  const error = sectionErrors.workspacePreorders ?? serverError;
  return <section className="card col wc-admin-kit" aria-labelledby="good-workspace-preorders-title" style={{ gap: 16, padding: 18 }}>
    <div><h2 id="good-workspace-preorders-title" style={{ margin: 0, fontSize: 18 }}>예약판매</h2>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>승인된 미래 공급 물량을 옵션별로 입력합니다. 초안은 판매에 반영되지 않고, 활성화한 옵션은 승인 물량으로 판매합니다.
        예약판매 옵션은 일반 판매기간과 함께 쓸 수 없습니다.</p>
    </div>
    {!entries.length && <p className="muted">입력한 예약 조건이 없습니다. 필요 없으면 비워 두세요.</p>}
    {entries.map((entry, index) => <fieldset key={entry.key} className="col" disabled={disabled} style={{ gap: 12, padding: 16, border: '1px solid var(--line)', borderRadius: 8 }}>
      <legend>예약 조건 {index + 1}</legend>
      <label>예약 대상 옵션
        <select value={entry.optionKey} onChange={(event) => update(entry.key, { optionKey: event.target.value })}>
          {options.some((option) => option.key === entry.optionKey) ? null : <option value={entry.optionKey} disabled>옵션을 다시 선택해주세요</option>}
          {options.map((option) => <option key={option.key} value={option.key} disabled={option.key !== entry.optionKey && entries.some((other) => other.optionKey === option.key)}>{option.label}</option>)}
        </select>
      </label>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        <label>승인 예약 물량<input type="number" min={1} max={2147483647} step={1} inputMode="numeric" value={entry.capacityQty} placeholder="미설정"
          onChange={(event) => update(entry.key, { capacityQty: event.target.value })} /></label>
        <label>접수 시작 (한국 시간)<input type="datetime-local" value={entry.startsAt} onChange={(event) => update(entry.key, { startsAt: event.target.value })} /></label>
        <label>접수 종료 (한국 시간)<input type="datetime-local" value={entry.endsAt} onChange={(event) => update(entry.key, { endsAt: event.target.value })} /></label>
        <label>발송 예정일<input type="date" value={entry.expectedShipDate} min={entry.endsAt.slice(0, 10) || undefined} onChange={(event) => update(entry.key, { expectedShipDate: event.target.value })} /></label>
      </div>
      <label>승인 문서·확인 근거
        <textarea value={entry.approvalReference} maxLength={2000} rows={3} placeholder="승인된 공급 물량과 일정을 확인할 수 있는 문서 번호 또는 자료 위치"
          onChange={(event) => update(entry.key, { approvalReference: event.target.value })} />
      </label>
      <label>저장 방식
        <select value={entry.state} onChange={(event) => update(entry.key, { state: event.target.value === 'active' ? 'active' : 'draft' })}>
          <option value="draft">초안 저장</option>
          {canActivate && <option value="active">승인 조건으로 예약 활성화</option>}
        </select>
      </label>
      {!canActivate && <p className="muted" style={{ fontSize: 12, margin: 0 }}>예약 활성화는 관리자가 저장된 초안과 승인 근거를 확인한 뒤 진행합니다.</p>}
      <div><button type="button" className="btn btn-ghost" onClick={() => setSections((current) => ({ ...current, preorders: current.preorders.filter((item) => item.key !== entry.key) }))}>이 예약 조건 빼기</button></div>
    </fieldset>)}
    <div><button type="button" className="btn btn-ghost" disabled={disabled || !free}
      onClick={() => free && setSections((current) => ({ ...current, preorders: [...current.preorders, emptyPreorder(free.key)] }))}>예약 조건 추가</button></div>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}

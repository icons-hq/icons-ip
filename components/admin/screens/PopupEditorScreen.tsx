'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { SeededForm } from '@/components/admin/form-seed';
import {
  linkPopupTargetAction,
  savePopupPhasesAction,
  savePopupZonesAction,
  setPopupLinkRuleAction,
  upsertPopupAction,
  type AdminPopupActionState,
} from '@/app/admin/popup-actions';
import { Field, SelectField } from '@/components/admin/fields';
import type { AdminPopupDetail } from '@/lib/admin/popups.server';
import {
  formatPopupPeriod,
  POPUP_DISPLAY_STATE_LABELS,
  POPUP_SALE_MODE_LABELS,
  POPUP_SALE_MODES,
  POPUP_STATUSES,
  POPUP_TARGET_TYPES,
  POPUP_TARGET_TYPE_LABELS,
  POPUP_ZONE_KINDS,
  type PopupSnapshot,
} from '@/lib/popups';

/*
 * 팝업 편성 (설계서 v2 §1-8).
 *
 * 세 칸이다 — 언제(페이즈) · 어디에(존) · 무엇을(연결). 그리고 오른쪽이 미리보기다.
 * 미리보기는 **소비자 화면과 같은 함수**를 부르고 시각만 바꾼다.
 */

const EMPTY: AdminPopupActionState = {};

/** UTC instant 를 폼이 쓰는 KST `datetime-local` 값으로. 저장은 다시 +09:00 을 붙여 보낸다. */
function toKstInput(value: string | null | undefined): string {
  if (!value) return '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(time));
  return parts.replace(' ', 'T');
}

function Message({ state }: { state: AdminPopupActionState }) {
  if (state.error) return <p className="admin-form-error" role="alert">{state.error}</p>;
  if (state.message) return <p className="muted" style={{ fontSize: 12, margin: 0 }}>{state.message}</p>;
  return null;
}

function PopupForm({ detail, ipOptions }: {
  detail: AdminPopupDetail;
  ipOptions: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState(upsertPopupAction, EMPTY);
  const popup = detail.popup as Record<string, string>;
  return (
    <SeededForm values={state.values} action={action} className="col" style={{ gap: 10 }}>
      <input name="id" type="hidden" value={popup.id} />
      <input name="previousId" type="hidden" value={popup.id} />
      <div className="admin-form-grid">
        <Field defaultValue={popup.title} label="이름" name="title" required />
        <Field defaultValue={popup.subtitle ?? ''} label="한 줄 설명" name="subtitle" />
        <SelectField defaultValue={popup.ip_id} label="IP" name="ipId">
          {ipOptions.map((ip) => <option key={ip.id} value={ip.id}>{ip.title}</option>)}
        </SelectField>
        <SelectField defaultValue={popup.status} label="상태" name="status">
          {POPUP_STATUSES.map((status) => (
            <option key={status.value} value={status.value}>{status.label}</option>
          ))}
        </SelectField>
        <Field defaultValue={toKstInput(popup.starts_at)} label="시작 (KST)" name="startsAt" required type="datetime-local" />
        <Field defaultValue={toKstInput(popup.ends_at)} label="종료 (KST)" name="endsAt" required type="datetime-local" />
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm btn-holo" disabled={pending} type="submit">팝업 저장</button>
        <Message state={state} />
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
        게시하려면 페이즈가 하나 이상 있어야 합니다. 주소(<span className="mono">{popup.id}</span>)는 바꿀 수 없습니다.
      </p>
    </SeededForm>
  );
}

function PhasesForm({ detail }: { detail: AdminPopupDetail }) {
  const [state, action, pending] = useActionState(savePopupPhasesAction, EMPTY);
  /* 빈 줄 하나를 늘 남겨 둔다 — 「추가」 버튼 없이 바로 적을 수 있게. */
  const rows = [...detail.phases, null];
  return (
    <SeededForm values={state.values} action={action} className="col" style={{ gap: 8 }}>
      <input name="popupId" type="hidden" value={(detail.popup as Record<string, string>).id} />
      <input name="expectedUpdatedAt" type="hidden" value={detail.updatedAt} />
      <table className="admin-stats-table">
        <thead>
          <tr><th>키</th><th>이름</th><th>시작 (KST)</th><th>종료 (KST)</th><th>기본 판매</th></tr>
        </thead>
        <tbody>
          {rows.map((phase, index) => (
            <tr key={phase?.id ?? 'new'}>
              <td><input defaultValue={phase?.key ?? ''} name={`phase:${index}:key`} placeholder="live_1" style={{ width: 90 }} /></td>
              <td><input defaultValue={phase?.label ?? ''} name={`phase:${index}:label`} placeholder="1부" style={{ width: 110 }} /></td>
              <td><input defaultValue={toKstInput(phase?.startsAt)} name={`phase:${index}:startsAt`} type="datetime-local" /></td>
              <td><input defaultValue={toKstInput(phase?.endsAt)} name={`phase:${index}:endsAt`} type="datetime-local" /></td>
              <td>
                <select defaultValue={phase?.defaultSaleMode ?? 'on_sale'} name={`phase:${index}:defaultSaleMode`}>
                  {POPUP_SALE_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>{mode.label}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm btn-holo" disabled={pending} type="submit">페이즈 저장</button>
        <Message state={state} />
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
        시간은 <strong>시작 포함·종료 제외</strong>입니다. 「23:59까지」는 다음 날 00:00으로 적습니다.
        같은 시각에 두 페이즈를 둘 수 없고, 키를 지우면 그 페이즈가 삭제됩니다.
      </p>
    </SeededForm>
  );
}

function LinkForm({ detail }: { detail: AdminPopupDetail }) {
  const [state, action, pending] = useActionState(linkPopupTargetAction, EMPTY);
  return (
    <SeededForm values={state.values} action={action} className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
      <input name="popupId" type="hidden" value={(detail.popup as Record<string, string>).id} />
      <SelectField label="종류" name="targetType">
        {POPUP_TARGET_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
      </SelectField>
      <Field label="대상 id" name="targetId" placeholder="굿즈코드·슬러그" required />
      <SelectField label="존" name="zoneCode">
        <option value="">없음</option>
        {detail.zones.map((zone) => (
          <option key={zone.code} value={zone.code}>{zone.code} · {zone.name}</option>
        ))}
      </SelectField>
      <SelectField label="기본 판매" name="defaultSaleMode">
        <option value="">페이즈 기본 따름</option>
        {POPUP_SALE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
      </SelectField>
      <button className="btn btn-sm btn-ghost" disabled={pending} type="submit">연결</button>
      <Message state={state} />
    </SeededForm>
  );
}

function LinkRuleRow({ detail, link }: { detail: AdminPopupDetail; link: AdminPopupDetail['links'][number] }) {
  const [state, action, pending] = useActionState(setPopupLinkRuleAction, EMPTY);
  const ruleFor = (phaseKey: string) =>
    link.phaseRules.find((rule) => rule.phaseKey === phaseKey)?.saleMode ?? '';
  return (
    <SeededForm values={state.values} action={action} className="col" style={{ gap: 6 }}>
      <input name="popupId" type="hidden" value={(detail.popup as Record<string, string>).id} />
      <input name="targetType" type="hidden" value={link.targetType} />
      <input name="targetId" type="hidden" value={link.targetId} />
      <input name="zoneCode" type="hidden" value={link.zoneCode ?? ''} />
      <input name="defaultSaleMode" type="hidden" value={link.defaultSaleMode ?? ''} />
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="tag">{POPUP_TARGET_TYPE_LABELS[link.targetType] ?? link.targetType}</span>
        <strong className="mono" style={{ fontSize: 12 }}>{link.targetId}</strong>
        {link.zoneCode ? <span className="faint" style={{ fontSize: 11 }}>{link.zoneCode}</span> : null}
        <span className="faint" style={{ fontSize: 11 }}>
          지금 {POPUP_SALE_MODE_LABELS[link.currentMode] ?? link.currentMode}
        </span>
      </div>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {detail.phases.map((phase) => (
          <label className="row" key={phase.key} style={{ alignItems: 'center', fontSize: 11, gap: 4 }}>
            <span className="faint">{phase.label}</span>
            <select defaultValue={ruleFor(phase.key)} name={`rule:${phase.key}`}>
              <option value="">기본</option>
              {POPUP_SALE_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </label>
        ))}
        <button className="btn btn-xs btn-ghost" disabled={pending} type="submit">규칙 저장</button>
        <Message state={state} />
      </div>
    </SeededForm>
  );
}


function ZonesForm({ detail }: { detail: AdminPopupDetail }) {
  const [state, action, pending] = useActionState(savePopupZonesAction, EMPTY);
  /* 빈 줄 하나를 늘 남겨 둔다 — 「추가」 버튼 없이 바로 적을 수 있게. */
  const rows = [...detail.zones, null];
  return (
    <SeededForm values={state.values} action={action} className="col" style={{ gap: 8 }}>
      <input name="popupId" type="hidden" value={(detail.popup as Record<string, string>).id} />
      <input name="expectedUpdatedAt" type="hidden" value={detail.updatedAt} />
      <table className="admin-stats-table">
        <thead>
          <tr><th>코드</th><th>이름</th><th>유형</th><th>문</th></tr>
        </thead>
        <tbody>
          {rows.map((zone, index) => (
            <tr key={zone?.id ?? 'new'}>
              <td><input defaultValue={zone?.code ?? ''} name={`zone:${index}:code`} placeholder="Z1" style={{ width: 70 }} /></td>
              <td><input defaultValue={zone?.name ?? ''} name={`zone:${index}:name`} placeholder="상점" style={{ width: 130 }} /></td>
              <td>
                <select defaultValue={zone?.kind ?? 'info'} name={`zone:${index}:kind`}>
                  {POPUP_ZONE_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>{kind.label}</option>
                  ))}
                </select>
              </td>
              <td><input defaultValue={zone?.door ?? ''} name={`zone:${index}:door`} placeholder="합류" style={{ width: 90 }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <button className="btn btn-sm btn-holo" disabled={pending} type="submit">존 저장</button>
        <Message state={state} />
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
        한 존은 <strong>한 유형만</strong> 갖습니다. 코드를 지우면 그 존이 삭제되지만,
        거기 걸려 있던 연결은 남고 존만 떨어집니다 — 존을 정리하다 편성이 사라지지 않게.
      </p>
    </SeededForm>
  );
}

export function PopupEditorScreen({
  detail,
  ipOptions,
  preview,
  previewAsOf,
}: {
  detail: AdminPopupDetail;
  ipOptions: { id: string; title: string }[];
  preview: PopupSnapshot | null;
  previewAsOf: string;
}) {
  const popup = detail.popup as Record<string, string>;
  return (
    <section className="col" style={{ gap: 16, minWidth: 0 }}>
      <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <Link className="btn btn-sm btn-ghost" href="/admin/popups">← 목록으로</Link>
          <h1 style={{ fontSize: 22, margin: '8px 0 0' }}>{popup.title}</h1>
          <p className="faint mono" style={{ fontSize: 11, margin: '4px 0 0' }}>
            {popup.id} · {formatPopupPeriod(popup.starts_at, popup.ends_at)}
          </p>
        </div>
        <span className="tag">{POPUP_DISPLAY_STATE_LABELS[detail.displayState] ?? detail.displayState}</span>
      </div>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>팝업</h2>
        <PopupForm detail={detail} ipOptions={ipOptions} />
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>언제 — 페이즈</h2>
        <PhasesForm detail={detail} />
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>어디에 — 존</h2>
        {detail.zones.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            존 없이도 연결은 되지만, 허브 화면이 무엇을 어느 자리에 그릴지 알 수 없습니다.
          </p>
        ) : null}
        <ZonesForm detail={detail} />
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>무엇을 — 연결</h2>
        <LinkForm detail={detail} />
        <div className="col" style={{ gap: 12 }}>
          {detail.links.map((link) => <LinkRuleRow detail={detail} key={link.id} link={link} />)}
          {detail.links.length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>아직 연결한 것이 없습니다.</p>
          ) : null}
        </div>
        <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
          판매 모드는 <strong>규칙 › 연결 기본 › 페이즈 기본</strong> 순으로 좁은 것이 이깁니다.
          팝업은 원본 조건을 넘어 열 수 없습니다 — 원본이 닫혀 있으면 여기서 열어도 닫힌 채입니다.
        </p>
      </section>

      <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>미리보기</h2>
        <form className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
          <Field defaultValue={toKstInput(previewAsOf)} label="이 시각으로 보기 (KST)" name="asOf" type="datetime-local" />
          <button className="btn btn-sm btn-ghost" type="submit">보기</button>
          <Link className="btn btn-sm btn-ghost" href={`/admin/popups/${popup.id}`}>지금으로</Link>
        </form>
        {preview ? (
          <div className="col" style={{ gap: 8 }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {POPUP_DISPLAY_STATE_LABELS[preview.displayState] ?? preview.displayState}
              {preview.currentPhase ? ` · ${preview.currentPhase}` : ' · 페이즈 없음'}
              {' · 소비자에게 보이는 연결 '}{preview.links.length}개
            </p>
            <ul className="admin-order-refs">
              {preview.links.map((link) => (
                <li key={`${link.targetType}:${link.targetId}`} style={{ fontSize: 12 }}>
                  <span className="tag">{POPUP_TARGET_TYPE_LABELS[link.targetType] ?? link.targetType}</span>{' '}
                  <span className="mono">{link.targetId}</span>
                  <span className="faint"> · {POPUP_SALE_MODE_LABELS[link.mode] ?? link.mode}</span>
                </li>
              ))}
              {preview.links.length === 0 ? <li className="muted">이 시각에는 보이는 것이 없습니다.</li> : null}
            </ul>
            <p className="faint" style={{ fontSize: 11, margin: 0 }}>
              이 화면은 소비자 화면과 <strong>같은 함수</strong>를 부릅니다. 다른 것은 시계뿐입니다.
            </p>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>미리볼 수 없습니다.</p>
        )}
      </section>
    </section>
  );
}

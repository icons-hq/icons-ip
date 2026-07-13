'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  hideCommunityPostAction,
  setAdminUserRoleAction,
  updateCommunityReportStatusAction,
  upsertAdminCardAction,
  upsertAdminEventAction,
  upsertAdminGoodAction,
  upsertAdminIpAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type {
  AdminCardRecord,
  AdminCatalogRecords,
  AdminEventRecord,
  AdminGoodRecord,
  AdminIpRecord,
} from '@/lib/admin/catalog.server';
import type { AdminModerationRecords, AdminReportRecord } from '@/lib/admin/moderation.server';
import { ADMIN_ASSIGNABLE_ROLES } from '@/lib/admin/roles';
import type { AdminProfileRecord } from '@/lib/admin/roles.server';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { CommunityReportStatus } from '@/lib/community';
import { RARITY_META } from '@/lib/rarity';
import { Icon } from '@/components/ui/Icon';

type AdminTab = 'ip' | 'good' | 'card' | 'event' | 'moderation' | 'roles';

interface AdminProps {
  admin: {
    id: string;
    email: string | null;
    role: string;
  };
  catalog: Pick<CatalogSnapshot, 'verticals' | 'ips'>;
  moderation: AdminModerationRecords;
  profiles: AdminProfileRecord[];
  records: AdminCatalogRecords;
}

const emptyState: AdminCatalogActionState = {};
const tabs: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'ip', label: 'IP', icon: 'ip' },
  { id: 'good', label: '굿즈', icon: 'shop' },
  { id: 'card', label: '카드', icon: 'card' },
  { id: 'event', label: '이벤트', icon: 'event' },
  { id: 'moderation', label: '모더레이션', icon: 'shield' },
  { id: 'roles', label: '역할', icon: 'user' },
];
const reportStatuses: CommunityReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];
const reportTargetLabels = {
  post: '포스트',
  comment: '댓글',
  user: '사용자',
} as const;

function optional(value: string | null | undefined) {
  return value ?? '';
}

function dateTimeInput(value: string | null | undefined) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return <span style={{ color: 'var(--pink)', fontSize: 12, fontWeight: 700 }}>{children}</span>;
}

function Field({
  defaultValue,
  error,
  label,
  name,
  placeholder,
  type = 'text',
}: {
  defaultValue?: string | number | null;
  error?: string;
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="col" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
        {label}
      </span>
      <input
        aria-invalid={Boolean(error)}
        defaultValue={defaultValue ?? ''}
        name={name}
        placeholder={placeholder}
        type={type}
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 14,
          minHeight: 42,
          outline: 'none',
          padding: '0 12px',
          width: '100%',
        }}
      />
      <ErrorText>{error}</ErrorText>
    </label>
  );
}

function TextArea({
  defaultValue,
  error,
  label,
  name,
  placeholder,
}: {
  defaultValue?: string | null;
  error?: string;
  label: string;
  name: string;
  placeholder?: string;
}) {
  return (
    <label className="col" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
        {label}
      </span>
      <textarea
        aria-invalid={Boolean(error)}
        defaultValue={defaultValue ?? ''}
        name={name}
        placeholder={placeholder}
        rows={3}
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 14,
          minHeight: 88,
          outline: 'none',
          padding: '12px',
          resize: 'vertical',
          width: '100%',
        }}
      />
      <ErrorText>{error}</ErrorText>
    </label>
  );
}

function SelectField({
  children,
  defaultValue,
  error,
  label,
  name,
}: {
  children: React.ReactNode;
  defaultValue?: string | null;
  error?: string;
  label: string;
  name: string;
}) {
  return (
    <label className="col" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
        {label}
      </span>
      <select
        aria-invalid={Boolean(error)}
        defaultValue={defaultValue ?? ''}
        name={name}
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 14,
          minHeight: 42,
          outline: 'none',
          padding: '0 12px',
          width: '100%',
        }}
      >
        {children}
      </select>
      <ErrorText>{error}</ErrorText>
    </label>
  );
}

function ActionNotice({ state }: { state: AdminCatalogActionState }) {
  if (state.errors?.form) {
    return (
      <div className="card" role="alert" style={{ color: 'var(--pink)', padding: 12, borderRadius: 10, fontWeight: 700 }}>
        {state.errors.form}
      </div>
    );
  }
  if (state.message) {
    return (
      <div className="card" role="status" style={{ color: 'var(--mint)', padding: 12, borderRadius: 10, fontWeight: 700 }}>
        {state.message}
      </div>
    );
  }
  return null;
}

function RecordList<T extends { id: string }>({
  activeId,
  items,
  labelFor,
  onNew,
  onSelect,
}: {
  activeId: string | null;
  items: T[];
  labelFor: (item: T) => string;
  onNew: () => void;
  onSelect: (item: T) => void;
}) {
  return (
    <aside className="card" style={{ alignSelf: 'start', borderRadius: 10, padding: 14 }}>
      <button className="btn btn-holo" onClick={onNew} style={{ width: '100%' }} type="button">
        <Icon name="plus" size={15} /> 새로 등록
      </button>
      <div className="col" style={{ gap: 8, marginTop: 14, maxHeight: 520, overflow: 'auto' }}>
        {items.map((item) => (
          <button
            key={item.id}
            className={activeId === item.id ? 'chip on' : 'chip'}
            onClick={() => onSelect(item)}
            style={{ justifyContent: 'flex-start', minHeight: 38, overflow: 'hidden', textAlign: 'left' }}
            type="button"
          >
            {labelFor(item)}
          </button>
        ))}
      </div>
    </aside>
  );
}

function FormShell({
  pending,
  state,
}: {
  pending: boolean;
  state: AdminCatalogActionState;
}) {
  return (
    <>
      <ActionNotice state={state} />
      <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 150 }}>
        <Icon name="check" size={15} /> {pending ? '저장 중' : '저장'}
      </button>
    </>
  );
}

function InlineNotice({ state }: { state: AdminCatalogActionState }) {
  if (state.errors?.form) {
    return <span role="alert" style={{ color: 'var(--pink)', fontSize: 12, fontWeight: 700 }}>{state.errors.form}</span>;
  }
  if (state.message) {
    return <span role="status" style={{ color: 'var(--mint)', fontSize: 12, fontWeight: 700 }}>{state.message}</span>;
  }
  return null;
}

function ReportStatusForm({ report }: { report: AdminReportRecord }) {
  const [state, action, pending] = useActionState(updateCommunityReportStatusAction, emptyState);

  return (
    <form action={action} className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      <input name="reportId" type="hidden" value={report.id} />
      <select
        defaultValue={report.status}
        name="status"
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 13,
          minHeight: 36,
          outline: 'none',
          padding: '0 10px',
        }}
      >
        {reportStatuses.map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select>
      <button className="btn btn-sm" disabled={pending} style={{ height: 36 }}>
        <Icon name="check" size={14} /> {pending ? '저장 중' : '상태 저장'}
      </button>
      <InlineNotice state={state} />
    </form>
  );
}

function HidePostForm({ report }: { report: AdminReportRecord }) {
  const [state, action, pending] = useActionState(hideCommunityPostAction, emptyState);
  if (!report.targetPostId) return null;

  return (
    <form action={action} className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      <input name="reportId" type="hidden" value={report.id} />
      <input name="postId" type="hidden" value={report.targetPostId} />
      <button className="btn btn-sm" disabled={pending} style={{ height: 36 }}>
        <Icon name="shield" size={14} /> {pending ? '처리 중' : '포스트 숨김'}
      </button>
      <InlineNotice state={state} />
    </form>
  );
}

function UserRoleForm({ profile, isSelf }: { profile: AdminProfileRecord; isSelf: boolean }) {
  const [state, action, pending] = useActionState(setAdminUserRoleAction, emptyState);

  if (isSelf) {
    return <span className="faint mono" style={{ fontSize: 11 }}>본인 계정 — 변경 불가</span>;
  }

  return (
    <form action={action} className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
      <input name="profileId" type="hidden" value={profile.id} />
      <select
        defaultValue={profile.role}
        name="role"
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 13,
          minHeight: 36,
          outline: 'none',
          padding: '0 10px',
        }}
      >
        {ADMIN_ASSIGNABLE_ROLES.map((role) => (
          <option key={role} value={role}>{role}</option>
        ))}
      </select>
      <button className="btn btn-sm" disabled={pending} style={{ height: 36 }}>
        <Icon name="check" size={14} /> {pending ? '저장 중' : '역할 저장'}
      </button>
      <InlineNotice state={state} />
    </form>
  );
}

function RolesPanel({ profiles, adminId }: { profiles: AdminProfileRecord[]; adminId: string }) {
  return (
    <section className="col" style={{ gap: 12 }}>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        staff는 카탈로그·모더레이션을 처리하고, admin은 역할까지 관리합니다. 변경은 감사 로그에 남습니다.
      </p>
      {profiles.map((profile) => (
        <article key={profile.id} className="card between" style={{ borderRadius: 10, gap: 12, padding: 16, flexWrap: 'wrap' }}>
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
              <strong style={{ fontSize: 15 }}>@{profile.nickname}</strong>
              <span className="tag" style={{ color: profile.role === 'user' ? 'var(--dim)' : 'var(--violet-2)' }}>{profile.role}</span>
            </div>
            <span className="faint mono" style={{ fontSize: 11 }}>
              {profile.id.slice(0, 8)} · 가입 {new Date(profile.createdAt).toLocaleDateString('ko-KR')}
            </span>
          </div>
          <UserRoleForm isSelf={profile.id === adminId} profile={profile} />
        </article>
      ))}
      {!profiles.length && (
        <div className="card" style={{ borderRadius: 10, padding: 18 }}>
          <div style={{ fontWeight: 700 }}>표시할 사용자가 없습니다.</div>
          <p className="muted" style={{ marginTop: 6 }}>가입한 사용자가 생기면 이곳에 표시됩니다.</p>
        </div>
      )}
    </section>
  );
}

function ModerationPanel({ reports }: { reports: AdminReportRecord[] }) {
  return (
    <section className="col" style={{ gap: 12 }}>
      {reports.map((report) => (
        <article key={report.id} className="card col" style={{ borderRadius: 10, gap: 12, padding: 16 }}>
          <div className="between" style={{ gap: 12, alignItems: 'start' }}>
            <div className="col" style={{ gap: 6, minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                <span className="tag">{reportTargetLabels[report.targetType]}</span>
                <span className="tag" style={{ color: 'var(--violet-2)' }}>{report.status}</span>
                <span className="faint mono" style={{ fontSize: 11 }}>{new Date(report.createdAt).toLocaleString('ko-KR')}</span>
              </div>
              <strong style={{ fontSize: 15, lineHeight: 1.4 }}>{report.targetLabel}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                신고자 @{report.reporterName} · 대상 @{report.targetAuthorName}
              </div>
              {report.reason && <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: 0 }}>{report.reason}</p>}
            </div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <ReportStatusForm report={report} />
            <HidePostForm report={report} />
          </div>
        </article>
      ))}
      {!reports.length && (
        <div className="card" style={{ borderRadius: 10, padding: 18 }}>
          <div style={{ fontWeight: 700 }}>처리할 신고가 없습니다.</div>
          <p className="muted" style={{ marginTop: 6 }}>커뮤니티 신고가 접수되면 이곳에 표시됩니다.</p>
        </div>
      )}
    </section>
  );
}

export function Admin({ admin, catalog, moderation, profiles, records }: AdminProps) {
  const [active, setActive] = useState<AdminTab>('ip');
  const [selectedIp, setSelectedIp] = useState<AdminIpRecord | null>(null);
  const [selectedGood, setSelectedGood] = useState<AdminGoodRecord | null>(null);
  const [selectedCard, setSelectedCard] = useState<AdminCardRecord | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AdminEventRecord | null>(null);
  const [ipState, ipAction, ipPending] = useActionState(upsertAdminIpAction, emptyState);
  const [goodState, goodAction, goodPending] = useActionState(upsertAdminGoodAction, emptyState);
  const [cardState, cardAction, cardPending] = useActionState(upsertAdminCardAction, emptyState);
  const [eventState, eventAction, eventPending] = useActionState(upsertAdminEventAction, emptyState);
  const ipOptions = useMemo(() => records.ips.map((ip) => ({ id: ip.id, title: ip.title })), [records.ips]);
  const summary = [
    [records.ips.length, 'IP'],
    [records.goods.length, '굿즈'],
    [records.cards.length, '카드'],
    [records.events.length, '이벤트'],
    [moderation.reports.length, '신고'],
  ] as const;

  return (
    <div className="screen">
      <div className="wrap" style={{ paddingBottom: 90, paddingTop: 48 }}>
        <div className="between" style={{ alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Admin Ops</div>
            <h1 className="h-lg">카탈로그 관리</h1>
            <p className="muted" style={{ marginTop: 8 }}>
              IP, 굿즈, 카드, 이벤트를 등록하고 공개 화면에 반영합니다.
            </p>
          </div>
          <div className="card" style={{ borderRadius: 10, padding: '12px 14px', textAlign: 'right' }}>
            <div className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>{admin.role}</div>
            <div style={{ fontWeight: 700, marginTop: 3 }}>{admin.email ?? 'staff'}</div>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', marginTop: 24 }}>
          {summary.map(([value, label]) => (
            <div key={label} className="card" style={{ borderRadius: 10, padding: 16 }}>
              <div className="h-lg holo-text" style={{ fontFamily: 'var(--ff-display)' }}>{value}</div>
              <div className="faint mono" style={{ fontSize: 11, marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>

        <div className="wrapgap" style={{ marginTop: 28 }}>
          {tabs
            .filter((tab) => tab.id !== 'roles' || admin.role === 'admin')
            .map((tab) => (
              <button
                key={tab.id}
                className={active === tab.id ? 'chip on' : 'chip'}
                onClick={() => setActive(tab.id)}
                type="button"
              >
                <Icon name={tab.icon} size={15} /> {tab.label}
              </button>
            ))}
        </div>

        <div className="grid" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(220px, .35fr) minmax(0, 1fr)', marginTop: 18 }}>
          {active === 'ip' && (
            <>
              <RecordList
                activeId={selectedIp?.id ?? null}
                items={records.ips}
                labelFor={(ip) => `${ip.id} · ${ip.title}`}
                onNew={() => setSelectedIp(null)}
                onSelect={setSelectedIp}
              />
              <form action={ipAction} className="card col" key={selectedIp?.id ?? 'new-ip'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <Field defaultValue={selectedIp?.id} error={ipState.errors?.id} label="ID" name="id" placeholder="rilakkuma" />
                  <Field defaultValue={selectedIp?.title} error={ipState.errors?.title} label="IP 이름" name="title" placeholder="리락쿠마" />
                  <Field defaultValue={selectedIp?.sub} label="보조 설명" name="sub" placeholder="San-X · 캐릭터 IP" />
                  <SelectField defaultValue={selectedIp?.verticalKey} error={ipState.errors?.verticalKey} label="버티컬" name="verticalKey">
                    <option value="">선택</option>
                    {catalog.verticals.map((vertical) => (
                      <option key={vertical.key} value={vertical.key}>{vertical.label}</option>
                    ))}
                  </SelectField>
                  <Field defaultValue={selectedIp?.tagline} label="태그라인" name="tagline" />
                  <Field defaultValue={selectedIp?.glyph} label="글리프" name="glyph" />
                  <label className="row" style={{ alignItems: 'center', gap: 10, justifyContent: 'flex-start', paddingTop: 22 }}>
                    <input defaultChecked={selectedIp?.featured ?? false} name="featured" type="checkbox" />
                    featured
                  </label>
                </div>
                <TextArea defaultValue={selectedIp?.synopsis} label="시놉시스" name="synopsis" />
                <Field defaultValue={selectedIp?.bg} label="배경 CSS" name="bg" />
                <Field defaultValue={selectedIp?.imagePath} label="이미지 경로" name="imagePath" />
                <FormShell pending={ipPending} state={ipState} />
              </form>
            </>
          )}

          {active === 'good' && (
            <>
              <RecordList
                activeId={selectedGood?.id ?? null}
                items={records.goods}
                labelFor={(good) => `${good.id} · ${good.name}`}
                onNew={() => setSelectedGood(null)}
                onSelect={setSelectedGood}
              />
              <form action={goodAction} className="card col" key={selectedGood?.id ?? 'new-good'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
                <input name="previousIpId" type="hidden" value={selectedGood?.ipId ?? ''} />
                <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <Field defaultValue={selectedGood?.id} error={goodState.errors?.id} label="ID" name="id" placeholder="g100" />
                  <SelectField defaultValue={selectedGood?.ipId} error={goodState.errors?.ipId} label="연결 IP" name="ipId">
                    <option value="">선택</option>
                    {ipOptions.map((ip) => (
                      <option key={ip.id} value={ip.id}>{ip.title}</option>
                    ))}
                  </SelectField>
                  <Field defaultValue={selectedGood?.name} error={goodState.errors?.name} label="굿즈 이름" name="name" />
                  <Field defaultValue={selectedGood?.type} error={goodState.errors?.type} label="유형" name="type" />
                  <Field defaultValue={selectedGood?.price ?? 0} error={goodState.errors?.price} label="가격" name="price" type="number" />
                  <Field defaultValue={selectedGood?.badge} label="배지" name="badge" />
                  <SelectField defaultValue={selectedGood?.stock ?? 'ok'} error={goodState.errors?.stock} label="재고 상태" name="stock">
                    <option value="ok">ok</option>
                    <option value="low">low</option>
                    <option value="soldout">soldout</option>
                  </SelectField>
                </div>
                <Field defaultValue={selectedGood?.bg} label="배경 CSS" name="bg" />
                <Field defaultValue={selectedGood?.imagePath} label="이미지 경로" name="imagePath" />
                <FormShell pending={goodPending} state={goodState} />
              </form>
            </>
          )}

          {active === 'card' && (
            <>
              <RecordList
                activeId={selectedCard?.id ?? null}
                items={records.cards}
                labelFor={(card) => `${card.id} · ${card.name}`}
                onNew={() => setSelectedCard(null)}
                onSelect={setSelectedCard}
              />
              <form action={cardAction} className="card col" key={selectedCard?.id ?? 'new-card'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
                <input name="previousIpId" type="hidden" value={selectedCard?.ipId ?? ''} />
                <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <Field defaultValue={selectedCard?.id} error={cardState.errors?.id} label="ID" name="id" placeholder="c100" />
                  <SelectField defaultValue={selectedCard?.ipId} error={cardState.errors?.ipId} label="연결 IP" name="ipId">
                    <option value="">선택</option>
                    {ipOptions.map((ip) => (
                      <option key={ip.id} value={ip.id}>{ip.title}</option>
                    ))}
                  </SelectField>
                  <Field defaultValue={selectedCard?.name} error={cardState.errors?.name} label="카드 이름" name="name" />
                  <Field defaultValue={selectedCard?.no} label="번호" name="no" placeholder="001/120" />
                  <SelectField defaultValue={selectedCard?.rarity ?? 'N'} error={cardState.errors?.rarity} label="등급" name="rarity">
                    {Object.keys(RARITY_META).map((rarity) => (
                      <option key={rarity} value={rarity}>{rarity}</option>
                    ))}
                  </SelectField>
                </div>
                <Field defaultValue={selectedCard?.bg} label="배경 CSS" name="bg" />
                <Field defaultValue={selectedCard?.imagePath} label="이미지 경로" name="imagePath" />
                <FormShell pending={cardPending} state={cardState} />
              </form>
            </>
          )}

          {active === 'event' && (
            <>
              <RecordList
                activeId={selectedEvent?.id ?? null}
                items={records.events}
                labelFor={(event) => `${event.id} · ${event.title}`}
                onNew={() => setSelectedEvent(null)}
                onSelect={setSelectedEvent}
              />
              <form action={eventAction} className="card col" key={selectedEvent?.id ?? 'new-event'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
                <input name="previousIpId" type="hidden" value={selectedEvent?.ipId ?? ''} />
                <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <Field defaultValue={selectedEvent?.id} error={eventState.errors?.id} label="ID" name="id" placeholder="e100" />
                  <SelectField defaultValue={optional(selectedEvent?.ipId)} error={eventState.errors?.ipId} label="연결 IP" name="ipId">
                    <option value="">플랫폼/합동 이벤트</option>
                    {ipOptions.map((ip) => (
                      <option key={ip.id} value={ip.id}>{ip.title}</option>
                    ))}
                  </SelectField>
                  <Field defaultValue={selectedEvent?.title} error={eventState.errors?.title} label="이벤트 이름" name="title" />
                  <SelectField defaultValue={selectedEvent?.mode ?? '오프라인'} error={eventState.errors?.mode} label="모드" name="mode">
                    <option value="오프라인">오프라인</option>
                    <option value="온라인">온라인</option>
                  </SelectField>
                  <SelectField defaultValue={selectedEvent?.status ?? '예정'} error={eventState.errors?.status} label="상태" name="status">
                    <option value="예정">예정</option>
                    <option value="예매중">예매중</option>
                    <option value="진행중">진행중</option>
                    <option value="종료">종료</option>
                  </SelectField>
                  <Field defaultValue={dateTimeInput(selectedEvent?.startsAt)} label="시작" name="startsAt" type="datetime-local" />
                  <Field defaultValue={dateTimeInput(selectedEvent?.endsAt)} label="종료" name="endsAt" type="datetime-local" />
                  <Field defaultValue={selectedEvent?.location} label="장소" name="location" />
                  <Field defaultValue={selectedEvent?.accent} label="액센트" name="accent" placeholder="#8B5CFF" />
                </div>
                <Field defaultValue={selectedEvent?.bg} label="배경 CSS" name="bg" />
                <Field defaultValue={selectedEvent?.imagePath} label="이미지 경로" name="imagePath" />
                <FormShell pending={eventPending} state={eventState} />
              </form>
            </>
          )}

          {active === 'moderation' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <ModerationPanel reports={moderation.reports} />
            </div>
          )}

          {active === 'roles' && admin.role === 'admin' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <RolesPanel adminId={admin.id} profiles={profiles} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

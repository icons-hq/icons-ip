'use client';

import { useActionState, useMemo, useState } from 'react';
import { upsertAdminCurationAction } from '@/app/admin/curation-actions';
import type { AdminCurationActionState, AdminCurationKind } from '@/lib/admin/curations';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { ErrorText, Field, FormShell, RecordList, SelectField } from '../fields';

const emptyState: AdminCurationActionState = {};

const KIND_LABELS: Record<AdminCurationKind, string> = {
  hero: '홈 히어로',
  featured_ip: '특집 IP',
  announcement: '공지 배너',
};

const STATUS_LABELS: Record<AdminCurationRecord['status'], string> = {
  active: '노출 중',
  scheduled: '노출 예정',
  ended: '종료',
  inactive: '비활성',
};

const ARTWORK_GUIDANCE: Record<AdminCurationKind, string> = {
  hero: '히어로 이미지는 필수입니다.',
  featured_ip: '특집 IP 이미지는 선택입니다. 비우면 IP 키아트를 사용합니다.',
  announcement: '공지 배너 이미지는 선택입니다.',
};

function toKstDateTimeInput(value: string | null) {
  if (!value) return '';
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return '';
  return new Date(instant + 9 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function formatKstDateTime(value: string | null) {
  if (!value) return '종료 없음';
  return `${toKstDateTimeInput(value).replace('T', ' ')} KST`;
}

function formatCurationLabel(record: AdminCurationRecord) {
  return `${KIND_LABELS[record.kind]} · ${record.title} · ${STATUS_LABELS[record.status]} · 순서 ${record.displayOrder} · ${formatKstDateTime(record.activeFrom)} → ${formatKstDateTime(record.activeTo)}`;
}

export function getCurationFormKey(
  selected: AdminCurationRecord | null,
  draftId: string,
  operationId: string,
) {
  return JSON.stringify([selected?.id ?? draftId, selected?.updatedAt ?? null, operationId]);
}

export function CurationSection({
  draftActiveFrom,
  draftId,
  ipOptions,
  onOpenNotifications,
  onSelect,
  operationId,
  records,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onOpenNotifications: () => void;
  onSelect: (curation: AdminCurationRecord | null) => void;
  operationId: string;
  records: AdminCurationRecord[];
  selected: AdminCurationRecord | null;
}) {
  return (
    <section aria-labelledby="admin-curation-heading" className="admin-curation-console col">
      <header className="admin-curation-heading">
        <div>
          <span className="mono">홈 편성 운영</span>
          <h2 id="admin-curation-heading">홈 큐레이션</h2>
          <p>공개 홈의 히어로, 특집 IP, 공지 배너의 노출 순서와 기간을 관리합니다.</p>
        </div>
        <button
          className="btn btn-ghost admin-curation-notification-cta"
          onClick={onOpenNotifications}
          type="button"
        >
          인앱 공지는 공지 발송에서 별도 발송
        </button>
      </header>

      <div className="admin-master-detail">
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="홈 큐레이션 목록"
          emptyMessage="등록된 홈 큐레이션이 없습니다."
          items={records}
          labelFor={formatCurationLabel}
          newLabel="새 홈 큐레이션"
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
        <CurationForm
          draftActiveFrom={draftActiveFrom}
          draftId={draftId}
          ipOptions={ipOptions}
          key={getCurationFormKey(selected, draftId, operationId)}
          operationId={operationId}
          selected={selected}
        />
      </div>
    </section>
  );
}

function CurationForm({
  draftActiveFrom,
  draftId,
  ipOptions,
  operationId,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  operationId: string;
  selected: AdminCurationRecord | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminCurationAction, emptyState);
  const [kind, setKind] = useState<AdminCurationKind>(selected?.kind ?? 'hero');
  const ipTitles = useMemo(
    () => new Map(ipOptions.map((ip) => [ip.id, ip.title])),
    [ipOptions],
  );

  return (
    <form action={action} className="card col admin-curation-form">
      <input name="operationId" type="hidden" value={operationId} />
      <input name="id" type="hidden" value={selected?.id ?? draftId} />

      <div className="admin-curation-window" role="status">
        <span className="mono">운영 윈도</span>
        <strong>
          {KIND_LABELS[kind]} · {selected ? STATUS_LABELS[selected.status] : '신규'} · 순서 {selected?.displayOrder ?? 0}
        </strong>
        <span>{formatKstDateTime(selected?.activeFrom ?? draftActiveFrom)} → {formatKstDateTime(selected?.activeTo ?? null)}</span>
      </div>

      <div className="admin-form-grid">
        <SelectField
          error={state.errors?.kind}
          label="홈에 보일 영역"
          name="kind"
          onChange={(event) => setKind(event.target.value as AdminCurationKind)}
          required
          value={kind}
        >
          <option value="hero">홈 히어로</option>
          <option value="featured_ip">특집 IP</option>
          <option value="announcement">공지 배너</option>
        </SelectField>
        <SelectField
          defaultValue={selected?.ipId ?? ''}
          disabled={kind !== 'featured_ip'}
          error={state.errors?.ipId}
          label="특집할 IP"
          name="ipId"
          required={kind === 'featured_ip'}
        >
          <option value="">IP 선택</option>
          {ipOptions.map((ip) => (
            <option disabled={Boolean(ip.archivedAt)} key={ip.id} value={ip.id}>
              {ip.archivedAt ? `[보관] ${ip.title}` : ip.title}
            </option>
          ))}
        </SelectField>
        <Field
          defaultValue={selected?.title}
          error={state.errors?.title}
          label="홈에 보일 제목"
          name="title"
          required
        />
        <Field
          defaultValue={selected?.linkPath ?? '/'}
          error={state.errors?.linkPath}
          label="이동할 내부 경로"
          name="linkPath"
          placeholder="/ip/rilakkuma"
          required
        />
        <Field
          defaultValue={selected?.displayOrder ?? 0}
          error={state.errors?.displayOrder}
          label="노출 순서"
          min={0}
          name="displayOrder"
          required
          step={1}
          type="number"
        />
        <Field
          defaultValue={toKstDateTimeInput(selected?.activeFrom ?? draftActiveFrom)}
          error={state.errors?.activeFrom}
          label="노출 시작 (KST)"
          name="activeFrom"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={toKstDateTimeInput(selected?.activeTo ?? null)}
          error={state.errors?.activeTo}
          label="노출 종료 (KST, 선택)"
          name="activeTo"
          type="datetime-local"
        />
        <label className="row admin-curation-enabled">
          <input defaultChecked={selected?.enabled ?? true} name="enabled" type="checkbox" />
          <span>홈 노출 활성화</span>
        </label>
      </div>

      <ArtworkUploadField
        currentPath={selected?.imagePath ?? null}
        currentUrl={selected?.imageUrl ?? null}
        helpText={ARTWORK_GUIDANCE[kind]}
        kind="curation"
      />
      <ErrorText id={state.errors?.imagePath ? 'curation-image-error' : undefined}>
        {state.errors?.imagePath}
      </ErrorText>
      {selected?.kind === 'featured_ip' && selected.ipId && (
        <p className="admin-curation-ip-note">
          현재 특집 IP: {ipTitles.get(selected.ipId) ?? selected.ipId}
        </p>
      )}
      <FormShell pending={pending} state={state} />
    </form>
  );
}

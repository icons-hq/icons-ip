import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminEventRecord } from '@/lib/admin/catalog.server';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { Field, FormShell, RecordList, SelectField } from '../fields';

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

export function EventSection({
  action,
  ipOptions,
  onSelect,
  pending,
  records,
  selected,
  state,
}: {
  action: (payload: FormData) => void;
  ipOptions: { id: string; title: string }[];
  onSelect: (event: AdminEventRecord | null) => void;
  pending: boolean;
  records: AdminEventRecord[];
  selected: AdminEventRecord | null;
  state: AdminCatalogActionState;
}) {
  return (
    <div className="admin-master-detail">
      <RecordList
        activeId={selected?.id ?? null}
        items={records}
        labelFor={(event) => `${event.id} · ${event.title}`}
        onNew={() => onSelect(null)}
        onSelect={onSelect}
      />
      <form action={action} className="card col" key={selected?.id ?? 'new-event'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        <div className="admin-form-grid">
          <Field defaultValue={selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="e100" />
          <SelectField defaultValue={optional(selected?.ipId)} error={state.errors?.ipId} label="연결 IP" name="ipId">
            <option value="">플랫폼/합동 이벤트</option>
            {ipOptions.map((ip) => (
              <option key={ip.id} value={ip.id}>{ip.title}</option>
            ))}
          </SelectField>
          <Field defaultValue={selected?.title} error={state.errors?.title} label="이벤트 이름" name="title" />
          <SelectField defaultValue={selected?.mode ?? '오프라인'} error={state.errors?.mode} label="모드" name="mode">
            <option value="오프라인">오프라인</option>
            <option value="온라인">온라인</option>
          </SelectField>
          <SelectField defaultValue={selected?.status ?? '예정'} error={state.errors?.status} label="상태" name="status">
            <option value="예정">예정</option>
            <option value="예매중">예매중</option>
            <option value="진행중">진행중</option>
            <option value="종료">종료</option>
          </SelectField>
          <Field defaultValue={dateTimeInput(selected?.startsAt)} label="시작" name="startsAt" type="datetime-local" />
          <Field defaultValue={dateTimeInput(selected?.endsAt)} label="종료" name="endsAt" type="datetime-local" />
          <Field defaultValue={selected?.location} label="장소" name="location" />
          <Field defaultValue={selected?.accent} label="액센트" name="accent" placeholder="#8B5CFF" />
        </div>
        <Field defaultValue={selected?.bg} label="배경 CSS" name="bg" />
        <ArtworkUploadField
          currentPath={selected?.imagePath ?? null}
          currentUrl={selected?.imageUrl ?? null}
          kind="event"
        />
        <FormShell pending={pending} state={state} />
      </form>
    </div>
  );
}

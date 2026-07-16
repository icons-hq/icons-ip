import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminIpRecord } from '@/lib/admin/catalog.server';
import type { CatalogSnapshot } from '@/lib/catalog';
import { ArtworkUploadField } from '../ArtworkUploadField';
import { Field, FormShell, RecordList, SelectField, TextArea } from '../fields';

export function IpSection({
  action,
  onSelect,
  pending,
  records,
  selected,
  state,
  verticals,
}: {
  action: (payload: FormData) => void;
  onSelect: (ip: AdminIpRecord | null) => void;
  pending: boolean;
  records: AdminIpRecord[];
  selected: AdminIpRecord | null;
  state: AdminCatalogActionState;
  verticals: CatalogSnapshot['verticals'];
}) {
  return (
    <div className="admin-master-detail">
      <RecordList
        activeId={selected?.id ?? null}
        items={records}
        labelFor={(ip) => `${ip.id} · ${ip.title}`}
        onNew={() => onSelect(null)}
        onSelect={onSelect}
      />
      <form action={action} className="card col" key={selected?.id ?? 'new-ip'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
        <div className="admin-form-grid">
          <Field defaultValue={selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="rilakkuma" />
          <Field defaultValue={selected?.title} error={state.errors?.title} label="IP 이름" name="title" placeholder="리락쿠마" />
          <Field defaultValue={selected?.sub} label="보조 설명" name="sub" placeholder="San-X · 캐릭터 IP" />
          <SelectField defaultValue={selected?.verticalKey} error={state.errors?.verticalKey} label="버티컬" name="verticalKey">
            <option value="">선택</option>
            {verticals.map((vertical) => (
              <option key={vertical.key} value={vertical.key}>{vertical.label}</option>
            ))}
          </SelectField>
          <Field defaultValue={selected?.tagline} label="태그라인" name="tagline" />
          <Field defaultValue={selected?.glyph} label="글리프" name="glyph" />
          <label className="row" style={{ alignItems: 'center', gap: 10, justifyContent: 'flex-start', paddingTop: 22 }}>
            <input defaultChecked={selected?.featured ?? false} name="featured" type="checkbox" />
            featured
          </label>
        </div>
        <TextArea defaultValue={selected?.synopsis} label="시놉시스" name="synopsis" />
        <Field defaultValue={selected?.bg} label="배경 CSS" name="bg" />
        <ArtworkUploadField
          currentPath={selected?.imagePath ?? null}
          currentUrl={selected?.imageUrl ?? null}
          helpText="IP 키아트는 가로형 이미지를 사용해주세요."
          kind="ip"
        />
        <FormShell pending={pending} state={state} />
      </form>
    </div>
  );
}

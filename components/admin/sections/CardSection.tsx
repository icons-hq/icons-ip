import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminCardRecord } from '@/lib/admin/catalog.server';
import { RARITY_META } from '@/lib/rarity';
import { Field, FormShell, RecordList, SelectField } from '../fields';

export function CardSection({
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
  onSelect: (card: AdminCardRecord | null) => void;
  pending: boolean;
  records: AdminCardRecord[];
  selected: AdminCardRecord | null;
  state: AdminCatalogActionState;
}) {
  return (
    <div className="admin-master-detail">
      <RecordList
        activeId={selected?.id ?? null}
        items={records}
        labelFor={(card) => `${card.id} · ${card.name}`}
        onNew={() => onSelect(null)}
        onSelect={onSelect}
      />
      <form action={action} className="card col" key={selected?.id ?? 'new-card'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        <div className="admin-form-grid">
          <Field defaultValue={selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="c100" />
          <SelectField defaultValue={selected?.ipId} error={state.errors?.ipId} label="연결 IP" name="ipId">
            <option value="">선택</option>
            {ipOptions.map((ip) => (
              <option key={ip.id} value={ip.id}>{ip.title}</option>
            ))}
          </SelectField>
          <Field defaultValue={selected?.name} error={state.errors?.name} label="카드 이름" name="name" />
          <Field defaultValue={selected?.no} label="번호" name="no" placeholder="001/120" />
          <SelectField defaultValue={selected?.rarity ?? 'N'} error={state.errors?.rarity} label="등급" name="rarity">
            {Object.keys(RARITY_META).map((rarity) => (
              <option key={rarity} value={rarity}>{rarity}</option>
            ))}
          </SelectField>
        </div>
        <Field defaultValue={selected?.bg} label="배경 CSS" name="bg" />
        <Field defaultValue={selected?.imagePath} label="이미지 경로" name="imagePath" />
        <FormShell pending={pending} state={state} />
      </form>
    </div>
  );
}

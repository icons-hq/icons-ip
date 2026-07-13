import type { AdminCatalogActionState } from '@/app/admin/actions';
import type { AdminGoodRecord } from '@/lib/admin/catalog.server';
import { Field, FormShell, RecordList, SelectField } from '../fields';

export function GoodSection({
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
  onSelect: (good: AdminGoodRecord | null) => void;
  pending: boolean;
  records: AdminGoodRecord[];
  selected: AdminGoodRecord | null;
  state: AdminCatalogActionState;
}) {
  return (
    <div className="admin-master-detail">
      <RecordList
        activeId={selected?.id ?? null}
        items={records}
        labelFor={(good) => `${good.id} · ${good.name}`}
        onNew={() => onSelect(null)}
        onSelect={onSelect}
      />
      <form action={action} className="card col" key={selected?.id ?? 'new-good'} style={{ borderRadius: 10, gap: 14, padding: 18 }}>
        <input name="previousIpId" type="hidden" value={selected?.ipId ?? ''} />
        <div className="admin-form-grid">
          <Field defaultValue={selected?.id} error={state.errors?.id} label="ID" name="id" placeholder="g100" />
          <SelectField defaultValue={selected?.ipId} error={state.errors?.ipId} label="연결 IP" name="ipId">
            <option value="">선택</option>
            {ipOptions.map((ip) => (
              <option key={ip.id} value={ip.id}>{ip.title}</option>
            ))}
          </SelectField>
          <Field defaultValue={selected?.name} error={state.errors?.name} label="굿즈 이름" name="name" />
          <Field defaultValue={selected?.type} error={state.errors?.type} label="유형" name="type" />
          <Field defaultValue={selected?.price ?? 0} error={state.errors?.price} label="가격" name="price" type="number" />
          <Field defaultValue={selected?.badge} label="배지" name="badge" />
          <SelectField defaultValue={selected?.stock ?? 'ok'} error={state.errors?.stock} label="재고 상태" name="stock">
            <option value="ok">ok</option>
            <option value="low">low</option>
            <option value="soldout">soldout</option>
          </SelectField>
        </div>
        <Field defaultValue={selected?.bg} label="배경 CSS" name="bg" />
        <Field defaultValue={selected?.imagePath} label="이미지 경로" name="imagePath" />
        <FormShell pending={pending} state={state} />
      </form>
    </div>
  );
}

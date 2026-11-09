'use client';

import { useActionState, useId } from 'react';
import { saveIpDirectoryAction, type IpDirectoryActionState } from '@/app/admin/ip-directory-actions';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { AdminField, AdminSectionCard } from './console/AdminKit';
import { IP_FEATURED_LIMIT, type AdminIpSummary } from '@/lib/admin/ip-workspace';

const EMPTY: IpDirectoryActionState = {};
export function IpDirectoryControls({ id, directory }: { id: string; directory: AdminIpSummary[] }) {
  const [state, action, pending] = useActionState(saveIpDirectoryAction, EMPTY);
  const inputId = useId();
  const index = directory.findIndex((ip) => ip.id === id);
  const selected = directory[index];
  if (!selected) return null;
  const currentOrder = directory.map((ip) => ip.id);
  const position = state.values?.position ?? String(index + 1);
  const featured = state.values ? state.values.featured === 'on' : selected.featured;
  return <AdminSectionCard title="디렉토리 노출">
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p>추천 IP <span className="tabular-nums">{directory.filter((ip) => ip.featured).length}/{IP_FEATURED_LIMIT}</span>개 · 최대 {IP_FEATURED_LIMIT}개를 지정할 수 있습니다.</p>
      <p>순번은 모든 IP 기준입니다. 초안·보관 IP는 공개 디렉토리에 표시되지 않습니다.</p>
    </div>
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0" key={`${state.attempt ?? 0}:${JSON.stringify(currentOrder)}:${selected.featured}`} disabled={pending}>
        <input name="id" type="hidden" value={id} />
        <input name="expectedOrder" type="hidden" value={state.values?.expectedOrder ?? JSON.stringify(currentOrder)} />
        <input name="expectedFeatured" type="hidden" value={state.values?.expectedFeatured ?? String(selected.featured)} />
        <label className="flex w-fit items-center gap-2 text-sm font-medium">
          <input name="featured" type="checkbox" defaultChecked={featured} disabled={Boolean(selected.archivedAt && !selected.featured)} /> 추천 IP로 노출
        </label>
        <AdminField label="디렉토리 순번" inputId={inputId} hint={`1~${directory.length} 사이의 순번을 입력해주세요.`}>
          <Input className="w-32 tabular-nums" id={inputId} name="position" type="number" min={1} max={directory.length} step={1} defaultValue={position} required aria-describedby={`${inputId}-hint`} />
        </AdminField>
        <div className="flex flex-wrap items-center gap-2">
          <Button name="move" value="up" disabled={index === 0} type="submit" variant="outline">↑ 위로</Button>
          <Button name="move" value="down" disabled={index === directory.length - 1} type="submit" variant="outline">↓ 아래로</Button>
          <Button type="submit">{pending ? '저장 중…' : '노출 설정 저장'}</Button>
        </div>
      </fieldset>
      {state.errors?.form ? <p className="text-sm text-destructive" role="alert">{state.errors.form}</p> : null}
      {state.message ? <p className="text-sm font-medium text-success" role="status">{state.message}</p> : null}
    </form>
  </AdminSectionCard>;
}

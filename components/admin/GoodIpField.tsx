'use client';

import { useState } from 'react';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { GOOD_EDITOR_B7_HELP } from '@/lib/admin/help/good-editor-b7';
import { adminPickerLocalLoader } from '@/lib/admin/picker';
import { AdminPickedBox, useAdminPickedValue } from './AdminPickedValue';
import { AdminField } from './console/AdminKit';

export interface GoodIpOption { id: string; title: string; archivedAt: string | null }

const DISPLAY_ID = 'good-ip-display';
const ipRowKey = (ip: GoodIpOption) => ip.id;
const ipRowView = (ip: GoodIpOption): AdminPickerRowView => ({ title: ip.title });
const ipText = (ip: GoodIpOption) => ip.title;

/** 상자에 보일 글: IP 이름. 보관한 IP가 연결돼 있으면 이름 앞에 '보관됨'을 붙인다(대표 카테고리 칸과 같은 표기). */
export function goodIpDisplayText(options: readonly GoodIpOption[], ipId: string): string {
  if (!ipId) return '';
  const ip = options.find((option) => option.id === ipId);
  return ip ? `${ip.archivedAt ? '보관됨 · ' : ''}${ip.title}` : '알 수 없는 IP';
}

/**
 * 상품 등록·수정의 연결 IP 칸. 고른 IP의 이름을 상자에 보이고 [IP 고르기]가 공용 선택창을 연다(화면 규칙 1).
 * 선택창에는 보관하지 않은 IP만 나온다(규칙 2). 보관한 IP가 이미 연결돼 있으면 상자에 이름과 '보관됨'만 보인다.
 * 제출 값은 숨은 칸 name="ipId" 하나다. 고르면 그 칸에서 input 이벤트가 나가 편집기가 폼 값으로 새 IP를 읽는다(상품 자동코드 제안·미리보기·이탈 경고).
 * `locked`(공개 중이거나 그룹 공통정보가 정하는 상품)면 바꿀 수 없다 — 점선 상자만 보이고 값은 그대로 제출한다.
 * `canOpenIp`는 IP 화면을 열 수 있는 운영자에게만 켠다. 연결한 IP가 공개돼 있는지 새 탭에서 확인하는 길이다(판매 준비의 '연결 IP 비공개' 안내가 이 칸으로 온다).
 */
export function GoodIpField({ options, defaultValue, label, error, locked = false, canOpenIp = false }: {
  options: readonly GoodIpOption[]; defaultValue: string; label: string; error?: string; locked?: boolean; canOpenIp?: boolean;
}) {
  const { value, setValue, inputRef } = useAdminPickedValue(defaultValue);
  const [open, setOpen] = useState(false);
  const active = options.filter((option) => !option.archivedAt);
  return <AdminField error={error} help={GOOD_EDITOR_B7_HELP.connectedIp} inputId={DISPLAY_ID} label={label}>
    <AdminPickedBox inputId={DISPLAY_ID} inputRef={inputRef} invalid={Boolean(error)} locked={locked} name="ipId" onOpen={() => setOpen(true)}
      pickLabel="IP 고르기" placeholder="아직 고르지 않았습니다" text={goodIpDisplayText(options, value)} value={value}>
      {canOpenIp && value ? <a className="text-sm underline underline-offset-4" href={`/admin/catalog/ips/${encodeURIComponent(value)}`} rel="noreferrer" target="_blank">IP 화면 열기 ↗</a> : null}
    </AdminPickedBox>
    {open ? <AdminPickerDialog<GoodIpOption>
      emptyText="맞는 IP가 없습니다."
      excludedNote={active.length < options.length ? '보관한 IP는 목록에서 뺐습니다.' : undefined}
      load={adminPickerLocalLoader(active, { textOf: ipText })}
      onClose={() => setOpen(false)}
      onSelect={(ip) => { setValue(ip.id); }}
      rowKey={ipRowKey}
      rowView={ipRowView}
      searchPlaceholder="IP 이름으로 찾기"
      selectedKeys={value ? [value] : undefined}
      title="연결 IP 고르기"
    /> : null}
  </AdminField>;
}

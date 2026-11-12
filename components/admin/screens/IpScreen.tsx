'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { upsertAdminIpAction, type AdminCatalogActionState } from '@/app/admin/actions';
import { IpSection } from '@/components/admin/sections/IpSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { AdminIpDeleteReadiness } from '@/lib/admin/ip-delete';
import { ipWorkspaceHref } from '@/lib/admin/ip-workspace';
import type { CatalogSnapshot } from '@/lib/catalog';
import { useSelectedRecord } from './record-selection';

const emptyState: AdminCatalogActionState = {};

/*
 * 화면별 클라이언트 래퍼.
 *
 * 서버 컴포넌트 라우트가 데이터를 로드하고, 선택 레코드와 useActionState 같은
 * 화면 로컬 상태는 여기가 갖는다. 예전에는 Admin.tsx 하나가 17개 섹션의 상태를
 * 전부 들고 있어서 어느 화면을 열든 모든 상태가 살아 있었다.
 */
export function IpScreen({
  accountId,
  canDeleteDraft = false,
  deletion = null,
  records,
  verticals,
  selectedId = null,
  hideRecordList = false,
}: {
  accountId: string;
  canDeleteDraft?: boolean;
  deletion?: AdminIpDeleteReadiness | null;
  records: AdminCatalogRecords['ips'];
  verticals: CatalogSnapshot['verticals'];
  selectedId?: string | null;
  hideRecordList?: boolean;
}) {
  const [state, action, pending] = useActionState(upsertAdminIpAction, emptyState);
  const { selected, select } = useSelectedRecord(records, selectedId);
  const router = useRouter();
  /*
   * 새 IP를 처음 저장하면 시스템이 발급한 내부 ID의 상세로 옮긴다(S36-003). 상세 머리와 기본 정보에서 그 ID를
   * '내부 ID(변경 불가)'로 보고, 이어서 IP관 배너·공개 URL·게시 상태를 다룬다. 옮기는 동안에는 두 번 등록되지 않게 저장을 잠근다.
   */
  const createdId = !selectedId && !state.errors ? state.savedIpId ?? null : null;
  useEffect(() => {
    if (createdId) router.replace(`${ipWorkspaceHref(createdId)}?created=1`);
  }, [createdId, router]);

  return (
    <IpSection
      accountId={accountId}
      action={action}
      canDeleteDraft={canDeleteDraft}
      deletion={deletion}
      hideRecordList={hideRecordList}
      onSelect={select}
      pending={pending || Boolean(createdId)}
      records={records}
      selected={selected}
      state={state}
      verticals={verticals}
    />
  );
}

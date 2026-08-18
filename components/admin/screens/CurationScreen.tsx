'use client';

import { useState } from 'react';
import { CurationSection } from '@/components/admin/sections/CurationSection';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import type { AdminCurationRecord } from '@/lib/admin/curations.server';

/*
 * 홈 큐레이션 화면의 클라이언트 래퍼.
 *
 * 라우트(서버 컴포넌트)가 레코드와 이동 대상 목록을 로드하고, 목록에서 어떤
 * 큐레이션을 편집 중인지는 화면 로컬 상태로 여기 둔다. 이동 대상은 id·제목·
 * 보관 여부만 필요해서 서버에서 미리 좁혀 내려온다 — 카탈로그 레코드 전체를
 * 클라이언트로 실어 보낼 이유가 없다.
 */
export function CurationScreen({
  draftActiveFrom,
  draftId,
  eventOptions,
  goodOptions,
  ipOptions,
  operationId,
  records,
}: {
  draftActiveFrom: string;
  draftId: string;
  eventOptions: AdminCurationTargetRecord[];
  goodOptions: AdminCurationTargetRecord[];
  ipOptions: AdminCurationTargetRecord[];
  operationId: string;
  records: AdminCurationRecord[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = records.find((curation) => curation.id === selectedId) ?? null;

  return (
    <CurationSection
      draftActiveFrom={draftActiveFrom}
      draftId={draftId}
      eventOptions={eventOptions}
      goodOptions={goodOptions}
      ipOptions={ipOptions}
      onSelect={(curation) => setSelectedId(curation?.id ?? null)}
      operationId={operationId}
      records={records}
      selected={selected}
    />
  );
}

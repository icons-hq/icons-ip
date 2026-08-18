'use client';

import { DrawTicketGrantSection } from '@/components/admin/sections/DrawTicketGrantSection';
import type { AdminCatalogRecords } from '@/lib/admin/catalog.server';
import type { AdminDrawTicketGrantRecord } from '@/lib/admin/draw-ticket-grants';

/*
 * 카드팩 수동 발급 화면 래퍼.
 *
 * 회원 검색·발급 상태는 섹션이 이미 자기 안에서 들고 있어 여기는 통과만 시킨다.
 * 그래도 화면 하나에 래퍼 하나를 유지하는 이유는, page(서버)가 클라이언트 섹션을
 * 직접 import하지 않게 해서 경계를 한 겹으로 고정하기 위해서다.
 */
export function DrawTicketGrantScreen({
  draftOperationId,
  grants,
  pools,
}: {
  draftOperationId: string;
  grants: AdminDrawTicketGrantRecord[];
  pools: AdminCatalogRecords['cardPools'];
}) {
  return (
    <DrawTicketGrantSection
      draftOperationId={draftOperationId}
      grants={grants}
      pools={pools}
    />
  );
}

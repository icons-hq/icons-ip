'use client';

import { useState } from 'react';
import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';

/*
 * 화면 래퍼 9개가 똑같이 반복하던 "선택 id를 들고 레코드를 되찾는" 조각.
 *
 * 레코드가 아니라 id를 상태로 두는 이유는, 저장 후 서버가 새 배열을 내려보내면
 * 레코드 참조가 바뀌기 때문이다. id로 다시 찾으면 방금 저장한 항목이 선택된 채로
 * 남고, 목록에서 사라진 항목(보관 처리 등)은 자연히 선택 해제된다.
 */
export function useSelectedRecord<T extends { id: string }>(
  records: readonly T[],
  initialId: string | null = null,
) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId);

  return {
    selected: records.find((record) => record.id === selectedId) ?? null,
    select: (record: { id: string } | null) => setSelectedId(record?.id ?? null),
  };
}

/**
 * 셀렉트 박스가 쓰는 `{ id, title, archivedAt }` 모양으로 줄인다.
 * 보관된 항목도 남기는 이유는 이미 그 값을 참조하는 레코드를 편집할 때
 * 선택지가 사라지면 저장이 막히기 때문이다 — 표시는 섹션이 판단한다.
 */
export function toRecordOptions(
  records: readonly { id: string; title: string; archivedAt: string | null }[],
): AdminCurationTargetRecord[] {
  return records.map((record) => ({
    id: record.id,
    title: record.title,
    archivedAt: record.archivedAt,
  }));
}

/** 굿즈 레코드의 표시 이름은 `name` 이다 — 대상 목록에서는 `title` 로 맞춘다. */
export function toGoodRecordOptions(
  goods: readonly { id: string; name: string; archivedAt: string | null }[],
): AdminCurationTargetRecord[] {
  return goods.map((good) => ({
    id: good.id,
    title: good.name,
    archivedAt: good.archivedAt,
  }));
}

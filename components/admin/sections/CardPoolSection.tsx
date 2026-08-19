'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import {
  setAdminPoolOddsAction,
  upsertAdminCardPoolAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type { AdminCardPoolRecord, AdminCardRecord } from '@/lib/admin/catalog.server';
import type { RarityKey } from '@/lib/rarity';
import { ErrorText, Field, FormShell, RecordList, SelectField } from '../fields';

const emptyState: AdminCatalogActionState = {};
const RARITIES: RarityKey[] = ['N', 'R', 'SR', 'SSR', 'HOLO'];
const PERCENT_PATTERN = /^(?:100(?:\.0{1,3})?|(?:\d|[1-9]\d)(?:\.\d{1,3})?)$/;
type OddsInputs = Record<RarityKey, string>;

export function poolOddsTotalMilliPercent(values: OddsInputs) {
  let total = 0;
  for (const rarity of RARITIES) {
    const raw = values[rarity].trim();
    if (!PERCENT_PATTERN.test(raw)) return null;
    const [whole, fraction = ''] = raw.split('.');
    total += Number(whole) * 1_000 + Number(fraction.padEnd(3, '0'));
  }
  return total;
}

function toKstDateTimeInput(value: string | null) {
  if (!value) return '';
  return new Date(Date.parse(value) + 9 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function probabilityToPercent(value: number) {
  return String(Number((value * 100).toFixed(3)));
}

const STATUS_LABELS: Record<AdminCardPoolRecord['status'], string> = {
  scheduled: '운영 예정',
  active: '운영 중',
  ended: '운영 종료',
};

export function CardPoolSection({
  cards,
  draftActiveFrom,
  draftId,
  ipOptions,
  oddsOperationId,
  onSelect,
  operationId,
  records,
  selected,
}: {
  cards: AdminCardRecord[];
  draftActiveFrom: string;
  draftId: string;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  oddsOperationId: string;
  onSelect: (pool: AdminCardPoolRecord | null) => void;
  operationId: string;
  records: AdminCardPoolRecord[];
  selected: AdminCardPoolRecord | null;
}) {
  const poolCards = useMemo(
    () => cards.filter((card) => card.poolId === selected?.id),
    [cards, selected?.id],
  );

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="admin-master-detail">
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="카드풀 목록"
          emptyMessage="등록된 카드풀이 없습니다."
          items={records}
          labelFor={(pool) => `${pool.name} · ${STATUS_LABELS[pool.status]}`}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
        <PoolForm
          draftActiveFrom={draftActiveFrom}
          draftId={draftId}
          ipOptions={ipOptions}
          key={`${selected?.id ?? draftId}-${operationId}-${selected?.updatedAt ?? 'new'}`}
          operationId={operationId}
          selected={selected}
        />
      </div>

      <div className="admin-master-detail">
        <OddsForm
          key={`${selected?.id ?? 'no-pool'}-${oddsOperationId}`}
          operationId={oddsOperationId}
          selected={selected}
        />
        <PoolCardRoster cards={poolCards} selected={selected} />
      </div>
    </div>
  );
}

function PoolForm({
  draftActiveFrom,
  draftId,
  ipOptions,
  operationId,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  operationId: string;
  selected: AdminCardPoolRecord | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminCardPoolAction, emptyState);
  const noIps = !ipOptions.some((ip) => !ip.archivedAt || ip.id === selected?.ipId);
  const initialIpId = selected?.ipId ?? ipOptions.find((ip) => !ip.archivedAt)?.id ?? '';

  return (
    <form action={action} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="id" type="hidden" value={selected?.id ?? draftId} />
      <div className="admin-form-grid">
        <SelectField
          defaultValue={initialIpId}
          error={state.errors?.ipId}
          label="연결 IP"
          name="ipId"
          required
        >
          <option value="">선택</option>
          {ipOptions.map((ip) => (
            <option
              disabled={Boolean(ip.archivedAt && ip.id !== selected?.ipId)}
              key={ip.id}
              value={ip.id}
            >
              {ip.archivedAt ? `[보관] ${ip.title}` : ip.title}
            </option>
          ))}
        </SelectField>
        <Field
          defaultValue={selected?.name}
          error={state.errors?.name}
          label="카드풀 이름"
          name="name"
          required
        />
        <Field
          defaultValue={toKstDateTimeInput(selected?.activeFrom ?? draftActiveFrom)}
          error={state.errors?.activeFrom}
          label="운영 시작 (KST)"
          name="activeFrom"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={toKstDateTimeInput(selected?.activeTo ?? null)}
          error={state.errors?.activeTo}
          label="운영 종료 (KST, 선택)"
          name="activeTo"
          type="datetime-local"
        />
      </div>
      {noIps && <p role="status" style={{ margin: 0 }}>먼저 IP를 등록해주세요.</p>}
      <FormShell disabled={noIps} pending={pending} state={state} />
    </form>
  );
}

function OddsForm({
  operationId,
  selected,
}: {
  operationId: string;
  selected: AdminCardPoolRecord | null;
}) {
  const [state, action, pending] = useActionState(setAdminPoolOddsAction, emptyState);
  const [values, setValues] = useState<OddsInputs>(() => Object.fromEntries(
    RARITIES.map((rarity) => [rarity, probabilityToPercent(selected?.odds[rarity] ?? 0)]),
  ) as OddsInputs);
  const total = poolOddsTotalMilliPercent(values);
  const validTotal = total === 100_000;
  const totalLabel = total === null
    ? '합계를 계산할 수 없습니다.'
    : `합계 ${Number((total / 1_000).toFixed(3))}% · ${validTotal ? '저장 가능' : '100% 필요'}`;

  return (
    <form action={action} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="poolId" type="hidden" value={selected?.id ?? ''} />
      <div>
        <strong>등급별 발급 확률</strong>
        <p style={{ color: 'var(--dim)', fontSize: 12, margin: '6px 0 0' }}>퍼센트 합계가 정확히 100%여야 저장됩니다.</p>
      </div>
      {!selected && <div className="card" role="status" style={{ padding: 12 }}>카드풀을 먼저 저장해주세요.</div>}
      {selected && !selected.oddsConfigured && (
        <div className="card" role="status" style={{ color: 'var(--pink)', padding: 12 }}>
          등급별 발급 확률이 아직 설정되지 않았습니다.
        </div>
      )}
      <div className="admin-form-grid">
        {RARITIES.map((rarity) => {
          const name = `odds${rarity[0]}${rarity.slice(1).toLowerCase()}`;
          const errorId = state.errors?.[name] ? `${name}-error` : undefined;
          return (
            <label className="col" key={rarity} style={{ gap: 7 }}>
              <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>{rarity} (%)</span>
              <input
                aria-describedby={errorId}
                aria-invalid={Boolean(errorId)}
                className="admin-field-control"
                disabled={!selected}
                max={100}
                min={0}
                name={name}
                onChange={(event) => setValues((current) => ({ ...current, [rarity]: event.target.value }))}
                required
                step="0.001"
                type="number"
                value={values[rarity]}
                style={{
                  background: 'rgba(255,255,255,.045)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  color: 'var(--text)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  minHeight: 42,
                  outline: 'none',
                  padding: '0 12px',
                  width: '100%',
                }}
              />
              <ErrorText id={errorId}>{state.errors?.[name]}</ErrorText>
            </label>
          );
        })}
      </div>
      <div
        aria-live="polite"
        role="status"
        style={{ color: validTotal ? 'var(--mint)' : 'var(--pink)', fontSize: 13, fontWeight: 800 }}
      >
        {totalLabel}
      </div>
      <ErrorText>{state.errors?.oddsTotal}</ErrorText>
      <div className="card" style={{ color: 'var(--dim)', fontSize: 12, lineHeight: 1.6, padding: 12 }}>
        변경한 구성과 확률은 저장 즉시 적용되며, 이미 발급된 미사용 카드팩도 개봉 시점의 최신 구성과 확률을 사용합니다.
      </div>
      <FormShell disabled={!selected || !validTotal} pending={pending} state={state} />
    </form>
  );
}

/*
 * 카드 편집은 카드 화면으로 넘기는 링크다.
 *
 * 어드민이 화면별 라우트로 갈라지기 전에는 부모(Admin.tsx)의 상태를 바꿔 섹션을
 * 전환하는 콜백이었다. 이제는 화면끼리 상태를 공유하지 않으므로 `?cardId=`로 넘긴다 —
 * 새 탭·북마크·뒤로가기가 그대로 동작하는 것은 덤이다.
 */
function PoolCardRoster({
  cards,
  selected,
}: {
  cards: AdminCardRecord[];
  selected: AdminCardPoolRecord | null;
}) {
  const missingRarities = selected
    ? RARITIES.filter((rarity) => (
      selected.odds[rarity] > 0
      && !cards.some((card) => !card.archivedAt && card.rarity === rarity)
    ))
    : [];

  return (
    <section aria-label="선택한 카드풀 소속 카드" className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div>
        <strong>소속 카드</strong>
        <p style={{ color: 'var(--dim)', fontSize: 12, margin: '6px 0 0' }}>카드 편집 화면에서 풀 바인딩을 변경합니다.</p>
      </div>
      {!selected && <p style={{ color: 'var(--dim)', margin: 0 }}>카드풀을 선택해주세요.</p>}
      {selected && !cards.length && <p style={{ color: 'var(--dim)', margin: 0 }}>연결된 카드가 없습니다.</p>}
      {missingRarities.map((rarity) => (
        <div className="card" key={rarity} role="alert" style={{ color: 'var(--pink)', padding: 12 }}>
          {rarity} 등급 카드가 없습니다.
        </div>
      ))}
      {cards.map((card) => (
        <div className="card row" key={card.id} style={{ alignItems: 'center', gap: 12, justifyContent: 'space-between', padding: 12 }}>
          <div>
            <strong>{card.archivedAt ? `[보관] ${card.name}` : card.name}</strong>
            <div className="mono" style={{ color: 'var(--dim)', fontSize: 11, marginTop: 4 }}>{card.rarity} · {card.id}</div>
          </div>
          <Link className="btn" href={`/admin/catalog/cards?cardId=${encodeURIComponent(card.id)}`}>카드 편집</Link>
        </div>
      ))}
    </section>
  );
}

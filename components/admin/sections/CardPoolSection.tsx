'use client';

import { AdminFormGrid } from '@/components/admin/console/AdminKit';
import Link from 'next/link';
import { useActionState, useId, useMemo, useState } from 'react';
import {
  setAdminPoolOddsAction,
  upsertAdminCardPoolAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type { AdminCardPoolRecord, AdminCardRecord } from '@/lib/admin/catalog.server';
import { adminFormRemountKey, resolveFieldDefault } from '@/lib/admin/form-state';
import type { RarityKey } from '@/lib/rarity';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { ErrorText, Field, FormShell, RecordList, SelectField } from '../fields';
import { MasterDetail, SECTION_CARD, SECTION_NOTE, SECTION_WARNING, SectionHeading } from './SectionLayout';

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

  /* 목록 열에는 카드풀 목록만, 편집 열에는 선택한 카드풀의 정보 → 발급 확률 → 소속 카드를 차례로 둔다. */
  return (
    <MasterDetail
      list={(
        <RecordList
          activeId={selected?.id ?? null}
          ariaLabel="카드풀 목록"
          emptyMessage="등록된 카드풀이 없습니다."
          items={records}
          labelFor={(pool) => `${pool.name} · ${STATUS_LABELS[pool.status]}`}
          onNew={() => onSelect(null)}
          onSelect={onSelect}
        />
      )}
    >
      <PoolForm
        draftActiveFrom={draftActiveFrom}
        draftId={draftId}
        ipOptions={ipOptions}
        key={`${selected?.id ?? draftId}-${operationId}-${selected?.updatedAt ?? 'new'}`}
        operationId={operationId}
        selected={selected}
      />
      <OddsForm
        key={`${selected?.id ?? 'no-pool'}-${oddsOperationId}`}
        operationId={oddsOperationId}
        selected={selected}
      />
      <PoolCardRoster cards={poolCards} selected={selected} />
    </MasterDetail>
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
  const defaults = {
    id: selected?.id ?? draftId,
    ipId: selected?.ipId ?? ipOptions.find((ip) => !ip.archivedAt)?.id ?? '',
    name: selected?.name ?? '',
    activeFrom: toKstDateTimeInput(selected?.activeFrom ?? draftActiveFrom),
    activeTo: toKstDateTimeInput(selected?.activeTo ?? null),
  };
  const field = (name: string) => resolveFieldDefault(state, defaults, name, { scopeKey: 'id' });

  return (
    <form action={action} className={SECTION_CARD} key={adminFormRemountKey(state, defaults)}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="id" type="hidden" value={selected?.id ?? draftId} />
      <AdminFormGrid>
        <SelectField
          defaultValue={field('ipId')}
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
          defaultValue={field('name')}
          error={state.errors?.name}
          label="카드풀 이름"
          name="name"
          required
        />
        <Field
          defaultValue={field('activeFrom')}
          error={state.errors?.activeFrom}
          label="운영 시작 (KST)"
          name="activeFrom"
          required
          type="datetime-local"
        />
        <Field
          defaultValue={field('activeTo')}
          error={state.errors?.activeTo}
          label="운영 종료 (KST, 선택)"
          name="activeTo"
          type="datetime-local"
        />
      </AdminFormGrid>
      {noIps && <p className={SECTION_NOTE} role="status">먼저 IP를 등록해주세요.</p>}
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
  const idPrefix = useId();
  const [values, setValues] = useState<OddsInputs>(() => Object.fromEntries(
    RARITIES.map((rarity) => [rarity, probabilityToPercent(selected?.odds[rarity] ?? 0)]),
  ) as OddsInputs);
  const total = poolOddsTotalMilliPercent(values);
  const validTotal = total === 100_000;
  const totalLabel = total === null
    ? '합계를 계산할 수 없습니다.'
    : `합계 ${Number((total / 1_000).toFixed(3))}% · ${validTotal ? '저장 가능' : '100% 필요'}`;

  return (
    <form action={action} className={SECTION_CARD}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="poolId" type="hidden" value={selected?.id ?? ''} />
      <SectionHeading description="퍼센트 합계가 정확히 100%여야 저장됩니다." title="등급별 발급 확률" />
      {!selected && <div className={SECTION_NOTE} role="status">카드풀을 먼저 저장해주세요.</div>}
      {selected && !selected.oddsConfigured && (
        <div className={SECTION_WARNING} role="status">
          등급별 발급 확률이 아직 설정되지 않았습니다.
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
        {RARITIES.map((rarity) => {
          const name = `odds${rarity[0]}${rarity.slice(1).toLowerCase()}`;
          const inputId = `${idPrefix}-${name}`;
          const errorId = state.errors?.[name] ? `${name}-error` : undefined;
          return (
            <div className="flex min-w-0 flex-col gap-2" key={rarity}>
              <Label htmlFor={inputId}>{rarity} (%)</Label>
              <Input
                aria-describedby={errorId}
                aria-invalid={Boolean(errorId)}
                className="tabular-nums"
                disabled={!selected}
                id={inputId}
                max={100}
                min={0}
                name={name}
                onChange={(event) => setValues((current) => ({ ...current, [rarity]: event.target.value }))}
                required
                step="0.001"
                type="number"
                value={values[rarity]}
              />
              <ErrorText id={errorId}>{state.errors?.[name]}</ErrorText>
            </div>
          );
        })}
      </div>
      <div
        aria-live="polite"
        className={`text-sm font-semibold tabular-nums ${validTotal ? 'text-[var(--wc-success)]' : 'text-destructive'}`}
        role="status"
      >
        {totalLabel}
      </div>
      <ErrorText>{state.errors?.oddsTotal}</ErrorText>
      <div className={SECTION_NOTE}>
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
    <section aria-label="선택한 카드풀 소속 카드" className={SECTION_CARD}>
      <SectionHeading description="카드 편집 화면에서 풀 바인딩을 변경합니다." title="소속 카드" />
      {!selected && <p className="text-sm text-muted-foreground">카드풀을 선택해주세요.</p>}
      {selected && !cards.length && <p className="text-sm text-muted-foreground">연결된 카드가 없습니다.</p>}
      {missingRarities.map((rarity) => (
        <div className={SECTION_WARNING} key={rarity} role="alert">
          {rarity} 등급 카드가 없습니다.
        </div>
      ))}
      {cards.length ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {cards.map((card) => (
            <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5" key={card.id}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium break-words">{card.archivedAt ? `[보관] ${card.name}` : card.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{card.rarity} · {card.id}</span>
              </div>
              <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href={`/admin/catalog/cards?cardId=${encodeURIComponent(card.id)}`}>카드 편집</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

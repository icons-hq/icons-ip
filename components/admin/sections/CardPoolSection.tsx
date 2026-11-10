'use client';

import { AdminFormGrid, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
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
import { Check } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { ActionNotice, ErrorText, Field, SelectField } from '../fields';
import { statusTone } from '@/lib/admin/status-tone';
import { MasterDetail, RecordDetailPane, RecordFormHeading, SECTION_CARD, SectionHeading } from './SectionLayout';
import { RecordMasterList } from './RecordMasterList';
import { RecordStatusLabel } from './RecordStatusLabel';

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

/* 카드풀 정보와 확률은 저장 대상이 달라 같은 화면의 두 저장 버튼을 이름으로 구분한다. */
function SaveAction({ disabled, label, pending, state }: { disabled: boolean; label: string; pending: boolean; state: AdminCatalogActionState }) {
  return (
    <>
      <ActionNotice state={state} />
      <Button className="self-start" disabled={disabled || pending} type="submit"><Check aria-hidden="true" /> {pending ? '저장 중' : label}</Button>
    </>
  );
}

export function CardPoolSection({
  cards,
  creating = false,
  draftActiveFrom,
  draftId,
  ipOptions,
  oddsOperationId,
  onClose,
  onSelect,
  operationId,
  records,
  selected,
}: {
  cards: AdminCardRecord[];
  /** 새 카드풀 입력 칸을 연 상태. 고른 카드풀도 없고 이 값도 꺼져 있으면 오른쪽은 안내만 보인다. */
  creating?: boolean;
  draftActiveFrom: string;
  draftId: string;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  oddsOperationId: string;
  onClose?: () => void;
  onSelect: (pool: AdminCardPoolRecord | null) => void;
  operationId: string;
  records: AdminCardPoolRecord[];
  selected: AdminCardPoolRecord | null;
}) {
  const poolCards = useMemo(
    () => cards.filter((card) => card.poolId === selected?.id),
    [cards, selected?.id],
  );

  /* 처음 열면 왼쪽 목록과 안내만 보이고 주 행동은 화면 머리의 등록 버튼 하나다(카드·이벤트와 같은 배치). 카드풀을 고르면 정보 → 발급 확률 → 소속 카드를 차례로 연다. */
  return (
    <MasterDetail
      list={(
        <RecordMasterList
          activeId={selected?.id ?? null}
          ariaLabel="카드풀 목록"
          emptyMessage="등록된 카드풀이 없습니다."
          items={records}
          labelFor={(pool) => <RecordStatusLabel name={pool.name} status={STATUS_LABELS[pool.status]} tone={statusTone('cardPool', pool.status)} title={`${pool.name} · ${STATUS_LABELS[pool.status]}`} />}
          onSelect={onSelect}
        />
      )}
    >
      <RecordDetailPane hint="새 카드풀은 오른쪽 위 카드풀 등록 버튼으로 만듭니다." open={Boolean(selected) || creating} prompt="목록에서 카드풀을 고르면 여기에서 구성과 발급 확률을 수정합니다.">
        <PoolForm
          draftActiveFrom={draftActiveFrom}
          draftId={draftId}
          ipOptions={ipOptions}
          key={`${selected?.id ?? draftId}-${operationId}-${selected?.updatedAt ?? 'new'}`}
          onClose={onClose}
          operationId={operationId}
          selected={selected}
        />
        <OddsForm
          key={`${selected?.id ?? 'no-pool'}-${oddsOperationId}`}
          operationId={oddsOperationId}
          selected={selected}
        />
        <PoolCardRoster cards={poolCards} selected={selected} />
      </RecordDetailPane>
    </MasterDetail>
  );
}

function PoolForm({
  draftActiveFrom,
  draftId,
  ipOptions,
  onClose,
  operationId,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onClose?: () => void;
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
      <RecordFormHeading editing={selected?.name ?? null} noun="카드풀" onClose={onClose} />
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
      {noIps && <AdminNotice role="status" tone="warning">먼저 IP를 등록해주세요.</AdminNotice>}
      <SaveAction disabled={noIps} label="카드풀 저장" pending={pending} state={state} />
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
  /* '확률 저장'을 누를 수 있는 때. 즉시 적용 주의는 이때만 주의색이고, 저장 전 카드풀의 잠긴 칸은 조용한 안내 하나뿐이다. */
  const saveable = Boolean(selected) && validTotal;
  const totalLabel = total === null
    ? '합계를 계산할 수 없습니다.'
    : `합계 ${Number((total / 1_000).toFixed(3))}% · ${validTotal ? '저장 가능' : '100% 필요'}`;

  return (
    <form action={action} className={SECTION_CARD}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="poolId" type="hidden" value={selected?.id ?? ''} />
      <SectionHeading description="퍼센트 합계가 정확히 100%여야 저장됩니다." title="등급별 발급 확률" />
      {!selected && <AdminNotice role="status" tone="neutral">카드풀을 먼저 저장해주세요.</AdminNotice>}
      {selected && !selected.oddsConfigured && <AdminNotice role="status" tone="warning">등급별 발급 확률이 아직 설정되지 않았습니다.</AdminNotice>}
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
        className={`text-sm font-semibold tabular-nums ${validTotal ? 'text-success' : total === 0 ? 'text-muted-foreground' : 'text-destructive'}`}
        role="status"
      >
        {totalLabel}
      </div>
      <ErrorText>{state.errors?.oddsTotal}</ErrorText>
      {selected && <AdminNotice tone={saveable ? 'warning' : 'neutral'}>변경한 구성과 확률은 저장 즉시 적용되며, 이미 발급된 미사용 카드팩도 개봉 시점의 최신 구성과 확률을 사용합니다.</AdminNotice>}
      <SaveAction disabled={!saveable} label="확률 저장" pending={pending} state={state} />
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
      <SectionHeading description="카드 화면에서 카드풀 연결을 변경합니다." title="소속 카드" />
      {!selected && <p className="text-sm text-muted-foreground">카드풀을 선택해주세요.</p>}
      {selected && !cards.length && <p className="text-sm text-muted-foreground">연결된 카드가 없습니다.</p>}
      {missingRarities.map((rarity) => (
        <AdminNotice key={rarity} role="alert" tone="danger">{rarity} 등급 카드가 없습니다.</AdminNotice>
      ))}
      {cards.length ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {cards.map((card) => (
            <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5" key={card.id}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5 font-medium break-words" title={card.archivedAt ? `[보관] ${card.name}` : undefined}>{card.name}{card.archivedAt ? <AdminStatusBadge tone={statusTone('publication', 'archived')}>보관</AdminStatusBadge> : null}</span>
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

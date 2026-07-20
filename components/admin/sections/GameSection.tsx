'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  endAdminGameAction,
  upsertAdminGameAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type {
  AdminCardPoolRecord,
  AdminEventRecord,
  AdminGameRecord,
} from '@/lib/admin/catalog.server';
import {
  ActionNotice,
  Field,
  FormShell,
  RecordList,
  SelectField,
} from '../fields';

const emptyState: AdminCatalogActionState = {};

const GAME_STATUS_LABELS: Record<AdminGameRecord['status'], string> = {
  scheduled: '운영 예정',
  active: '운영 중',
  ended: '운영 종료',
  'pool-unavailable': '카드풀 사용 불가',
};

const POOL_STATUS_LABELS: Record<AdminCardPoolRecord['status'], string> = {
  scheduled: '운영 예정',
  active: '운영 중',
  ended: '운영 종료',
};

function isEligibleGamePool(pool: AdminCardPoolRecord) {
  return pool.rewardReady && pool.status !== 'ended';
}

export function getGamePoolOptions(
  pools: AdminCardPoolRecord[],
  selected: AdminGameRecord | null,
) {
  return pools.filter((pool) => (
    isEligibleGamePool(pool) || pool.id === selected?.rewardPoolId
  ));
}

export function getGameEventOptions(events: AdminEventRecord[], ipId: string | null) {
  if (!ipId) return [];
  return events.filter((event) => event.ipId === ipId && event.mode === '온라인');
}

export function retainGameEventId(
  events: AdminEventRecord[],
  ipId: string | null,
  currentEventId: string,
) {
  if (!currentEventId) return '';
  return getGameEventOptions(events, ipId).some((event) => event.id === currentEventId)
    ? currentEventId
    : '';
}

function toKstDateTimeInput(value: string | null) {
  if (!value) return '';
  return new Date(Date.parse(value) + 9 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function formatKstDateTime(value: string | null) {
  if (!value) return '없음';
  return `${toKstDateTimeInput(value).replace('T', ' ')} KST`;
}

function variantLabel(game: AdminGameRecord) {
  if (game.variantKind === 'card') return '카드 보상형';
  if (game.variantKind === 'goods') return '굿즈 variant';
  return '지원하지 않는 variant';
}

export function GameSection({
  endOperationId,
  events,
  onSelect,
  operationId,
  pools,
  records,
  selected,
}: {
  endOperationId: string;
  events: AdminEventRecord[];
  onSelect: (game: AdminGameRecord | null) => void;
  operationId: string;
  pools: AdminCardPoolRecord[];
  records: AdminGameRecord[];
  selected: AdminGameRecord | null;
}) {
  const editable = selected === null || selected.variantKind === 'card';
  const formKey = JSON.stringify([
    selected?.id ?? 'new-game',
    selected?.updatedAt ?? null,
    operationId,
  ]);
  const canEnd = selected?.variantKind === 'card'
    && (selected.status === 'active' || selected.status === 'pool-unavailable');

  return (
    <div className="admin-master-detail">
      <RecordList
        activeId={selected?.id ?? null}
        ariaLabel="게임 목록"
        emptyMessage="등록된 게임이 없습니다."
        items={records}
        labelFor={(game) => (
          `${game.title} · ${GAME_STATUS_LABELS[game.status]}`
          + (game.variantKind === 'card' ? '' : ' · 읽기 전용')
        )}
        newLabel="새 게임 등록"
        onNew={() => onSelect(null)}
        onSelect={onSelect}
      />
      <div className="col" style={{ gap: 16 }}>
        {editable ? (
          <GameForm
            events={events}
            key={formKey}
            operationId={operationId}
            pools={pools}
            selected={selected}
          />
        ) : (
          <ReadOnlyVariantNotice selected={selected} />
        )}
        <GameSummary selected={selected} />
        {canEnd ? (
          <EndGameForm
            gameId={selected.id}
            key={`${selected.id}-${endOperationId}`}
            operationId={endOperationId}
          />
        ) : null}
      </div>
    </div>
  );
}

function GameForm({
  events,
  operationId,
  pools,
  selected,
}: {
  events: AdminEventRecord[];
  operationId: string;
  pools: AdminCardPoolRecord[];
  selected: AdminGameRecord | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminGameAction, emptyState);
  const poolOptions = getGamePoolOptions(pools, selected);
  const initialPoolId = selected?.rewardPoolId ?? poolOptions[0]?.id ?? '';
  const initialPool = pools.find((pool) => pool.id === initialPoolId) ?? null;
  const [poolId, setPoolId] = useState(initialPoolId);
  const [eventId, setEventId] = useState(
    retainGameEventId(events, initialPool?.ipId ?? null, selected?.eventId ?? ''),
  );
  const currentPool = pools.find((pool) => pool.id === poolId) ?? null;
  const eventOptions = getGameEventOptions(events, currentPool?.ipId ?? null);
  const fieldsLocked = selected?.hasPlays ?? false;
  const noEligiblePool = !poolId;
  const lockReasonId = selected ? `game-lock-reason-${selected.id}` : undefined;

  return (
    <form
      action={action}
      className="card col"
      onReset={(event) => event.preventDefault()}
      style={{ borderRadius: 10, gap: 14, padding: 18 }}
    >
      <input name="operationId" type="hidden" value={operationId} />
      <input name="previousGameId" type="hidden" value={selected?.id ?? ''} />
      <div>
        <strong>{selected ? '게임 설정' : '카드 보상형 게임 등록'}</strong>
        <p style={{ color: 'var(--dim)', fontSize: 12, margin: '6px 0 0' }}>
          마블 룰렛 · 카드 보상형 · 구슬 10개
        </p>
      </div>
      <div className="admin-form-grid">
        <Field
          defaultValue={selected?.id}
          error={state.errors?.id}
          label="slug"
          name="id"
          readOnly={fieldsLocked}
          required
        />
        <Field
          defaultValue={selected?.title}
          error={state.errors?.title}
          label="제목"
          name="title"
          required
        />
        {fieldsLocked && selected ? (
          <ReadOnlyControl
            describedBy={lockReasonId}
            label="보상 카드풀"
            name="rewardPoolId"
            value={selected.rewardPoolId ?? ''}
          >
            {selected.rewardPoolName ?? '연결된 카드풀 없음'}
          </ReadOnlyControl>
        ) : (
          <SelectField
            disabled={!poolOptions.length}
            error={state.errors?.rewardPoolId}
            label="보상 카드풀"
            name="rewardPoolId"
            onChange={(event) => {
              const nextPoolId = event.target.value;
              const nextPool = pools.find((pool) => pool.id === nextPoolId) ?? null;
              setPoolId(nextPoolId);
              setEventId((current) => retainGameEventId(events, nextPool?.ipId ?? null, current));
            }}
            required
            value={poolId}
          >
            {poolOptions.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name} · {POOL_STATUS_LABELS[pool.status]}
                {!pool.rewardReady ? ' · 발급 준비 미완료' : ''}
              </option>
            ))}
          </SelectField>
        )}
        {fieldsLocked && selected ? (
          <ReadOnlyControl
            describedBy={lockReasonId}
            label="연결 이벤트"
            name="eventId"
            value={selected.eventId ?? ''}
          >
            {selected.eventTitle ?? '연결하지 않음'}
          </ReadOnlyControl>
        ) : (
          <SelectField
            disabled={!poolId}
            error={state.errors?.eventId}
            label="연결 이벤트 (선택)"
            name="eventId"
            onChange={(event) => setEventId(event.target.value)}
            value={eventId}
          >
            <option value="">연결하지 않음</option>
            {eventOptions.map((event) => (
              <option
                disabled={Boolean(event.archivedAt && event.id !== selected?.eventId)}
                key={event.id}
                value={event.id}
              >
                {event.archivedAt ? `[보관] ${event.title}` : event.title}
              </option>
            ))}
          </SelectField>
        )}
        <Field
          defaultValue={selected?.perUserDailyLimit ?? 1}
          error={state.errors?.perUserDailyLimit}
          label="사용자별 일일 한도"
          max={100}
          min={1}
          name="perUserDailyLimit"
          required
          step={1}
          type="number"
        />
        <Field
          defaultValue={toKstDateTimeInput(selected?.activeFrom ?? null)}
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
      {fieldsLocked ? (
        <p id={lockReasonId} style={{ color: 'var(--dim)', fontSize: 12, margin: 0 }}>
          플레이 이력이 있어 slug·보상 카드풀·연결 이벤트는 변경할 수 없습니다.
        </p>
      ) : null}
      {noEligiblePool ? (
        <p role="status" style={{ color: 'var(--pink)', margin: 0 }}>
          확률과 카드 구성이 완료된 운영 예정/운영 중 카드풀을 먼저 준비해주세요.
        </p>
      ) : null}
      <FormShell disabled={noEligiblePool} pending={pending} state={state} />
    </form>
  );
}

function ReadOnlyControl({
  children,
  describedBy,
  label,
  name,
  value,
}: {
  children: React.ReactNode;
  describedBy?: string;
  label: string;
  name: string;
  value: string;
}) {
  const labelId = `${name}-${value || 'none'}-label`;

  return (
    <div className="col" style={{ gap: 7 }}>
      <span className="mono" id={labelId} style={{ color: 'var(--dim)', fontSize: 11 }}>{label}</span>
      <input name={name} type="hidden" value={value} />
      <div
        aria-describedby={describedBy}
        aria-labelledby={labelId}
        aria-readonly="true"
        className="admin-field-control"
        role="textbox"
        style={{ alignItems: 'center', display: 'flex', minHeight: 42, padding: '0 12px' }}
      >
        {children}
      </div>
    </div>
  );
}

function ReadOnlyVariantNotice({ selected }: { selected: AdminGameRecord }) {
  return (
    <section
      aria-labelledby={`game-readonly-${selected.id}`}
      className="card col"
      style={{ borderRadius: 10, gap: 12, padding: 18 }}
    >
      <strong id={`game-readonly-${selected.id}`}>{selected.title} · 읽기 전용</strong>
      <p style={{ color: 'var(--dim)', fontSize: 13, margin: 0 }}>
        {variantLabel(selected)}은 이 콘솔에서 등록하거나 편집할 수 없습니다.
      </p>
      <Link href="https://github.com/sangwopark19/icons-ip/issues/115">
        굿즈 variant 운영 범위 #115 보기
      </Link>
    </section>
  );
}

function GameSummary({ selected }: { selected: AdminGameRecord | null }) {
  return (
    <section
      aria-labelledby="game-summary-title"
      className="card col"
      style={{ borderRadius: 10, gap: 12, padding: 18 }}
    >
      <strong id="game-summary-title">게임 현황</strong>
      {selected ? (
        <div className="admin-form-grid mono" style={{ fontSize: 13 }}>
          <span>상태 {GAME_STATUS_LABELS[selected.status]}</span>
          <span>유형 {variantLabel(selected)}</span>
          <span>IP {selected.ipTitle ?? selected.ipId ?? '없음'}</span>
          <span>카드풀 {selected.rewardPoolName ?? '없음'}</span>
          <span>이벤트 {selected.eventTitle ?? '없음'}</span>
          <span>구슬 {selected.marbleCount ?? '알 수 없음'}개</span>
          <span>플레이 {selected.playCount.toLocaleString('ko-KR')}회</span>
          <span>최근 플레이 {formatKstDateTime(selected.lastPlayedAt)}</span>
        </div>
      ) : (
        <p role="status" style={{ color: 'var(--dim)', margin: 0 }}>
          게임을 선택하거나 새 카드 보상형 게임을 등록하면 운영 현황을 확인할 수 있습니다.
        </p>
      )}
    </section>
  );
}

function EndGameForm({ gameId, operationId }: { gameId: string; operationId: string }) {
  const [state, action, pending] = useActionState(endAdminGameAction, emptyState);
  const descriptionId = `end-game-description-${gameId}`;

  return (
    <form
      action={action}
      aria-labelledby={`end-game-title-${gameId}`}
      className="card col"
      onReset={(event) => event.preventDefault()}
      style={{ borderRadius: 10, gap: 12, padding: 18 }}
    >
      <input name="operationId" type="hidden" value={operationId} />
      <input name="gameId" type="hidden" value={gameId} />
      <strong id={`end-game-title-${gameId}`}>게임 종료</strong>
      <p id={descriptionId} style={{ color: 'var(--dim)', fontSize: 12, margin: 0 }}>
        삭제하지 않고 서버의 현재 시각을 운영 종료로 기록합니다.
      </p>
      <ActionNotice state={state} />
      <button
        aria-describedby={descriptionId}
        className="btn"
        disabled={pending}
        style={{ justifySelf: 'start', minWidth: 150 }}
        type="submit"
      >
        {pending ? '종료 중' : '지금 종료'}
      </button>
    </form>
  );
}

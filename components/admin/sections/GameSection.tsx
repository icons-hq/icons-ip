'use client';

import { AdminFormGrid, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
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
import { Button } from '@/components/admin/kit/ui/button';
import {
  ActionNotice,
  Field,
  FormShell,
  SelectField,
} from '../fields';
import { statusTone } from '@/lib/admin/status-tone';
import { FormGroup, MasterDetail, ReadOnlyField, RecordDetailPane, RecordFormHeading, SECTION_CARD, SECTION_FIELDS_3, SECTION_STAT, SECTION_STATS, SectionHeading } from './SectionLayout';
import { RecordMasterList } from './RecordMasterList';
import { RecordStatusLabel } from './RecordStatusLabel';

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
  if (game.variantKind === 'goods') return '굿즈 보상형';
  return '지원하지 않는 유형';
}

export function GameSection({
  creating = false,
  endOperationId,
  events,
  onClose,
  onSelect,
  operationId,
  pools,
  records,
  selected,
}: {
  /** 새 게임 입력 칸을 연 상태. 고른 게임도 없고 이 값도 꺼져 있으면 오른쪽은 안내만 보인다. */
  creating?: boolean;
  endOperationId: string;
  events: AdminEventRecord[];
  onClose?: () => void;
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
    <MasterDetail
      list={(
        <RecordMasterList
          activeId={selected?.id ?? null}
          ariaLabel="게임 목록"
          emptyMessage="등록된 게임이 없습니다."
          items={records}
          labelFor={(game) => {
            /* 읽기 전용 게임은 운영 상태보다 고칠 수 없다는 사실이 먼저다. 상태 색을 쓰지 않아 운영 중인 게임과 섞이지 않는다. */
            const readOnly = game.variantKind !== 'card';
            const status = readOnly ? '읽기 전용' : GAME_STATUS_LABELS[game.status];
            return <RecordStatusLabel detail={!readOnly && game.status === 'pool-unavailable' ? '카드풀 확인 필요 · 눌러서 보기' : null} name={game.title} status={status} tone={readOnly ? 'neutral' : statusTone('game', game.status)} title={`${game.title} · ${status}`} />;
          }}
          onSelect={onSelect}
        />
      )}
    >
      <RecordDetailPane hint="새 게임은 오른쪽 위 게임 등록 버튼으로 만듭니다." open={Boolean(selected) || creating} prompt="목록에서 게임을 고르면 여기에서 수정합니다.">
      {editable ? (
        <GameForm
          events={events}
          key={formKey}
          onClose={onClose}
          operationId={operationId}
          pools={pools}
          selected={selected}
        />
      ) : (
        <ReadOnlyVariantNotice selected={selected} />
      )}
      {selected ? <GameSummary selected={selected} /> : null}
      {canEnd ? (
        <EndGameForm
          gameId={selected.id}
          key={`${selected.id}-${endOperationId}`}
          operationId={endOperationId}
        />
      ) : null}
      </RecordDetailPane>
    </MasterDetail>
  );
}

function GameForm({
  events,
  onClose,
  operationId,
  pools,
  selected,
}: {
  events: AdminEventRecord[];
  onClose?: () => void;
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
      className={SECTION_CARD}
      onReset={(event) => event.preventDefault()}
    >
      <input name="operationId" type="hidden" value={operationId} />
      <input name="previousGameId" type="hidden" value={selected?.id ?? ''} />
      <RecordFormHeading description="마블 룰렛 · 카드 보상형 · 구슬 10개" editing={selected?.title ?? null} noun="게임" onClose={onClose} />
      {selected?.status === 'pool-unavailable' ? <AdminNotice role="status" title="연결한 카드풀을 지금 쓸 수 없습니다." tone="danger"><Link className="underline underline-offset-4" href="/admin/catalog/pools">카드풀</Link> 화면에서 운영 기간과 등급별 확률·소속 카드를 확인해주세요.</AdminNotice> : null}
      <FormGroup title="기본 정보">
      <AdminFormGrid>
        <Field
          defaultValue={selected?.id}
          error={state.errors?.id}
          label="게임 주소 이름 (영문 소문자·숫자·하이픈)"
          name="id"
          placeholder="예: maple-roulette"
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
          <ReadOnlyField
            describedBy={lockReasonId}
            label="보상 카드풀"
            labelId={`rewardPoolId-${selected.rewardPoolId || 'none'}-label`}
            name="rewardPoolId"
            value={selected.rewardPoolId ?? ''}
          >
            {selected.rewardPoolName ?? '연결된 카드풀 없음'}
          </ReadOnlyField>
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
          <ReadOnlyField
            describedBy={lockReasonId}
            label="연결 이벤트"
            labelId={`eventId-${selected.eventId || 'none'}-label`}
            name="eventId"
            value={selected.eventId ?? ''}
          >
            {selected.eventTitle ?? '연결하지 않음'}
          </ReadOnlyField>
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
      </AdminFormGrid>
      </FormGroup>
      <FormGroup title="운영 기간·한도">
        <div className={SECTION_FIELDS_3}>
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
      </FormGroup>
      {fieldsLocked ? (
        <div id={lockReasonId}><AdminNotice tone="info">플레이 이력이 있어 게임 주소 이름·보상 카드풀·연결 이벤트는 변경할 수 없습니다.</AdminNotice></div>
      ) : null}
      {noEligiblePool ? <AdminNotice role="status" tone="warning">확률과 카드 구성이 완료된 운영 예정/운영 중 카드풀을 먼저 준비해주세요.</AdminNotice> : null}
      <FormShell disabled={noEligiblePool} pending={pending} state={state} />
    </form>
  );
}

function ReadOnlyVariantNotice({ selected }: { selected: AdminGameRecord }) {
  return (
    <section
      aria-labelledby={`game-readonly-${selected.id}`}
      className={SECTION_CARD}
    >
      <SectionHeading id={`game-readonly-${selected.id}`} title={`${selected.title} · 읽기 전용`} />
      <p className="text-sm text-muted-foreground">
        {variantLabel(selected)}은 이 콘솔에서 등록하거나 편집할 수 없습니다.
      </p>
      <p className="text-sm text-muted-foreground">
        이전 굿즈 보상형 게임은 현 로드맵에서 활성화하지 않으며 신규 실물 쿠지에 재사용하지 않습니다.
      </p>
    </section>
  );
}

function GameSummary({ selected }: { selected: AdminGameRecord }) {
  return (
    <section
      aria-labelledby="game-summary-title"
      className={SECTION_CARD}
    >
      <SectionHeading id="game-summary-title" title="게임 현황" />
      <ul className={SECTION_STATS} data-admin-summary="game">
        <li className={`${SECTION_STAT} flex items-center gap-2`}>상태 <AdminStatusBadge tone={statusTone('game', selected.status)}>{GAME_STATUS_LABELS[selected.status]}</AdminStatusBadge></li>
        <li className={SECTION_STAT}>유형 {variantLabel(selected)}</li>
        <li className={SECTION_STAT}>IP {selected.ipTitle ?? selected.ipId ?? '없음'}</li>
        <li className={SECTION_STAT}>카드풀 {selected.rewardPoolName ?? '없음'}</li>
        <li className={SECTION_STAT}>이벤트 {selected.eventTitle ?? '없음'}</li>
        <li className={SECTION_STAT}>구슬 {selected.marbleCount ?? '알 수 없음'}개</li>
        <li className={SECTION_STAT}>플레이 {selected.playCount.toLocaleString('ko-KR')}회</li>
        <li className={SECTION_STAT}>최근 플레이 {formatKstDateTime(selected.lastPlayedAt)}</li>
      </ul>
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
      className={SECTION_CARD}
      onReset={(event) => event.preventDefault()}
    >
      <input name="operationId" type="hidden" value={operationId} />
      <input name="gameId" type="hidden" value={gameId} />
      <header className="flex flex-col gap-1">
        <h3 className="text-base leading-snug font-medium text-foreground" id={`end-game-title-${gameId}`}>게임 종료</h3>
        <p className="text-sm text-muted-foreground" id={descriptionId}>
          삭제하지 않고 서버의 현재 시각을 운영 종료로 기록합니다.
        </p>
      </header>
      <ActionNotice state={state} />
      <Button
        aria-describedby={descriptionId}
        className="min-w-36 self-start"
        disabled={pending}
        type="submit"
        variant="destructive"
      >
        {pending ? '종료 중' : '지금 종료'}
      </Button>
    </form>
  );
}

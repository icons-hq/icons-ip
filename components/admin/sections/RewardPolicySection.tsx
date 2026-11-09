'use client';

import { AdminFormGrid, AdminNotice } from '@/components/admin/console/AdminKit';
import { useActionState, useMemo, useState } from 'react';
import {
  upsertAdminRewardPolicyAction,
  type AdminCatalogActionState,
} from '@/app/admin/actions';
import type {
  AdminCardPoolRecord,
  AdminGoodRecord,
  AdminRewardPolicyRecord,
} from '@/lib/admin/catalog.server';
import { ErrorText, Field, FormShell, SelectField } from '../fields';
import { statusTone } from '@/lib/admin/status-tone';
import { FormGroup, MasterDetail, RecordDetailPane, RecordFormHeading, SECTION_CARD, SECTION_STAT, SECTION_STATS, SectionHeading } from './SectionLayout';
import { RecordMasterList } from './RecordMasterList';
import { RecordStatusLabel } from './RecordStatusLabel';

const emptyState: AdminCatalogActionState = {};

const POLICY_STATUS_LABELS: Record<AdminRewardPolicyRecord['status'], string> = {
  inactive: '비활성',
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

function isEligibleRewardPool(pool: AdminCardPoolRecord | undefined) {
  return Boolean(pool && pool.status !== 'ended' && pool.rewardReady);
}

export function getRewardPolicyPoolOptions(
  pools: AdminCardPoolRecord[],
  selected: AdminRewardPolicyRecord | null,
) {
  return pools.filter((pool) => isEligibleRewardPool(pool) || pool.id === selected?.poolId);
}

export function retainRewardPolicyGoodId(
  goods: AdminGoodRecord[],
  targetIpId: string,
  currentGoodId: string,
) {
  if (!currentGoodId) return '';
  return goods.some((good) => good.id === currentGoodId && good.ipId === targetIpId)
    ? currentGoodId
    : '';
}

export function getRewardPolicyFormKey(
  selected: AdminRewardPolicyRecord | null,
  draftId: string,
  operationId: string,
) {
  return JSON.stringify([selected?.id ?? draftId, selected?.updatedAt ?? null, operationId]);
}

function toKstDateTimeInput(value: string | null) {
  if (!value) return '';
  return new Date(Date.parse(value) + 9 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

function formatKstDateTime(value: string | null) {
  if (!value) return '없음';
  return `${toKstDateTimeInput(value).replace('T', ' ')} KST`;
}

export function RewardPolicySection({
  creating = false,
  draftActiveFrom,
  draftId,
  goods,
  ipOptions,
  onClose,
  onSelect,
  operationId,
  pools,
  records,
  selected,
}: {
  /** 새 정책 입력 칸을 연 상태. 고른 정책도 없고 이 값도 꺼져 있으면 오른쪽은 안내만 보인다. */
  creating?: boolean;
  draftActiveFrom: string;
  draftId: string;
  goods: AdminGoodRecord[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  onClose?: () => void;
  onSelect: (policy: AdminRewardPolicyRecord | null) => void;
  operationId: string;
  pools: AdminCardPoolRecord[];
  records: AdminRewardPolicyRecord[];
  selected: AdminRewardPolicyRecord | null;
}) {
  const ipTitles = useMemo(
    () => new Map(ipOptions.map((ip) => [ip.id, ip.title])),
    [ipOptions],
  );
  const goodNames = useMemo(
    () => new Map(goods.map((good) => [good.id, good.name])),
    [goods],
  );
  const poolNames = useMemo(
    () => new Map(pools.map((pool) => [pool.id, pool.name])),
    [pools],
  );
  const policyName = (policy: AdminRewardPolicyRecord) => {
    const target = policy.targetGoodId
      ? (goodNames.get(policy.targetGoodId) ?? policy.targetGoodId)
      : `${ipTitles.get(policy.targetIpId) ?? policy.targetIpId} 전체 상품`;
    return `${target} → ${poolNames.get(policy.poolId) ?? policy.poolId}`;
  };

  return (
    <MasterDetail
      list={(
        <RecordMasterList
          activeId={selected?.id ?? null}
          ariaLabel="발급 정책 목록"
          emptyMessage="등록된 발급 정책이 없습니다."
          items={records}
          labelFor={(policy) => <RecordStatusLabel detail={policy.status === 'pool-unavailable' ? '카드풀 확인 필요 · 눌러서 보기' : null} name={policyName(policy)} status={POLICY_STATUS_LABELS[policy.status]} tone={statusTone('rewardPolicy', policy.status)} title={`${policyName(policy)} · ${POLICY_STATUS_LABELS[policy.status]}`} />}
          onSelect={onSelect}
        />
      )}
    >
      <RecordDetailPane hint="새 정책은 오른쪽 위 발급 정책 등록 버튼으로 만듭니다." open={Boolean(selected) || creating} prompt="목록에서 발급 정책을 고르면 여기에서 수정합니다.">
      <RewardPolicyForm
        draftActiveFrom={draftActiveFrom}
        draftId={draftId}
        editing={selected ? policyName(selected) : null}
        goods={goods}
        ipOptions={ipOptions}
        ipTitles={ipTitles}
        key={getRewardPolicyFormKey(selected, draftId, operationId)}
        onClose={onClose}
        operationId={operationId}
        pools={pools}
        selected={selected}
      />
      {selected ? <RewardPolicySummary selected={selected} /> : null}
      </RecordDetailPane>
    </MasterDetail>
  );
}

function RewardPolicyForm({
  draftActiveFrom,
  draftId,
  editing,
  goods,
  ipOptions,
  ipTitles,
  onClose,
  operationId,
  pools,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  editing: string | null;
  goods: AdminGoodRecord[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  ipTitles: Map<string, string>;
  onClose?: () => void;
  operationId: string;
  pools: AdminCardPoolRecord[];
  selected: AdminRewardPolicyRecord | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminRewardPolicyAction, emptyState);
  const poolOptions = useMemo(
    () => getRewardPolicyPoolOptions(pools, selected),
    [pools, selected],
  );
  /* 새 정책은 대상 IP·카드풀을 미리 고르지 않는다 — 서로 안 맞는 첫 항목이 그대로 저장되는 사고를 막는다. */
  const [targetIpId, setTargetIpId] = useState(selected?.targetIpId ?? '');
  const [targetGoodId, setTargetGoodId] = useState(selected?.targetGoodId ?? '');
  const [poolId, setPoolId] = useState(selected?.poolId ?? '');
  const [active, setActive] = useState(selected?.active ?? false);
  const targetGoods = useMemo(
    () => goods.filter((good) => good.ipId === targetIpId),
    [goods, targetIpId],
  );
  const currentPool = pools.find((pool) => pool.id === poolId);
  const noIps = !ipOptions.some((ip) => !ip.archivedAt || ip.id === selected?.targetIpId);
  const noPool = !poolId && !poolOptions.length;
  const unavailableActivePool = active && Boolean(poolId) && !isEligibleRewardPool(currentPool);
  /* 카드풀은 IP와 무관하게 고를 수 있어 다른 IP의 풀을 일부러 쓸 수도 있다. 막지 않고 실제로 어긋났을 때만 알린다. */
  const poolIpMismatch = Boolean(targetIpId && currentPool && currentPool.ipId !== targetIpId);
  const orderedPoolOptions = [...poolOptions].sort((left, right) => Number(right.ipId === targetIpId) - Number(left.ipId === targetIpId));
  const disabledReason = noIps
    ? '먼저 IP를 등록해주세요.'
    : noPool
      ? '확률과 카드 구성이 완료된 운영 예정/운영 중 카드풀을 먼저 준비해주세요.'
      : unavailableActivePool
        ? '현재 카드풀을 사용할 수 없습니다. 정책을 비활성화한 뒤 저장해주세요.'
        : null;

  return (
    <form
      action={action}
      className={SECTION_CARD}
      onReset={(event) => event.preventDefault()}
    >
      <input name="operationId" type="hidden" value={operationId} />
      <input name="id" type="hidden" value={selected?.id ?? draftId} />
      <input name="trigger" type="hidden" value="order_paid" />
      <RecordFormHeading description="결제 완료된 주문이 아래 조건을 충족하면 카드팩을 발급합니다." editing={editing} noun="발급 정책" onClose={onClose} />
      <FormGroup title="대상과 발급 내용">
      <AdminFormGrid>
        <SelectField
          disabled={noIps}
          error={state.errors?.targetIpId}
          label="대상 IP"
          name="targetIpId"
          onChange={(event) => {
            const nextIpId = event.target.value;
            setTargetIpId(nextIpId);
            setTargetGoodId((current) => retainRewardPolicyGoodId(goods, nextIpId, current));
          }}
          required
          value={targetIpId}
        >
          <option value="">선택</option>
          {ipOptions.map((ip) => (
            <option
              disabled={Boolean(ip.archivedAt && ip.id !== selected?.targetIpId)}
              key={ip.id}
              value={ip.id}
            >
              {ip.archivedAt ? `[보관] ${ip.title}` : ip.title}
            </option>
          ))}
        </SelectField>
        <SelectField
          disabled={!targetIpId}
          error={state.errors?.targetGoodId}
          label="대상 상품"
          name="targetGoodId"
          onChange={(event) => setTargetGoodId(event.target.value)}
          value={targetGoodId}
        >
          <option value="">전체 상품(IP 결제 합계)</option>
          {targetGoods.map((good) => (
            <option
              disabled={Boolean(good.archivedAt && good.id !== selected?.targetGoodId)}
              key={good.id}
              value={good.id}
            >
              {good.archivedAt ? `[보관] ${good.name}` : good.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          disabled={!poolOptions.length}
          error={state.errors?.poolId}
          label="발급 카드풀"
          name="poolId"
          onChange={(event) => setPoolId(event.target.value)}
          required
          value={poolId}
        >
          <option value="">선택</option>
          {orderedPoolOptions.map((pool) => (
            <option key={pool.id} value={pool.id}>
              {pool.name} · {POOL_STATUS_LABELS[pool.status]}
              {!pool.rewardReady ? ' · 발급 준비 미완료' : ''}
            </option>
          ))}
        </SelectField>
        <Field
          defaultValue={selected?.ticketsPerGrant ?? 1}
          error={state.errors?.ticketsPerGrant}
          label="발급 카드팩 수"
          max={100}
          min={1}
          name="ticketsPerGrant"
          required
          step={1}
          type="number"
        />
      </AdminFormGrid>
      {poolIpMismatch ? <AdminNotice role="status" tone="warning">대상 IP({ipTitles.get(targetIpId) ?? targetIpId})와 다른 IP의 카드풀입니다. 저장 전에 맞는지 확인해주세요.</AdminNotice> : null}
      </FormGroup>
      <FormGroup title="운영 조건">
      <AdminFormGrid>
        <Field
          defaultValue={selected?.minAmount ?? 0}
          error={state.errors?.minAmount}
          label="최소 결제 금액"
          min={0}
          name="minAmount"
          required
          step={1}
          type="number"
        />
        <label className="flex h-8 w-fit items-center gap-2 self-end text-sm font-medium">
          <input
            aria-describedby={state.errors?.active ? 'active-error' : undefined}
            aria-invalid={Boolean(state.errors?.active)}
            checked={active}
            name="active"
            onChange={(event) => setActive(event.target.checked)}
            type="checkbox"
          />
          <span>정책 활성화</span>
        </label>
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
      </AdminFormGrid>
      <ErrorText id={state.errors?.active ? 'active-error' : undefined}>{state.errors?.active}</ErrorText>
      {active ? <AdminNotice role="status" tone="warning">조건이 겹치는 활성 정책은 누적 적용됩니다.</AdminNotice> : null}
      </FormGroup>
      {disabledReason && <AdminNotice role={unavailableActivePool ? 'alert' : 'status'} tone={unavailableActivePool ? 'danger' : 'warning'}>{disabledReason}</AdminNotice>}
      <FormShell disabled={Boolean(disabledReason)} pending={pending} state={state} />
    </form>
  );
}

function RewardPolicySummary({ selected }: { selected: AdminRewardPolicyRecord }) {
  return (
    <section aria-labelledby="reward-policy-summary-title" className={SECTION_CARD}>
      <SectionHeading description="정책 연결 정보가 없는 기존 뽑기권은 집계에서 제외됩니다." id="reward-policy-summary-title" title="발급 현황" />
      <ul className={SECTION_STATS} data-admin-summary="reward-policy">
        <li className={SECTION_STAT}>발급 {selected.issuedCount.toLocaleString('ko-KR')}</li>
        <li className={SECTION_STAT}>사용 가능 {selected.availableCount.toLocaleString('ko-KR')}</li>
        <li className={SECTION_STAT}>개봉 {selected.openedCount.toLocaleString('ko-KR')}</li>
        <li className={SECTION_STAT}>회수 {selected.revokedCount.toLocaleString('ko-KR')}</li>
        <li className={SECTION_STAT}>주문 {selected.orderCount.toLocaleString('ko-KR')}</li>
        <li className={SECTION_STAT}>최근 발급 {formatKstDateTime(selected.lastIssuedAt)}</li>
      </ul>
    </section>
  );
}

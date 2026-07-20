'use client';

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
import { ErrorText, Field, FormShell, RecordList, SelectField } from '../fields';

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
  draftActiveFrom,
  draftId,
  goods,
  ipOptions,
  onSelect,
  operationId,
  pools,
  records,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  goods: AdminGoodRecord[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
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

  return (
    <div className="admin-master-detail">
      <RecordList
        activeId={selected?.id ?? null}
        ariaLabel="발급 정책 목록"
        emptyMessage="등록된 발급 정책이 없습니다."
        items={records}
        labelFor={(policy) => {
          const target = policy.targetGoodId
            ? (goodNames.get(policy.targetGoodId) ?? policy.targetGoodId)
            : `${ipTitles.get(policy.targetIpId) ?? policy.targetIpId} 전체 굿즈`;
          const pool = poolNames.get(policy.poolId) ?? policy.poolId;
          return `${target} → ${pool} · ${POLICY_STATUS_LABELS[policy.status]}`;
        }}
        newLabel="새 발급 정책"
        onNew={() => onSelect(null)}
        onSelect={onSelect}
      />
      <div className="col" style={{ gap: 16 }}>
        <RewardPolicyForm
          draftActiveFrom={draftActiveFrom}
          draftId={draftId}
          goods={goods}
          ipOptions={ipOptions}
          key={getRewardPolicyFormKey(selected, draftId, operationId)}
          operationId={operationId}
          pools={pools}
          selected={selected}
        />
        <RewardPolicySummary selected={selected} />
      </div>
    </div>
  );
}

function RewardPolicyForm({
  draftActiveFrom,
  draftId,
  goods,
  ipOptions,
  operationId,
  pools,
  selected,
}: {
  draftActiveFrom: string;
  draftId: string;
  goods: AdminGoodRecord[];
  ipOptions: { id: string; title: string; archivedAt: string | null }[];
  operationId: string;
  pools: AdminCardPoolRecord[];
  selected: AdminRewardPolicyRecord | null;
}) {
  const [state, action, pending] = useActionState(upsertAdminRewardPolicyAction, emptyState);
  const poolOptions = useMemo(
    () => getRewardPolicyPoolOptions(pools, selected),
    [pools, selected],
  );
  const [targetIpId, setTargetIpId] = useState(
    selected?.targetIpId ?? ipOptions.find((ip) => !ip.archivedAt)?.id ?? '',
  );
  const [targetGoodId, setTargetGoodId] = useState(selected?.targetGoodId ?? '');
  const [poolId, setPoolId] = useState(selected?.poolId ?? poolOptions[0]?.id ?? '');
  const [active, setActive] = useState(selected?.active ?? false);
  const targetGoods = useMemo(
    () => goods.filter((good) => good.ipId === targetIpId),
    [goods, targetIpId],
  );
  const currentPool = pools.find((pool) => pool.id === poolId);
  const noIps = !ipOptions.some((ip) => !ip.archivedAt || ip.id === selected?.targetIpId);
  const noPool = !poolId;
  const unavailableActivePool = active && !isEligibleRewardPool(currentPool);
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
      className="card col"
      onReset={(event) => event.preventDefault()}
      style={{ borderRadius: 10, gap: 14, padding: 18 }}
    >
      <input name="operationId" type="hidden" value={operationId} />
      <input name="id" type="hidden" value={selected?.id ?? draftId} />
      <input name="trigger" type="hidden" value="order_paid" />
      <div>
        <strong>주문 결제 완료 발급</strong>
        <p style={{ color: 'var(--dim)', fontSize: 12, margin: '6px 0 0' }}>
          결제 완료된 주문이 아래 조건을 충족하면 카드팩을 발급합니다.
        </p>
      </div>
      <div className="admin-form-grid">
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
          label="대상 굿즈"
          name="targetGoodId"
          onChange={(event) => setTargetGoodId(event.target.value)}
          value={targetGoodId}
        >
          <option value="">전체 굿즈(IP 결제 합계)</option>
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
          {poolOptions.map((pool) => (
            <option key={pool.id} value={pool.id}>
              {pool.name} · {POOL_STATUS_LABELS[pool.status]}
              {!pool.rewardReady ? ' · 발급 준비 미완료' : ''}
            </option>
          ))}
        </SelectField>
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
      <label className="row" style={{ alignItems: 'center', gap: 8 }}>
        <input
          aria-describedby={state.errors?.active ? 'active-error' : undefined}
          aria-invalid={Boolean(state.errors?.active)}
          checked={active}
          name="active"
          onChange={(event) => setActive(event.target.checked)}
          type="checkbox"
        />
        <span style={{ fontSize: 13, fontWeight: 700 }}>정책 활성화</span>
      </label>
      <ErrorText id={state.errors?.active ? 'active-error' : undefined}>{state.errors?.active}</ErrorText>
      {disabledReason && (
        <p role={unavailableActivePool ? 'alert' : 'status'} style={{ color: 'var(--pink)', margin: 0 }}>
          {disabledReason}
        </p>
      )}
      <FormShell disabled={Boolean(disabledReason)} pending={pending} state={state} />
    </form>
  );
}

function RewardPolicySummary({ selected }: { selected: AdminRewardPolicyRecord | null }) {
  return (
    <section aria-labelledby="reward-policy-summary-title" className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <strong id="reward-policy-summary-title">발급 현황</strong>
      {selected ? (
        <div className="admin-form-grid mono" style={{ fontSize: 13 }}>
          <span>발급 {selected.issuedCount.toLocaleString('ko-KR')}</span>
          <span>사용 가능 {selected.availableCount.toLocaleString('ko-KR')}</span>
          <span>개봉 {selected.openedCount.toLocaleString('ko-KR')}</span>
          <span>회수 {selected.revokedCount.toLocaleString('ko-KR')}</span>
          <span>주문 {selected.orderCount.toLocaleString('ko-KR')}</span>
          <span>최근 발급 {formatKstDateTime(selected.lastIssuedAt)}</span>
        </div>
      ) : (
        <p role="status" style={{ color: 'var(--dim)', margin: 0 }}>
          정책을 선택하거나 새 정책을 저장하면 발급 현황을 확인할 수 있습니다.
        </p>
      )}
      <div className="card" role="status" style={{ color: 'var(--dim)', fontSize: 12, lineHeight: 1.6, padding: 12 }}>
        조건이 겹치는 활성 정책은 누적 적용됩니다.
      </div>
      <div className="card" role="status" style={{ color: 'var(--dim)', fontSize: 12, lineHeight: 1.6, padding: 12 }}>
        정책 연결 정보가 없는 기존 뽑기권은 집계에서 제외됩니다.
      </div>
    </section>
  );
}

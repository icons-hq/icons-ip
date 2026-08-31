'use client';

import { useActionState, useState } from 'react';
import {
  upsertAdminCoinExchangeOfferAction,
  type AdminCampaignActionState,
} from '@/app/admin/campaign-actions';
import {
  ADMIN_COIN_OFFER_STATUS_LABELS,
  ADMIN_COIN_OFFER_STATUSES,
  type AdminCoinExchangeOfferRecord,
} from '@/lib/admin/campaigns';
import type { AdminCardPoolRecord } from '@/lib/admin/catalog.server';
import { Icon } from '@/components/ui/Icon';
import { Field, InlineNotice, SelectField } from '../fields';

/*
 * 카드팩 교환처 패널 (S8 #330).
 *
 * 캠페인 폼과 같은 화면에 있지만 폼은 따로다(회원 등급 패널과 같은 두-폼 관례).
 * 하나의 폼에 두 저장 버튼을 두면 브라우저 기본 제출이 어느 쪽으로 갈지 마크업
 * 순서에 좌우된다 — 캠페인을 쓰다 엔터를 눌러 교환처가 저장되는 사고를 마크업
 * 순서에 맡길 수 없다.
 *
 * 어휘는 "카드팩"이다. 코인은 출석으로만 늘고 카드팩 교환으로만 줄어드는 무상
 * 참여 재화이며 결제 수단이 아니다(ADR-0003·ADR-0004).
 */

const emptyState: AdminCampaignActionState = {};

function poolLabel(pool: AdminCardPoolRecord) {
  const readiness = pool.rewardReady ? '' : ' · 개봉 준비 안 됨';
  return `${pool.name} (${pool.ipId})${readiness}`;
}

function OfferRow({
  active,
  offer,
  onSelect,
  pool,
}: {
  active: boolean;
  offer: AdminCoinExchangeOfferRecord;
  onSelect: () => void;
  pool: AdminCardPoolRecord | undefined;
}) {
  return (
    <li className="admin-campaign-offer">
      <button
        aria-current={active ? 'true' : undefined}
        className={active ? 'chip on' : 'chip'}
        onClick={onSelect}
        style={{ justifyContent: 'flex-start', minHeight: 36, textAlign: 'left', width: '100%' }}
        type="button"
      >
        <span className="col" style={{ gap: 3, minWidth: 0 }}>
          <strong style={{ fontSize: 13 }}>{offer.label}</strong>
          <span className="faint mono" style={{ fontSize: 11 }}>
            {pool ? pool.name : '삭제된 카드풀'}
            {' · '}코인 {offer.coinCost.toLocaleString('ko-KR')}
            {' · '}카드팩 {offer.ticketCount}장
            {' · '}{ADMIN_COIN_OFFER_STATUS_LABELS[offer.status]}
            {pool && !pool.rewardReady ? ' · 개봉 준비 안 됨' : ''}
          </span>
        </span>
      </button>
      {/* 캠페인 sections 의 exchange 블록이 이 id 를 그대로 받는다. */}
      <code className="admin-campaign-offer-id">{offer.id}</code>
    </li>
  );
}

export function CoinExchangeOfferPanel({
  offers,
  pools,
}: {
  offers: AdminCoinExchangeOfferRecord[];
  pools: AdminCardPoolRecord[];
}) {
  const [state, action, pending] = useActionState(upsertAdminCoinExchangeOfferAction, emptyState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = offers.find((offer) => offer.id === selectedId) ?? null;
  const poolsById = new Map(pools.map((pool) => [pool.id, pool]));

  return (
    <section className="card col admin-campaign-panel" style={{ borderRadius: 10, gap: 14, padding: 16 }}>
      <div className="col" style={{ gap: 5 }}>
        <strong style={{ fontSize: 15 }}>카드팩 교환처</strong>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.7, margin: 0 }}>
          출석으로 모은 코인을 카드팩으로 바꾸는 자리입니다. 등록한 뒤 목록의 ID를 복사해
          캠페인 랜딩 구성의 <code>exchange</code> 블록 <code>offer_id</code>에 넣으면 상세에 붙습니다.
          카드풀 확률이 채워지지 않으면 교환 시점에 실패하므로 <strong>개봉 준비 안 됨</strong> 표시가
          붙은 풀은 그대로 두지 마세요.
        </p>
      </div>

      <ul className="admin-campaign-offers">
        {offers.length === 0 && (
          <li className="muted" style={{ fontSize: 13 }}>등록된 교환처가 없습니다.</li>
        )}
        {offers.map((offer) => (
          <OfferRow
            active={offer.id === selectedId}
            key={offer.id}
            offer={offer}
            onSelect={() => setSelectedId(offer.id === selectedId ? null : offer.id)}
            pool={poolsById.get(offer.poolId)}
          />
        ))}
      </ul>

      <form action={action} className="col" key={selected ? `${selected.id}:${selected.updatedAt}` : 'new-offer'} style={{ gap: 12 }}>
        <input name="offerId" type="hidden" value={selected?.id ?? ''} />
        <div className="admin-form-grid">
          <SelectField
            defaultValue={selected?.poolId ?? pools[0]?.id ?? ''}
            error={state.errors?.poolId}
            label="카드풀"
            name="poolId"
            required
          >
            {pools.length === 0 && <option value="">등록된 카드풀이 없습니다</option>}
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>{poolLabel(pool)}</option>
            ))}
          </SelectField>
          <Field
            defaultValue={selected?.label ?? ''}
            error={state.errors?.label}
            label="교환처 이름 (사용자에게 보이는 문구)"
            name="label"
            placeholder="가을 카드팩 1장"
            required
          />
          <Field
            defaultValue={selected?.coinCost ?? ''}
            error={state.errors?.coinCost}
            label="코인 비용"
            max={100000}
            min={1}
            name="coinCost"
            required
            step={1}
            type="number"
          />
          <Field
            defaultValue={selected?.ticketCount ?? 1}
            error={state.errors?.ticketCount}
            label="지급 카드팩 수 (1~10장)"
            max={10}
            min={1}
            name="ticketCount"
            required
            step={1}
            type="number"
          />
          <SelectField
            defaultValue={selected?.status ?? 'active'}
            error={state.errors?.status}
            label="노출 상태"
            name="status"
          >
            {ADMIN_COIN_OFFER_STATUSES.map((status) => (
              <option key={status} value={status}>{ADMIN_COIN_OFFER_STATUS_LABELS[status]}</option>
            ))}
          </SelectField>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
          <button className="btn btn-sm admin-field-control" disabled={pending} style={{ minHeight: 40 }}>
            <Icon name="check" size={14} /> {pending ? '저장 중' : selected ? '교환처 수정' : '교환처 등록'}
          </button>
          {selected && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setSelectedId(null)}
              style={{ minHeight: 40 }}
              type="button"
            >
              새 교환처
            </button>
          )}
          <InlineNotice state={state} />
        </div>
      </form>
    </section>
  );
}

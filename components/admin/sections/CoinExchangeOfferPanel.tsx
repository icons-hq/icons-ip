'use client';

import { AdminFormGrid, AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
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
import { Check } from 'lucide-react';
import { Button } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
import { Field, InlineNotice, SelectField } from '../fields';
import { SECTION_CARD, SectionHeading } from './SectionLayout';

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

/** '구성 코드' 칸이 받는 형식 그대로 복사한다. 이미 다른 구성이 있으면 그 목록 안에 항목으로 넣는다. */
function CopyExchangeBlockButton({ offerId }: { offerId: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy() {
    void navigator.clipboard?.writeText(JSON.stringify([{ type: 'exchange', offer_id: offerId }])).then(() => setCopied(offerId));
  }
  return <Button onClick={copy} size="xs" title="캠페인 '구성 코드' 칸에 붙여 넣는 형식입니다. 이미 다른 구성이 있으면 그 목록 안에 항목으로 넣어주세요." type="button" variant="outline">{copied ? '복사했습니다' : '구성 코드 복사'}</Button>;
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
    <li className="flex min-w-0 flex-col gap-1">
      <Button
        aria-current={active ? 'true' : undefined}
        className="h-auto w-full justify-start py-2 text-left whitespace-normal aria-[current=true]:border-primary aria-[current=true]:bg-primary-soft"
        onClick={onSelect}
        type="button"
        variant="outline"
      >
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{offer.label}</span>
            <AdminStatusBadge tone={statusTone('coinOffer', offer.status)}>{ADMIN_COIN_OFFER_STATUS_LABELS[offer.status]}</AdminStatusBadge>
            {pool && !pool.rewardReady ? <AdminStatusBadge tone="danger">개봉 준비 안 됨</AdminStatusBadge> : null}
          </span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {pool ? pool.name : '삭제된 카드풀'}
            {' · '}코인 {offer.coinCost.toLocaleString('ko-KR')}
            {' · '}카드팩 {offer.ticketCount}장
          </span>
        </span>
      </Button>
      {/* 캠페인 sections 의 exchange 블록이 이 id 를 그대로 받는다. 손으로 옮겨 적지 않게 블록 째 복사한다. */}
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="overflow-x-auto px-0.5 font-mono text-xs text-muted-foreground select-all" data-coin-offer-id="">{offer.id}</code>
        <CopyExchangeBlockButton offerId={offer.id} />
      </span>
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
    <section className={SECTION_CARD}>
      <SectionHeading
        description="출석으로 모은 코인을 카드팩으로 바꾸는 자리입니다. 아래에서 교환처를 등록하고 목록의 [구성 코드 복사]를 누른 뒤, 캠페인 수정의 '이미지·랜딩 구성 > 구성 코드' 칸에 붙여 넣으면 그 캠페인 상세에 나타납니다."
        title="카드팩 교환처"
      />

      {/* 주의는 등록된 교환처가 실제로 준비 안 된 풀을 쓸 때만 상자로 말한다(처리할 대상 없는 경고를 띄우지 않는다). */}
      {offers.some((offer) => poolsById.get(offer.poolId)?.rewardReady === false) ? (
        <AdminNotice title="개봉 준비 안 됨 표시가 붙은 교환처가 있습니다" tone="warning">
          카드풀 확률이 채워지지 않으면 고객이 교환할 때 실패합니다. 확률을 채우거나 그 교환처를 내려주세요.
        </AdminNotice>
      ) : null}

      <ul className="flex flex-col gap-3">
        {offers.length === 0 && (
          <li className="text-sm text-muted-foreground">등록된 교환처가 없습니다.</li>
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

      <form action={action} className="flex flex-col gap-4 border-t pt-4" key={selected ? `${selected.id}:${selected.updatedAt}` : 'new-offer'}>
        <input name="offerId" type="hidden" value={selected?.id ?? ''} />
        <AdminFormGrid>
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
            label="교환처 이름 (고객에게 보이는 문구)"
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
        </AdminFormGrid>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending} type="submit">
            <Check aria-hidden="true" /> {pending ? '저장 중' : selected ? '교환처 수정' : '교환처 등록'}
          </Button>
          {selected && (
            <Button
              onClick={() => setSelectedId(null)}
              type="button"
              variant="outline"
            >
              새 교환처
            </Button>
          )}
          <InlineNotice state={state} />
        </div>
      </form>
    </section>
  );
}

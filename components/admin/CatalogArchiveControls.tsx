'use client';

import { useActionState } from 'react';
import {
  archiveAdminCatalogRecordAction,
  setGoodBankTransferAction,
  unarchiveAdminCatalogRecordAction,
  type AdminCatalogArchiveActionState,
  type AdminCatalogArchiveKind,
  type AdminGoodBankTransferActionState,
} from '../../app/admin/archive-actions';
import type { AdminCatalogArchiveFilter as ArchiveFilter } from '../../lib/admin/catalog-archive';

const initialState: AdminCatalogArchiveActionState = {};

const ARCHIVE_WARNINGS: Record<AdminCatalogArchiveKind, string> = {
  ip: '운영 중인 하위 카탈로그나 카드풀·정책·게임이 남아 있으면 보관할 수 없습니다.',
  good: '판매 재고나 활성 발급 정책이 남아 있으면 보관할 수 없습니다.',
  card: '예정·운영 중인 카드풀이나 미개봉 카드팩이 남아 있으면 보관할 수 없습니다.',
  event: '예정·운영 중인 티켓 회차나 게임이 남아 있으면 보관할 수 없습니다.',
};

export function CatalogArchiveFilter({
  counts,
  filter,
  onChange,
}: {
  counts: Record<ArchiveFilter, number>;
  filter: ArchiveFilter;
  onChange: (filter: ArchiveFilter) => void;
}) {
  return (
    <label className="col" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>보관 상태</span>
      <select
        aria-label="보관 상태"
        className="admin-field-control"
        onChange={(event) => onChange(event.target.value as ArchiveFilter)}
        value={filter}
        style={{
          background: 'rgba(255,255,255,.045)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 13,
          minHeight: 40,
          padding: '0 10px',
          width: '100%',
        }}
      >
        <option value="active">운영 중 {counts.active}</option>
        <option value="archived">보관됨 {counts.archived}</option>
        <option value="all">전체 {counts.all}</option>
      </select>
    </label>
  );
}

export function CatalogArchiveControl({
  archivedAt,
  id,
  kind,
}: {
  archivedAt: string | null;
  id: string;
  kind: AdminCatalogArchiveKind;
}) {
  const archived = Boolean(archivedAt);
  const action = archived
    ? unarchiveAdminCatalogRecordAction
    : archiveAdminCatalogRecordAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div>
        <span className="eyebrow">CATALOG VISIBILITY</span>
        <h2 style={{ fontSize: 18, margin: '6px 0 0' }}>{archived ? '보관 복원' : '카탈로그 보관'}</h2>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        {archived
          ? '보관된 항목을 공개 카탈로그로 복원합니다.'
          : ARCHIVE_WARNINGS[kind]}
      </p>
      {state.errors?.form && (
        <div className="card" role="alert" style={{ color: 'var(--pink)', padding: 12 }}>
          {state.errors.form}
        </div>
      )}
      {state.message && (
        <div className="card" role="status" style={{ color: 'var(--mint)', padding: 12 }}>
          {state.message}
        </div>
      )}
      <form action={formAction}>
        <input name="kind" readOnly type="hidden" value={kind} />
        <input name="id" readOnly type="hidden" value={id} />
        <button className={archived ? 'btn btn-holo' : 'btn btn-ghost'} disabled={pending}>
          {pending ? '처리 중' : archived ? '복원' : '보관'}
        </button>
      </form>
    </section>
  );
}

const bankTransferInitialState: AdminGoodBankTransferActionState = {};

/**
 * 굿즈 무통장 토글 (#256).
 *
 * 재고를 24시간 묶어도 되는 굿즈인지에 대한 운영 판단이다. 상품 정보 수정과
 * 분리해 두는 이유는 고시정보 7칸을 다시 채우지 않고도 즉시 끌 수 있어야
 * 하기 때문이다 — 한정 드롭 오픈 직전에 필요한 스위치다.
 */
export function GoodBankTransferControl({
  allowBankTransfer,
  id,
}: {
  allowBankTransfer: boolean;
  id: string;
}) {
  const [state, action, pending] = useActionState(
    setGoodBankTransferAction,
    bankTransferInitialState,
  );

  return (
    <form action={action} className="admin-panel col" style={{ gap: 10 }}>
      <div>
        <strong>무통장 입금</strong>
        <p className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
          {allowBankTransfer
            ? '이 굿즈는 무통장 주문을 받습니다. 재고가 최대 24시간 선점됩니다.'
            : '이 굿즈는 카드 결제만 받습니다.'}
        </p>
      </div>
      <input name="id" type="hidden" value={id} />
      <input name="allowed" type="hidden" value={allowBankTransfer ? 'false' : 'true'} />
      <button className="btn btn-ghost" disabled={pending}>
        {pending
          ? '변경하는 중'
          : allowBankTransfer ? '무통장 입금 닫기' : '무통장 입금 열기'}
      </button>
      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {state.message && <p className="admin-note" role="status">{state.message}</p>}
    </form>
  );
}

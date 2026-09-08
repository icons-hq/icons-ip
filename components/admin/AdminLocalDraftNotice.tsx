import { AdminSectionCard } from './console/AdminKit';

export function AdminLocalDraftNotice({ recovery, unavailable = false, pending, onRestore, onDiscard }: {
  recovery: boolean;
  unavailable?: boolean;
  pending: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (unavailable) return <div className="wc-admin-kit wc-admin-kit__card" role="status">
    이 브라우저에서 입력을 자동 저장할 수 없습니다. 이동하기 전에 저장해 주세요.
  </div>;
  if (!recovery) return null;
  return <AdminSectionCard title="저장되지 않은 입력 복구">
    <p className="wc-admin-kit__description" role="status">이 브라우저에 최대 7일 동안 보관된 입력이 있습니다. 복구한 뒤 저장해 주세요.</p>
    <div className="wc-admin-kit__actions">
      <button className="wc-admin-kit__button" disabled={pending} onClick={onRestore} type="button">복구</button>
      <button className="wc-admin-kit__button" disabled={pending} onClick={onDiscard} type="button">버리기</button>
    </div>
  </AdminSectionCard>;
}

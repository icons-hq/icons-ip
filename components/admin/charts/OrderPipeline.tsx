import type { AdminPipelineStage } from '@/lib/admin/insights.server';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from '@/lib/admin/orders';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';

const STAGE_COLORS: Record<AdminOrderStatus, string> = {
  pending: 'var(--wc-warning)',
  paid: 'var(--wc-info)',
  confirmed: 'var(--wc-info)',
  shipping: 'var(--wc-info)',
  delivered: 'var(--wc-success)',
  done: 'var(--wc-success)',
  canceled: 'var(--wc-ink-tertiary)',
};

export function OrderPipeline({ stages }: { stages: AdminPipelineStage[] }) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <div className="card wc-admin-kit wc-admin-kit__card admin-overview-panel">
      <header className="admin-overview-panel__heading">
        <div>
          <h3 className="admin-overview-panel__title">주문 파이프라인</h3>
          <p className="admin-overview-panel__description">{ADMIN_VOCABULARY.goods} 주문 상태 분포 · 전체 기간</p>
        </div>
      </header>
      <div className="admin-pipeline">
        {stages.map((stage) => {
          const pct = total ? Math.round((stage.count / total) * 100) : 0;
          return (
            <div className="admin-pipeline__row" key={stage.status}>
              <span className="admin-pipeline__label">{ADMIN_ORDER_STATUS_LABELS[stage.status]}</span>
              <div className="admin-pipeline__track" aria-hidden="true">
                <div
                  className="admin-pipeline-fill"
                  style={{
                    background: STAGE_COLORS[stage.status],
                    width: `${pct}%`,
                  }}
                />
              </div>
              <span className="admin-pipeline__count">
                <span className="muted">{stage.count.toLocaleString('ko-KR')}건</span>
                <span className="admin-pipeline__percent">{pct}%</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="admin-pipeline__total">
        <span className="muted">전체 주문</span>
        <strong>{total.toLocaleString('ko-KR')}건</strong>
      </div>
    </div>
  );
}

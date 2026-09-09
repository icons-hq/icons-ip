'use client';

import { useEffect, useState } from 'react';
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
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const total = stages.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <div className="card col wc-admin-kit wc-admin-kit__card" style={{ minWidth: 0 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>주문 파이프라인</h2>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{ADMIN_VOCABULARY.goods} 주문 상태 분포 · 전체 기간</div>
      </div>
      <div className="col" style={{ gap: 14 }}>
        {stages.map((stage, index) => {
          const pct = total ? Math.round((stage.count / total) * 100) : 0;
          return (
            <div className="col" key={stage.status} style={{ gap: 7 }}>
              <div className="between">
                <span style={{ fontSize: 13, fontWeight: 600 }}>{ADMIN_ORDER_STATUS_LABELS[stage.status]}</span>
                <span className="row" style={{ gap: 8, fontSize: 12.5 }}>
                  <span className="muted">{stage.count.toLocaleString('ko-KR')}건</span>
                  <span style={{ fontWeight: 700 }}>{pct}%</span>
                </span>
              </div>
              <div style={{ background: 'var(--wc-surface-grey)', borderRadius: 999, height: 7, overflow: 'hidden' }}>
                <div
                  className="admin-pipeline-fill"
                  style={{
                    background: STAGE_COLORS[stage.status],
                    transitionDelay: `${index * 120}ms`,
                    width: loaded ? `${pct}%` : '0%',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="between" style={{ borderTop: '1px solid var(--wc-hairline)', marginTop: 16, paddingTop: 14 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>전체 주문</span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{total.toLocaleString('ko-KR')}건</span>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import type { AdminPipelineStage } from '@/lib/admin/insights.server';

const STAGE_META: Record<string, { label: string; color: string }> = {
  pending: { label: '결제 대기', color: 'var(--amber)' },
  paid: { label: '결제 완료', color: 'var(--violet-2)' },
  shipping: { label: '배송 중', color: 'var(--cyan)' },
  done: { label: '구매 확정', color: 'var(--mint)' },
  canceled: { label: '취소', color: 'var(--faint)' },
};

export function OrderPipeline({ stages }: { stages: AdminPipelineStage[] }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const total = stages.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <div className="card col" style={{ borderRadius: 10, minWidth: 0, padding: 18 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>주문 파이프라인</h2>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>굿즈 주문 상태 분포 · 전체 기간</div>
      </div>
      <div className="col" style={{ gap: 14 }}>
        {stages.map((stage, index) => {
          const meta = STAGE_META[stage.status] ?? { label: stage.status, color: 'var(--dim)' };
          const pct = total ? Math.round((stage.count / total) * 100) : 0;
          return (
            <div className="col" key={stage.status} style={{ gap: 7 }}>
              <div className="between">
                <span style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</span>
                <span className="row" style={{ gap: 8, fontSize: 12.5 }}>
                  <span className="muted">{stage.count.toLocaleString('ko-KR')}건</span>
                  <span style={{ fontWeight: 700 }}>{pct}%</span>
                </span>
              </div>
              <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 999, height: 7, overflow: 'hidden' }}>
                <div
                  className="admin-pipeline-fill"
                  style={{
                    background: meta.color,
                    transitionDelay: `${index * 120}ms`,
                    width: loaded ? `${pct}%` : '0%',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="between" style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 14 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>전체 주문</span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{total.toLocaleString('ko-KR')}건</span>
      </div>
    </div>
  );
}

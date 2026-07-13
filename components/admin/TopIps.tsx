import type { AdminTopIp } from '@/lib/admin/insights.server';
import { Icon } from '@/components/ui/Icon';
import { formatKrw } from './format';

export function TopIps({ ips }: { ips: AdminTopIp[] }) {
  return (
    <div className="card col" style={{ borderRadius: 10, minWidth: 0, padding: 18 }}>
      <div className="between" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>IP별 매출 톱 {ips.length || 5}</h2>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>최근 30일 · 굿즈 주문 기준</div>
        </div>
        <span style={{ color: 'var(--amber)' }}>
          <Icon name="star" size={18} />
        </span>
      </div>
      {ips.map((ip, index) => (
        <div className="between" key={ip.ipId} style={{ borderTop: '1px solid var(--line)', gap: 12, padding: '11px 0' }}>
          <div className="row" style={{ gap: 11, justifyContent: 'flex-start', minWidth: 0 }}>
            <span
              className="mono"
              style={{
                alignItems: 'center',
                background: index === 0 ? 'var(--holo)' : 'rgba(255,255,255,.05)',
                border: index === 0 ? 'none' : '1px solid var(--line)',
                borderRadius: 999,
                color: index === 0 ? '#0A0813' : 'var(--dim)',
                display: 'grid',
                flex: '0 0 auto',
                fontSize: 12.5,
                fontWeight: 700,
                height: 30,
                placeItems: 'center',
                width: 30,
              }}
            >
              {index + 1}
            </span>
            <div className="col" style={{ gap: 3, minWidth: 0 }}>
              <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ip.title}
              </strong>
              <span className="faint mono" style={{ fontSize: 11 }}>주문 {ip.orderCount.toLocaleString('ko-KR')}건</span>
            </div>
          </div>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{formatKrw(ip.revenue)}</span>
        </div>
      ))}
      {!ips.length && (
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 2px' }}>최근 30일 매출 데이터가 없습니다.</p>
      )}
    </div>
  );
}

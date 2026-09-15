import type { AdminTopIp } from '@/lib/admin/insights.server';
import { Icon } from '@/components/ui/Icon';
import { formatKrw } from './format';

export function TopIps({ ips }: { ips: AdminTopIp[] }) {
  return (
    <div className="card col wc-admin-kit wc-admin-kit__card admin-overview-panel">
      <div className="admin-overview-panel__heading">
        <div>
          <h3 className="admin-overview-panel__title">IP별 매출 톱 {ips.length || 5}</h3>
          <div className="admin-overview-panel__description">최근 30일 · 상품 주문 기준</div>
        </div>
        <span aria-hidden="true" className="admin-overview-panel__icon">
          <Icon name="star" size={18} />
        </span>
      </div>
      <div className="admin-overview-list">
        {ips.map((ip, index) => (
          <div className="admin-overview-list__row" key={ip.ipId}>
            <div className="admin-overview-list__identity">
              <span className={`mono admin-overview-list__avatar${index === 0 ? ' admin-overview-list__avatar--top' : ''}`}>
                {index + 1}
              </span>
              <div className="admin-overview-list__copy">
                <strong className="admin-overview-list__name">{ip.title}</strong>
                <span className="admin-overview-list__meta">주문 {ip.orderCount.toLocaleString('ko-KR')}건</span>
              </div>
            </div>
            <div className="admin-overview-list__amount">
              <span className="admin-overview-list__value">{formatKrw(ip.revenue)}</span>
            </div>
          </div>
        ))}
        {!ips.length && (
          <p className="admin-overview-list__empty muted">최근 30일 매출 데이터가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

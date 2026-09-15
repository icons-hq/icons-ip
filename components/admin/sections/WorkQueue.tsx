import Link from 'next/link';
import { AdminSectionCard } from '../console/AdminKit';
import { ADMIN_WORK_QUEUES, type AdminWorkQueueData } from '@/lib/admin/work-queue';
import { GOODS_READINESS_REASONS } from '@/lib/admin/goods-readiness';

export function WorkQueueSection({ data }: { data?: AdminWorkQueueData }) {
  return <AdminSectionCard title="지금 처리할 업무" summary={<>현재 처리 대기 잔량입니다. 주문 1건이 여러 배송 건으로 나뉠 수 있습니다. 발송 지연은 발송 대기에도 포함됩니다.</>}>
    <div className="admin-work-queue">
      <div className="admin-work-queue__cards">{ADMIN_WORK_QUEUES.map(queue => {
        const value = data?.counts[queue.id];
        return <Link key={queue.id} href={queue.href} prefetch={false} className="admin-work-queue__card">
          <span>{queue.label}</span><strong className={value?.state === 'error' ? 'admin-work-queue__error' : undefined}>{value?.state === 'ready' ? `${value.count.toLocaleString('ko-KR')}건` : '확인 필요'}</strong>
          <small>{queue.unit} 수 · {queue.description}</small>
          {value?.state !== 'ready' ? <small>집계를 불러오지 못했습니다. 목록에서 다시 확인하세요.</small> : null}
        </Link>;
      })}</div>
      <div className="admin-work-queue__footer">
      {data?.goodsReasons.length ? <details><summary>상품 검토 사유별 건수</summary><p className="wc-admin-kit__description">전체는 중복 없는 상품 수입니다. 한 상품에 여러 사유가 있으면 각 사유에 포함되므로 사유별 건수 합계와 다를 수 있습니다.</p>
        <ul className="admin-work-queue__reasons">{data.goodsReasons.map(reason => <li key={reason.code}><Link href={reason.href} prefetch={false}>{GOODS_READINESS_REASONS[reason.code].label} · {reason.count.toLocaleString('ko-KR')}개</Link></li>)}</ul>
      </details> : null}
      {data ? <p className="admin-work-queue__timestamp">확인 시각: <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</time></p> : null}
      </div>
    </div>
  </AdminSectionCard>;
}

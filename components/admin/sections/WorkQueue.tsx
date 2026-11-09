import Link from 'next/link';
import { AdminSectionCard } from '../console/AdminKit';
import { visibleAdminWorkQueues, type AdminWorkQueueData } from '@/lib/admin/work-queue';
import { GOODS_READINESS_REASONS } from '@/lib/admin/goods-readiness';

export function WorkQueueSection({ data }: { data?: AdminWorkQueueData }) {
  return <AdminSectionCard title="지금 처리할 업무" summary={<>현재 처리 대기 잔량입니다. 주문 1건이 여러 배송 건으로 나뉠 수 있습니다. 발송 지연은 발송 대기에도 포함됩니다.</>}>
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{visibleAdminWorkQueues(data).map(queue => {
        const value = data?.counts[queue.id];
        const ready = value?.state === 'ready';
        return <Link className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent" href={queue.href} key={queue.id} prefetch={false}>
          <span className="text-xs text-muted-foreground">{queue.label}</span>
          <strong className={ready ? `text-xl font-semibold tabular-nums${value.count > 0 ? queue.id === 'delayed' ? ' text-destructive' : ' text-warning' : ''}` : `text-base font-medium ${value?.state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{ready ? `${value.count.toLocaleString('ko-KR')}건` : '확인 필요'}</strong>
          <small className="text-xs text-muted-foreground">{queue.unit} 수 · {queue.description}</small>
          {!ready ? <small className="text-xs text-muted-foreground">집계를 불러오지 못했습니다. 목록에서 다시 확인하세요.</small> : null}
        </Link>;
      })}</div>
      <div className="flex flex-col gap-2">
        {data?.goodsReasons.length ? <details className="group rounded-lg border bg-muted/40 px-3 py-2.5">
          <summary className="cursor-pointer text-sm font-medium">상품 검토 사유별 건수</summary>
          <p className="mt-2 text-sm text-muted-foreground">전체는 중복 없는 상품 수입니다. 한 상품에 여러 사유가 있으면 각 사유에 포함되므로 사유별 건수 합계와 다를 수 있습니다.</p>
          <ul className="mt-2 flex flex-wrap gap-2">{data.goodsReasons.map(reason => <li key={reason.code}><Link className="inline-flex rounded-md border bg-background px-2 py-1 text-xs underline-offset-4 hover:underline" href={reason.href} prefetch={false}>{GOODS_READINESS_REASONS[reason.code].label} · {reason.count.toLocaleString('ko-KR')}개</Link></li>)}</ul>
        </details> : null}
        {data ? <p className="text-xs text-muted-foreground">확인 시각: <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST</time></p> : null}
      </div>
    </div>
  </AdminSectionCard>;
}

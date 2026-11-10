import { PRODUCTION_STATE_LABELS, productionLeadLabel, type OrderProduction } from '@/lib/order-production';
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
export function OrderProductionStatus({ document }: { document: OrderProduction | null }) {
 if (!document) return <p role="status">제작 현황을 확인하지 못했습니다. 잠시 후 다시 확인해주세요.</p>;
 if (!document.jobs.length) return null;
 return <section className="order-detail-inquiry" aria-label="주문제작 현황"><h3>주문제작 현황</h3>
  {document.jobs.map(job => <div key={job.id}><strong>{job.goodName} · {job.quantity}개{job.claimId ? ' · 교환 제작' : ''}</strong><p>{PRODUCTION_STATE_LABELS[job.state]}</p>
   <p>{job.claimId ? '반송 굿즈 입고 확인' : '결제 확인'} 후 {productionLeadLabel(job.terms)} 내 발송 예정{job.dueAt ? ` · ${time(job.dueAt)}까지` : ' · 결제 확인 후 날짜 안내'}</p>
   {job.terms.publicNote ? <p>{job.terms.publicNote}</p> : null}
   {job.startedAt ? <p>제작 시작 {time(job.startedAt)}</p> : null}{job.completedAt ? <p>제작 완료 {time(job.completedAt)} · 실제 발송 상태는 배송 내역에서 확인해주세요.</p> : null}
  </div>)}
  {document.cancelReviewRequired && document.canCancel ? <p>제작 시작 후 취소도 신청할 수 있습니다. 담당자가 제작 상황과 요청 사유를 확인하며 자동으로 거절하거나 환불하지 않습니다.</p> : null}
 </section>;
}

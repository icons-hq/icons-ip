import Link from 'next/link';
import { ScheduledHomeRefresh } from '@/components/home/ScheduledHomeRefresh';
import { reviewEventStateLabel, type PublicReviewEventList, type PublicReviewEventDetail } from '@/lib/review-events';
import { goodReviewsHref } from '@/lib/reviews';

export function ReviewEventsScreen({ data, page }: { data: PublicReviewEventList; page: number }) {
  const pages = Math.max(1, Math.ceil(data.total / 20));
  return <main className="wc-root wc-container wc-review-events"><header><p>REVIEW EVENT</p><h1>리뷰이벤트</h1><p>직접 써 본 이야기를 들려주세요.</p></header>{data.nextChangeAt ? <ScheduledHomeRefresh at={data.nextChangeAt} /> : null}
    {data.unavailable ? <p role="status">리뷰이벤트를 불러오지 못했습니다. 잠시 후 다시 방문해주세요.</p> : !data.rows.length ? <p>새로운 리뷰이벤트를 준비하고 있습니다.</p> : <ul className="wc-review-events__cards">{data.rows.map(event => <li key={event.id}><Link href={`/review-events/${event.id}`}><span>{reviewEventStateLabel[event.state]}</span><h2>{event.title}</h2><p>{event.description}</p><strong>선정 시 적립금 {event.creditAmount.toLocaleString('ko-KR')}원</strong><small>예정 {event.plannedWinners}명 · {event.startsOn} ~ {event.endsOn}</small><small>발표 {event.announcesOn}</small></Link></li>)}</ul>}
    {pages > 1 ? <nav aria-label="리뷰이벤트 페이지">{page > 1 ? <Link href={`/review-events?page=${page - 1}`}>이전</Link> : null}<span>{page} / {pages}</span>{page < pages ? <Link href={`/review-events?page=${page + 1}`}>다음</Link> : null}</nav> : null}
  </main>;
}
export function ReviewEventScreen({ data }: { data: PublicReviewEventDetail }) {
  const { event, winnerPage, winnerTotal, winners } = data, pages = Math.max(1, Math.ceil(winnerTotal / 50));
  return <main className="wc-root wc-container wc-review-events wc-review-event-detail"><Link href="/review-events">← 리뷰이벤트 목록</Link>{event.nextChangeAt ? <ScheduledHomeRefresh at={event.nextChangeAt} /> : null}<header><p>{reviewEventStateLabel[event.state]}</p><h1>{event.title}</h1><p>{event.description}</p></header>
    <dl><div><dt>응모기간</dt><dd>{event.startsOn} ~ {event.endsOn} (한국 시각)</dd></div><div><dt>발표 예정일</dt><dd>{event.announcesOn}{event.state === 'ready' ? ' · 발표 준비 중' : ''}</dd></div><div><dt>선정 혜택</dt><dd>적립금 {event.creditAmount.toLocaleString('ko-KR')}원 · 예정 {event.plannedWinners}명</dd></div><div><dt>적립금 유효기간</dt><dd>지급 시점부터 {event.creditValidityDays}일</dd></div></dl>
    <section><h2>참여 안내</h2><p>대상 굿즈의 결제와 배송을 완료한 구매자가 응모기간에 새 리뷰를 작성하면 자동으로 응모됩니다. 대상 굿즈에는 진행 중인 이벤트 배너가 표시됩니다. 배송완료 후 90일 이내, 주문·굿즈당 한 번 작성할 수 있습니다.</p><p>별점과 무관하게 리뷰 내용을 기준으로 선정합니다. 리뷰 작성만으로 적립금이 지급되지는 않으며 실제 선정 인원은 예정 인원과 다를 수 있습니다. 고객 한 명당 한 번 혜택을 제공합니다.</p><p>이벤트가 겹치면 적립금이 가장 큰 이벤트 한 건에만 응모됩니다. 금액이 같으면 먼저 시작한 이벤트, 시작일도 같으면 정해진 이벤트 순서로 배정됩니다. 응모된 이벤트는 내 리뷰에서 확인할 수 있습니다.</p><p>리뷰 삭제·비공개, 구매 취소·반품 완료 시 선정 혜택이 회수됩니다. 사용한 적립금은 이후 적립금에서 차감됩니다. 선정된 리뷰에는 혜택 제공 사실이 표시되며, 혜택 회수 후에도 이력은 남습니다.</p><Link className="wc-review-events__button" href="/my/reviews">내 리뷰 확인하기 →</Link></section>
    {event.announcedAt ? <section><h2>당첨자 발표</h2><p>{new Date(event.announcedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} 발표 · 현재 공개된 당첨 리뷰 {winnerTotal}건</p>{winners.length ? <ul className="wc-review-event-winners">{winners.map(winner => <li key={winner.reviewId}><strong>@{winner.nickname}</strong><Link href={goodReviewsHref(winner.goodId)}>{winner.goodName}</Link><p>{winner.body}</p><small>리뷰이벤트 선정 적립금 혜택을 받은 리뷰입니다.</small></li>)}</ul> : <p>현재 공개된 당첨 리뷰가 없습니다.</p>}{pages > 1 ? <nav aria-label="당첨 리뷰 페이지">{winnerPage > 1 ? <Link href={`/review-events/${event.id}?page=${winnerPage - 1}`}>이전</Link> : null}<span>{winnerPage} / {pages}</span>{winnerPage < pages ? <Link href={`/review-events/${event.id}?page=${winnerPage + 1}`}>다음</Link> : null}</nav> : null}</section> : <section><h2>당첨자 발표</h2><p>운영자가 발표를 확정하면 이곳에서 당첨 리뷰를 확인할 수 있습니다. 발표일은 {event.announcesOn}입니다.</p></section>}
  </main>;
}

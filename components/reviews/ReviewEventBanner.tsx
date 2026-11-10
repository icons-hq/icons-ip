import Link from 'next/link';
import type { PublicReviewEvent, ReviewEventDisclosure } from '@/lib/review-events';
export function ReviewEventBanner({ event, preview = false }: { event: PublicReviewEvent; preview?: boolean }) {
  const content = <><span className="wc-review-event-banner__eyebrow">REVIEW EVENT</span><strong>{event.title || '리뷰이벤트 제목'}</strong><span>{event.description || '이벤트 내용을 입력해주세요.'}</span><span>선정 시 적립금 <b>{event.creditAmount.toLocaleString('ko-KR')}원</b> · 예정 {event.plannedWinners}명</span><small>{event.startsOn} ~ {event.endsOn} · 발표 {event.announcesOn}</small><small>별점과 무관하게 선정 · 작성만으로 지급되지 않습니다.</small></>;
  return preview ? <div className="wc-review-event-banner" data-style={event.bannerStyle}>{content}</div> : <Link className="wc-review-event-banner" data-style={event.bannerStyle} href={`/review-events/${event.id}`}>{content}<span className="wc-review-event-banner__more">이벤트 안내 보기 →</span></Link>;
}
export function ReviewEventDisclosureNote({ value }: { value?: ReviewEventDisclosure }) {
  if (!value) return null;
  return <p className="wc-review-event-disclosure">{value.unavailable ? '리뷰 이벤트 혜택 제공 여부를 확인하지 못했습니다.' : <>이 리뷰는 ‘{value.eventTitle}’ 선정으로 적립금 혜택을 받았습니다.{value.revoked ? ' 이후 혜택이 회수되었습니다.' : ''}</>}</p>;
}

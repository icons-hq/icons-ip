import Link from 'next/link';
import type { NotificationItem, NotificationType } from '@/lib/notifications';
import { Icon } from '@/components/ui/Icon';
import { MypageShell } from '@/components/wc/MypageShell';

const TYPE_LABELS: Record<NotificationType, string> = {
  order_paid: '주문',
  order_bank_transfer_pending: '입금',
  order_shipping: '배송',
  order_delivered: '배송',
  draw_ticket_issued: '카드팩',
  drop_published: '드롭',
  event_published: '이벤트',
  announcement: '공지',
  inquiry_answered: '문의',
  claim_updated: '클레임',
  review_replied: '리뷰',
  restock_available: '재입고',
  loyalty_grade_upgraded: '등급',
  /* 비공개 1:1('문의')과 다른 표면이라 라벨도 갈라 둔다 — 같은 말이면 알림함에서
     어느 쪽에 답이 달렸는지 알 수 없다. */
  product_question_answered: '상품 Q&A',
};

const TYPE_ICONS: Record<NotificationType, string> = {
  order_paid: 'bag',
  order_bank_transfer_pending: 'bag',
  order_shipping: 'bag',
  order_delivered: 'bag',
  draw_ticket_issued: 'spark',
  drop_published: 'shop',
  event_published: 'event',
  announcement: 'bell',
  inquiry_answered: 'chat',
  claim_updated: 'bag',
  review_replied: 'star',
  restock_available: 'bell',
  loyalty_grade_upgraded: 'star',
  product_question_answered: 'chat',
};

const notificationDate = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

interface NotificationsProps {
  error?: boolean;
  notifications: NotificationItem[];
  openAction: (notificationId: string) => Promise<void>;
}

export function Notifications({ error = false, notifications, openAction }: NotificationsProps) {
  return (
    <MypageShell active="/notifications">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">알림함</h1>
        <Link className="wc-mypage__headbar-link" href="/notifications/settings">
          IP 알림 설정
        </Link>
      </div>

      <section aria-labelledby="notifications-ledger-heading">
        <div className="wc-mypage__subhead">
          <h2 id="notifications-ledger-heading">최근 알림</h2>
          <span>{notifications.length}건</span>
        </div>

        {error && (
          <p className="wc-mypage__error" role="alert">
            알림을 열지 못했습니다. 잠시 후 다시 시도해주세요.
          </p>
        )}

        {notifications.length === 0 ? (
          <div className="wc-empty">
            <h2 className="wc-empty__title">아직 받은 알림이 없어요</h2>
            <p className="wc-empty__desc">주문, 카드팩, 팔로우한 IP의 새 소식이 생기면 여기에 알려드릴게요.</p>
          </div>
        ) : (
          <ol className="wc-notif__list">
            {notifications.map((notification) => (
              <li
                className={`wc-notif__row${notification.isUnread ? ' is-unread' : ''}`}
                key={notification.id}
              >
                <form action={openAction.bind(null, notification.id)}>
                  <button className="wc-notif__open" type="submit">
                    <span aria-hidden className="wc-notif__icon">
                      <Icon name={TYPE_ICONS[notification.type]} size={20} />
                    </span>
                    <span className="wc-notif__copy">
                      <span className="wc-notif__meta">
                        <span>{TYPE_LABELS[notification.type]}</span>
                        <time dateTime={notification.createdAt}>
                          {notificationDate.format(new Date(notification.createdAt))}
                        </time>
                      </span>
                      <strong>{notification.title}</strong>
                      <span>{notification.body}</span>
                      <span className="sr-only">
                        {notification.isUnread ? '안 읽은 알림' : '읽은 알림'}
                      </span>
                    </span>
                    {notification.isUnread && (
                      <span aria-hidden className="wc-notif__dot" />
                    )}
                    <span aria-hidden className="wc-notif__arrow">
                      <Icon name="chevronRight" size={18} />
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ol>
        )}
      </section>
    </MypageShell>
  );
}

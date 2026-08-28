import Link from 'next/link';
import type { NotificationItem, NotificationType } from '@/lib/notifications';
import { Icon } from '@/components/ui/Icon';

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
    <main className="screen notifications-page">
      <header className="notifications-header">
        <div className="wrap notifications-header-inner">
          <div>
            <div className="eyebrow rise">INBOX</div>
            <h1 className="h-xl rise">알림함</h1>
            <p className="rise">주문과 카드팩, 팔로우한 IP의 새 소식을 확인하세요.</p>
          </div>
          <Link className="btn btn-ghost notifications-settings-link" href="/notifications/settings">
            <Icon name="settings" size={17} /> IP 알림 설정
          </Link>
        </div>
      </header>

      <section aria-labelledby="notifications-ledger-heading" className="notifications-content">
        <div className="wrap">
          <div className="notifications-section-heading">
            <div>
              <span aria-hidden className="mono">LATEST 50</span>
              <h2 id="notifications-ledger-heading">최근 알림</h2>
            </div>
            <span className="mono">{notifications.length}건</span>
          </div>

          {error && (
            <p className="notification-settings-error" role="alert">
              알림을 열지 못했습니다. 잠시 후 다시 시도해주세요.
            </p>
          )}

          {notifications.length === 0 ? (
            <div className="card notifications-empty">
              <span aria-hidden className="notifications-empty-icon">
                <Icon name="bell" size={30} />
              </span>
              <h2>아직 받은 알림이 없어요</h2>
              <p>주문, 카드팩, 팔로우한 IP의 새 소식이 생기면 여기에 알려드릴게요.</p>
              <Link className="btn btn-ghost" href="/notifications/settings">IP 알림 설정</Link>
            </div>
          ) : (
            <ol className="notifications-ledger">
              {notifications.map((notification) => (
                <li
                  className={`notification-row ${notification.isUnread ? 'is-unread' : 'is-read'}`}
                  key={notification.id}
                >
                  <form action={openAction.bind(null, notification.id)}>
                    <button className="notification-open" type="submit">
                      <span aria-hidden className="notification-type-icon">
                        <Icon name={TYPE_ICONS[notification.type]} size={20} />
                      </span>
                      <span className="notification-copy">
                        <span className="notification-meta mono">
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
                        <span aria-hidden className="notification-unread-dot" />
                      )}
                      <span aria-hidden className="notification-arrow">
                        <Icon name="chevronRight" size={18} />
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}

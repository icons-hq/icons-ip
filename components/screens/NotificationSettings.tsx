'use client';

import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/ui/Icon';

export interface NotificationPreferenceView {
  ipId: string;
  title: string;
  notifyDrops: boolean;
  notifyEvents: boolean;
}

interface NotificationSettingsProps {
  action: (formData: FormData) => Promise<void>;
  error?: boolean;
  preferences: NotificationPreferenceView[];
  saved?: boolean;
}

function NotificationPreferenceSaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-busy={pending || undefined}
      className="btn btn-ghost notification-preference-save"
      disabled={pending}
      type="submit"
    >
      {pending ? '저장 중…' : '변경 저장'}
    </button>
  );
}

export function NotificationSettings({
  action,
  error = false,
  preferences,
  saved = false,
}: NotificationSettingsProps) {
  return (
    <main className="screen notification-settings-page">
      <header className="notifications-header">
        <div className="wrap notifications-header-inner">
          <div>
            <div className="eyebrow rise">PREFERENCES</div>
            <h1 className="h-xl rise">IP 알림 설정</h1>
            <p className="rise">팔로우한 IP별로 받고 싶은 인앱 알림을 선택하세요.</p>
          </div>
          <Link className="btn btn-ghost notifications-settings-link" href="/notifications">
            <Icon name="chevronLeft" size={17} /> 알림함
          </Link>
        </div>
      </header>

      <section aria-labelledby="notification-preferences-heading" className="notifications-content">
        <div className="wrap">
          <div className="notifications-section-heading">
            <div>
              <span aria-hidden className="mono">FOLLOWING</span>
              <h2 id="notification-preferences-heading">팔로우 IP</h2>
            </div>
            <span className="mono">{preferences.length}개</span>
          </div>

          {error && (
            <p className="notification-settings-error" role="alert">
              알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
            </p>
          )}
          {saved && !error && (
            <p aria-live="polite" className="notification-settings-success" role="status">
              알림 설정을 저장했습니다.
            </p>
          )}

          {preferences.length === 0 ? (
            <div className="card notifications-empty">
              <span aria-hidden className="notifications-empty-icon">
                <Icon name="bell" size={30} />
              </span>
              <h2>아직 팔로우한 IP가 없어요</h2>
              <p>좋아하는 IP를 팔로우하면 새 굿즈·드롭과 팝업·이벤트 알림을 설정할 수 있어요.</p>
              <Link className="btn btn-ghost" href="/ip">IP 둘러보기</Link>
            </div>
          ) : (
            <div className="notification-preference-list">
              {preferences.map((preference) => (
                <form action={action} className="card notification-preference" key={preference.ipId}>
                  <input name="ipId" type="hidden" value={preference.ipId} />
                  <input name="next" type="hidden" value="/notifications/settings" />
                  <input name="setBoth" type="hidden" value="1" />
                  <div className="notification-preference-heading">
                    <span aria-hidden className="mono">FOLLOWED IP</span>
                    <h2>{preference.title}</h2>
                  </div>
                  <div className="notification-preference-controls">
                    <label className="notification-switch">
                      <span>
                        <strong>새 굿즈·드롭</strong>
                        <small>새 굿즈가 공개되면 알려드려요.</small>
                      </span>
                      <input
                        aria-label={`${preference.title} 새 굿즈·드롭 알림`}
                        defaultChecked={preference.notifyDrops}
                        name="notifyDrops"
                        role="switch"
                        type="checkbox"
                        value="true"
                      />
                    </label>
                    <label className="notification-switch">
                      <span>
                        <strong>팝업·이벤트</strong>
                        <small>새 이벤트가 공개되면 알려드려요.</small>
                      </span>
                      <input
                        aria-label={`${preference.title} 팝업·이벤트 알림`}
                        defaultChecked={preference.notifyEvents}
                        name="notifyEvents"
                        role="switch"
                        type="checkbox"
                        value="true"
                      />
                    </label>
                  </div>
                  <NotificationPreferenceSaveButton />
                </form>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

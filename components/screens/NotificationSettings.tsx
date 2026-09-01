'use client';

import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { MypageShell } from '@/components/wc/MypageShell';
import { WcButton } from '@/components/wc/WcButton';

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
      className="wc-btn wc-notif__save"
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
    <MypageShell active="/notifications">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">IP 알림 설정</h1>
        <Link className="wc-mypage__headbar-link" href="/notifications">
          알림함
        </Link>
      </div>

      <section aria-labelledby="notification-preferences-heading">
        <div className="wc-mypage__subhead">
          <h2 id="notification-preferences-heading">팔로우 IP</h2>
          <span>{preferences.length}개</span>
        </div>

        {error && (
          <p className="wc-mypage__error" role="alert">
            알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
          </p>
        )}
        {saved && !error && (
          <p aria-live="polite" className="wc-mypage__success" role="status">
            알림 설정을 저장했습니다.
          </p>
        )}

        {preferences.length === 0 ? (
          <div className="wc-empty">
            <h2 className="wc-empty__title">아직 팔로우한 IP가 없어요</h2>
            <p className="wc-empty__desc">좋아하는 IP를 팔로우하면 새 굿즈·드롭과 팝업·이벤트 알림을 설정할 수 있어요.</p>
            <div className="wc-empty__action">
              <WcButton href="/ip">IP 둘러보기</WcButton>
            </div>
          </div>
        ) : (
          <div className="wc-notif__prefs">
            {preferences.map((preference) => (
              <form action={action} className="wc-notif__pref" key={preference.ipId}>
                <input name="ipId" type="hidden" value={preference.ipId} />
                <input name="next" type="hidden" value="/notifications/settings" />
                <input name="setBoth" type="hidden" value="1" />
                <h3 className="wc-notif__pref-title">{preference.title}</h3>
                <div className="wc-notif__pref-controls">
                  <label className="wc-notif__switch">
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
                  <label className="wc-notif__switch">
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
      </section>
    </MypageShell>
  );
}

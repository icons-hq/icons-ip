'use client';

import { useActionState, useState } from 'react';
import { sendAdminNotificationAction } from '@/app/admin/notification-actions';
import { Icon } from '@/components/ui/Icon';
import type {
  AdminNotificationActionState,
  AdminNotificationAudience,
  AdminNotificationConsoleData,
  AdminNotificationScope,
} from '@/lib/admin/notifications';

const emptyActionState: AdminNotificationActionState = {};
const recipientNumber = new Intl.NumberFormat('ko-KR');
const historyDate = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Seoul',
});

function characterCount(value: string) {
  return [...value].length;
}

function audienceLabel(
  audience: Pick<AdminNotificationAudience, 'scope' | 'ipId' | 'ipTitle'>,
) {
  if (audience.scope === 'all') return '전체 사용자';
  return `${audience.ipTitle ?? audience.ipId ?? 'IP'} 팔로워`;
}

function FieldError({ children, id }: { children?: string; id: string }) {
  if (!children) return null;
  return <span className="admin-notification-field-error" id={id} role="alert">{children}</span>;
}

export function NotificationSection({
  data,
  operationId: initialOperationId,
}: {
  data: AdminNotificationConsoleData;
  operationId: string;
}) {
  const [scope, setScope] = useState<AdminNotificationScope>('all');
  const [ipId, setIpId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [operationId, setOperationId] = useState(initialOperationId);
  const [state, action, pending] = useActionState(async (
    previousState: AdminNotificationActionState,
    formData: FormData,
  ) => {
    const result = await sendAdminNotificationAction(previousState, formData);
    if (result.nextOperationId) {
      setOperationId(result.nextOperationId);
      setScope('all');
      setIpId('');
      setConfirmed(false);
      setTitle('');
      setBody('');
    }
    return result;
  }, emptyActionState);
  const allAudience = data.audiences.find((audience) => audience.scope === 'all') ?? null;
  const ipAudiences = data.audiences.filter(
    (audience): audience is AdminNotificationAudience & { ipId: string } =>
      audience.scope === 'ip_followers' && Boolean(audience.ipId),
  );
  const audience = scope === 'all'
    ? allAudience
    : ipAudiences.find((candidate) => candidate.ipId === ipId) ?? null;
  const titleLength = characterCount(title);
  const bodyLength = characterCount(body);
  const contentValid = title.trim().length > 0
    && titleLength <= 120
    && body.trim().length > 0
    && bodyLength <= 500;
  const canSend = Boolean(audience?.canSend && contentValid && !pending);

  const resetConfirmation = () => setConfirmed(false);

  return (
    <section aria-labelledby="admin-notification-heading" className="admin-notification-console col">
      <header className="admin-notification-heading">
        <div>
          <span className="mono">IN-APP ANNOUNCEMENT</span>
          <h2 id="admin-notification-heading">공지·알림 발송</h2>
          <p>전체 사용자 또는 특정 IP 팔로워에게 운영 공지를 보냅니다.</p>
        </div>
        <span className="admin-notification-channel-badge">인앱 전용</span>
      </header>

      <p className="card admin-notification-guide" role="note">
        인앱 알림함에 즉시 발송됩니다. 이메일·푸시는 발송하지 않습니다. 수신자 수는 현재 기준 추정치이며 실제 수신자는 발송 시점에 확정됩니다.
      </p>

      <div className="admin-notification-layout">
        <form
          action={action}
          className="card admin-notification-composer"
          onSubmit={(event) => {
            if (confirmed && canSend) return;
            event.preventDefault();
            if (canSend) setConfirmed(true);
          }}
        >
          <input name="operationId" type="hidden" value={operationId} />

          <div className="admin-notification-form-heading">
            <div>
              <span className="mono">COMPOSER</span>
              <h3>발송 내용</h3>
            </div>
            <span aria-live="polite" className={audience?.canSend ? 'can-send' : 'cannot-send'}>
              {audience
                ? `현재 추정 수신자 ${recipientNumber.format(audience.recipientCount)}명`
                : '대상을 선택해주세요'}
            </span>
          </div>

          <div className="admin-notification-target-grid">
            <label>
              <span className="mono">발송 대상</span>
              <select
                aria-describedby={state.errors?.scope ? 'notification-scope-error' : undefined}
                aria-invalid={Boolean(state.errors?.scope)}
                className="admin-notification-control"
                disabled={pending}
                name="scope"
                onChange={(event) => {
                  setScope(event.target.value as AdminNotificationScope);
                  setIpId('');
                  resetConfirmation();
                }}
                value={scope}
              >
                <option value="all">전체 사용자</option>
                <option value="ip_followers">특정 IP 팔로워</option>
              </select>
              <FieldError id="notification-scope-error">{state.errors?.scope}</FieldError>
            </label>

            <label>
              <span className="mono">대상 IP</span>
              <select
                aria-describedby={state.errors?.ipId ? 'notification-ip-error' : undefined}
                aria-invalid={Boolean(state.errors?.ipId)}
                className="admin-notification-control"
                disabled={scope === 'all' || pending}
                name="ipId"
                onChange={(event) => {
                  setIpId(event.target.value);
                  resetConfirmation();
                }}
                required={scope === 'ip_followers'}
                value={ipId}
              >
                <option value="">IP 선택</option>
                {ipAudiences.map((candidate) => (
                  <option key={candidate.ipId} value={candidate.ipId}>
                    {candidate.ipTitle ?? candidate.ipId} · {recipientNumber.format(candidate.recipientCount)}명
                  </option>
                ))}
              </select>
              <FieldError id="notification-ip-error">{state.errors?.ipId}</FieldError>
            </label>
          </div>

          <label>
            <span className="admin-notification-label-row">
              <span className="mono">제목</span>
              <span className={titleLength > 120 ? 'is-over-limit' : undefined}>{titleLength}/120</span>
            </span>
            <input
              aria-describedby={state.errors?.title ? 'notification-title-error' : undefined}
              aria-invalid={Boolean(state.errors?.title) || titleLength > 120}
              className="admin-notification-control"
              disabled={pending}
              name="title"
              onChange={(event) => {
                setTitle(event.target.value);
                resetConfirmation();
              }}
              placeholder="알림함에 보일 제목"
              required
              value={title}
            />
            <FieldError id="notification-title-error">{state.errors?.title}</FieldError>
          </label>

          <label>
            <span className="admin-notification-label-row">
              <span className="mono">본문</span>
              <span className={bodyLength > 500 ? 'is-over-limit' : undefined}>{bodyLength}/500</span>
            </span>
            <textarea
              aria-describedby={state.errors?.body ? 'notification-body-error' : undefined}
              aria-invalid={Boolean(state.errors?.body) || bodyLength > 500}
              className="admin-notification-control"
              disabled={pending}
              name="body"
              onChange={(event) => {
                setBody(event.target.value);
                resetConfirmation();
              }}
              placeholder="전달할 운영 소식을 적어주세요."
              required
              rows={6}
              value={body}
            />
            <FieldError id="notification-body-error">{state.errors?.body}</FieldError>
          </label>

          {!audience?.canSend && (
            <p className="admin-notification-blocked" role="status">
              현재 대상에게 발송할 수 없습니다. 수신자가 1명 이상인지 확인해주세요.
            </p>
          )}

          {state.errors?.form && (
            <p className="admin-notification-action-error" role="alert">{state.errors.form}</p>
          )}
          {state.message && state.recipientCount !== undefined && (
            <p className="admin-notification-action-success" role="status">
              <Icon name="check" size={16} /> 실제 {recipientNumber.format(state.recipientCount)}명에게 발송했습니다.
            </p>
          )}

          {confirmed ? (
            <div aria-label="즉시 발송 최종 확인" className="admin-notification-confirm" role="group">
              <p>
                예상 {recipientNumber.format(audience?.recipientCount ?? 0)}명에게 즉시 발송하며 회수할 수 없습니다.
              </p>
              <div>
                <button
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() => setConfirmed(false)}
                  type="button"
                >
                  내용 다시 수정
                </button>
                <button className="btn btn-holo" disabled={!canSend} type="submit">
                  <Icon name="bell" size={16} /> {pending ? '발송 처리 중' : '즉시 발송 확정'}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-holo admin-notification-review"
              disabled={!canSend}
              onClick={() => setConfirmed(true)}
              type="button"
            >
              <Icon name="check" size={16} /> {pending ? '발송 처리 중' : '발송 내용 확인'}
            </button>
          )}
        </form>

        <aside aria-labelledby="notification-preview-heading" className="card admin-notification-preview">
          <div className="admin-notification-form-heading">
            <div>
              <span className="mono">PREVIEW</span>
              <h3 id="notification-preview-heading">사용자 알림 미리보기</h3>
            </div>
          </div>
          <article className="notification-row is-unread admin-notification-preview-card">
            <div className="notification-open">
              <span aria-hidden className="notification-type-icon">
                <Icon name="bell" size={20} />
              </span>
              <span className="notification-copy">
                <span className="notification-meta mono">
                  <span>공지</span>
                  <time>방금 전</time>
                </span>
                <strong>{title.trim() || '제목을 입력하면 여기에 보여요.'}</strong>
                <span>{body.trim() || '본문을 입력하면 사용자가 받을 알림 모양을 확인할 수 있어요.'}</span>
              </span>
              <span aria-hidden className="notification-unread-dot" />
            </div>
          </article>
          <p className="admin-notification-preview-note">링크는 알림함(<code>/notifications</code>)으로 고정됩니다.</p>
        </aside>
      </div>

      <section aria-labelledby="notification-history-heading" className="card admin-notification-history">
        <div className="admin-notification-history-heading">
          <div>
            <span className="mono">LATEST 20</span>
            <h3 id="notification-history-heading">최근 발송 이력</h3>
          </div>
          <span className="mono">{data.history.length}건</span>
        </div>

        {data.history.length === 0 ? (
          <p className="admin-notification-history-empty">아직 발송한 공지가 없습니다.</p>
        ) : (
          <ol className="admin-notification-history-list">
            {data.history.slice(0, 20).map((record) => (
              <li key={record.operationId}>
                <div className="admin-notification-history-meta">
                  <span className="mono">{audienceLabel(record)}</span>
                  <time dateTime={record.sentAt}>{historyDate.format(new Date(record.sentAt))}</time>
                </div>
                <strong>{record.title}</strong>
                <p>{record.body}</p>
                <div className="admin-notification-history-result">
                  <span>{record.actorName}</span>
                  <b>실제 {recipientNumber.format(record.recipientCount)}명</b>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

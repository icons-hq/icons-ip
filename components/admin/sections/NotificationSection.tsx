'use client';

import { useActionState, useState } from 'react';
import { sendAdminNotificationAction } from '@/app/admin/notification-actions';
import { Bell, Check, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/admin/kit/ui/alert';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { ErrorText } from '../fields';
import { AdminNotice } from '../console/AdminKit';
import { SECTION_CARD, SectionHeading } from './SectionLayout';
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

function counterClass(over: boolean) {
  return over ? 'text-xs tabular-nums text-destructive' : 'text-xs tabular-nums text-muted-foreground';
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

  /*
   * 작성 → 최종 확인 → 발송의 두 단계 흐름과 문구는 그대로다. 미리보기는 공개 알림함을 흉내 낸 어드민 카드라
   * kit 모양으로 그린다(공개 미리보기 부품이 아니다).
   */
  return (
    <section aria-labelledby="admin-notification-heading" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg leading-tight font-semibold tracking-tight text-foreground" id="admin-notification-heading">공지·알림 발송</h2>
          <p className="max-w-prose text-sm text-muted-foreground">전체 사용자 또는 특정 IP 팔로워에게 운영 공지를 보냅니다.</p>
        </div>
        <Badge variant="outline">인앱 전용</Badge>
      </header>

      <Alert role="note">
        <Info aria-hidden="true" />
        <AlertDescription>
          인앱 알림함에 즉시 발송됩니다. 이메일·푸시는 발송하지 않습니다. 수신자 수는 현재 기준 추정치이며 실제 수신자는 발송 시점에 확정됩니다.
        </AlertDescription>
      </Alert>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(17.5rem,0.72fr)]">
        <form
          action={action}
          className={SECTION_CARD}
          onSubmit={(event) => {
            if (confirmed && canSend) return;
            event.preventDefault();
            if (canSend) setConfirmed(true);
          }}
        >
          <input name="operationId" type="hidden" value={operationId} />

          <SectionHeading
            action={(
              <span aria-live="polite" className={audience?.canSend ? 'text-sm font-medium tabular-nums text-foreground' : 'text-sm font-medium text-destructive'}>
                {audience
                  ? `현재 추정 수신자 ${recipientNumber.format(audience.recipientCount)}명`
                  : '대상을 선택해주세요'}
              </span>
            )}
            title="발송 내용"
          />

          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="notification-scope">발송 대상</Label>
              <NativeSelect
                aria-describedby={state.errors?.scope ? 'notification-scope-error' : undefined}
                aria-invalid={Boolean(state.errors?.scope)}
                className="w-full"
                disabled={pending}
                id="notification-scope"
                name="scope"
                onChange={(event) => {
                  setScope(event.target.value as AdminNotificationScope);
                  setIpId('');
                  resetConfirmation();
                }}
                value={scope}
              >
                <NativeSelectOption value="all">전체 사용자</NativeSelectOption>
                <NativeSelectOption value="ip_followers">특정 IP 팔로워</NativeSelectOption>
              </NativeSelect>
              <ErrorText id="notification-scope-error">{state.errors?.scope}</ErrorText>
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="notification-ip">대상 IP</Label>
              <NativeSelect
                aria-describedby={state.errors?.ipId ? 'notification-ip-error' : undefined}
                aria-invalid={Boolean(state.errors?.ipId)}
                className="w-full"
                disabled={scope === 'all' || pending}
                id="notification-ip"
                name="ipId"
                onChange={(event) => {
                  setIpId(event.target.value);
                  resetConfirmation();
                }}
                required={scope === 'ip_followers'}
                value={ipId}
              >
                <NativeSelectOption value="">IP 선택</NativeSelectOption>
                {ipAudiences.map((candidate) => (
                  <NativeSelectOption key={candidate.ipId} value={candidate.ipId}>
                    {candidate.ipTitle ?? candidate.ipId} · {recipientNumber.format(candidate.recipientCount)}명
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <ErrorText id="notification-ip-error">{state.errors?.ipId}</ErrorText>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="notification-title">제목</Label>
              <span className={counterClass(titleLength > 120)}>{titleLength}/120</span>
            </div>
            <Input
              aria-describedby={state.errors?.title ? 'notification-title-error' : undefined}
              aria-invalid={Boolean(state.errors?.title) || titleLength > 120}
              disabled={pending}
              id="notification-title"
              name="title"
              onChange={(event) => {
                setTitle(event.target.value);
                resetConfirmation();
              }}
              placeholder="알림함에 보일 제목"
              required
              value={title}
            />
            <ErrorText id="notification-title-error">{state.errors?.title}</ErrorText>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="notification-body">본문</Label>
              <span className={counterClass(bodyLength > 500)}>{bodyLength}/500</span>
            </div>
            <Textarea
              aria-describedby={state.errors?.body ? 'notification-body-error' : undefined}
              aria-invalid={Boolean(state.errors?.body) || bodyLength > 500}
              className="min-h-36 resize-y"
              disabled={pending}
              id="notification-body"
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
            <ErrorText id="notification-body-error">{state.errors?.body}</ErrorText>
          </div>

          {!audience?.canSend && (
            <AdminNotice role="status" tone="warning">
              현재 대상에게 발송할 수 없습니다. 수신자가 1명 이상인지 확인해주세요.
            </AdminNotice>
          )}

          {state.errors?.form && (
            <AdminNotice role="alert" tone="danger">{state.errors.form}</AdminNotice>
          )}
          {state.message && state.recipientCount !== undefined && (
            <AdminNotice role="status" tone="success">실제 {recipientNumber.format(state.recipientCount)}명에게 발송했습니다.</AdminNotice>
          )}

          {confirmed ? (
            <div aria-label="즉시 발송 최종 확인" className="flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-soft p-3" role="group">
              <p className="text-sm font-medium text-destructive">
                예상 {recipientNumber.format(audience?.recipientCount ?? 0)}명에게 즉시 발송하며 회수할 수 없습니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={pending}
                  onClick={() => setConfirmed(false)}
                  type="button"
                  variant="outline"
                >
                  내용 다시 수정
                </Button>
                <Button disabled={!canSend} type="submit">
                  <Bell aria-hidden="true" /> {pending ? '발송 처리 중' : '즉시 발송 확정'}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="self-start"
              disabled={!canSend}
              onClick={() => setConfirmed(true)}
              type="button"
            >
              <Check aria-hidden="true" /> {pending ? '발송 처리 중' : '발송 내용 확인'}
            </Button>
          )}
        </form>

        <aside aria-labelledby="notification-preview-heading" className={`${SECTION_CARD} lg:sticky lg:top-16`}>
          <SectionHeading id="notification-preview-heading" title="사용자 알림 미리보기" />
          <article className="relative flex items-start gap-3 overflow-hidden rounded-lg border bg-background py-4 pr-4 pl-5" data-notification-preview="">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-info" />
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted text-info">
              <Bell className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-info">공지</span>
                <time>방금 전</time>
              </span>
              <strong className="text-sm leading-snug font-semibold break-words text-foreground">{title.trim() || '제목을 입력하면 여기에 보여요.'}</strong>
              <span className="text-sm break-words text-muted-foreground">{body.trim() || '본문을 입력하면 사용자가 받을 알림 모양을 확인할 수 있어요.'}</span>
            </span>
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-info max-sm:hidden" />
          </article>
          <p className="text-xs text-muted-foreground">링크는 알림함(<code className="rounded bg-muted px-1 py-0.5 font-mono">/notifications</code>)으로 고정됩니다.</p>
        </aside>
      </div>

      <section aria-labelledby="notification-history-heading" className={SECTION_CARD}>
        <SectionHeading
          action={<Badge className="tabular-nums" variant="secondary">{data.history.length}건</Badge>}
          id="notification-history-heading"
          title="최근 발송 이력"
        />

        {data.history.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">아직 발송한 공지가 없습니다.</p>
        ) : (
          <ol className="flex flex-col divide-y rounded-lg border">
            {data.history.slice(0, 20).map((record) => (
              <li className="flex min-w-0 flex-col gap-1.5 px-4 py-3" key={record.operationId}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{audienceLabel(record)}</span>
                  <time className="tabular-nums" dateTime={record.sentAt}>{historyDate.format(new Date(record.sentAt))}</time>
                </div>
                <strong className="text-sm font-semibold break-words text-foreground">{record.title}</strong>
                <p className="text-sm break-words text-muted-foreground">{record.body}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{record.actorName}</span>
                  <b className="font-medium text-foreground tabular-nums">실제 {recipientNumber.format(record.recipientCount)}명</b>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

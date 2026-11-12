'use client';

import { startTransition, useActionState, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteAdminDraftIpAction, type AdminIpDeleteActionState } from '@/app/admin/ip-delete-actions';
import {
  IP_DELETE_REFERENCE_KEYS,
  IP_DELETE_REFERENCE_LABELS,
  ipDeleteBlockers,
  type AdminIpDeleteReadiness,
} from '@/lib/admin/ip-delete';
import { AdminNotice } from './console/AdminKit';
import { Button } from './kit/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './kit/ui/alert-dialog';

const initialState: AdminIpDeleteActionState = {};
const CODE = 'rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground';

/** 삭제 판단 근거: 공개 이력과 연결 항목마다 센 건수. 0건도 그대로 보여 준다. */
function DeletionEvidence({ readiness }: { readiness: AdminIpDeleteReadiness }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3" data-ip-delete-evidence="">
      <div className="flex min-w-0 justify-between gap-2">
        <dt className="text-muted-foreground">공개 이력</dt>
        <dd className={readiness.publicHistory ? 'font-medium text-destructive' : 'font-medium'}>{readiness.publicHistory ? '있음' : '없음'}</dd>
      </div>
      {IP_DELETE_REFERENCE_KEYS.filter((key) => key !== 'other' || readiness.references.other > 0).map((key) => (
        <div className="flex min-w-0 justify-between gap-2" key={key}>
          <dt className="text-muted-foreground">{IP_DELETE_REFERENCE_LABELS[key]}</dt>
          <dd className={`tabular-nums ${readiness.references[key] > 0 ? 'font-medium text-destructive' : 'font-medium'}`}>
            {readiness.references[key].toLocaleString('ko-KR')}건
          </dd>
        </div>
      ))}
    </dl>
  );
}

/*
 * 미사용 IP 초안 삭제(S36-004 · ADR-0039). 공개된 적 없고 연결된 항목이 0건인 초안만 지운다.
 * 보관과 달리 되돌릴 수 없어 확인창에서 참조 0건 근거를 다시 보여 주고, 실제 판정·감사는 DB가 한다.
 */
export function IpDraftDeleteControl({ canDelete, readiness }: { canDelete: boolean; readiness: AdminIpDeleteReadiness }) {
  const [state, formAction, pending] = useActionState(deleteAdminDraftIpAction, initialState);
  const [open, setOpen] = useState(false);
  const blockers = ipDeleteBlockers(readiness);
  const deletable = readiness.deletable && blockers.length === 0;
  const titleId = `ip-draft-delete-${readiness.id}`;

  const confirm = () => {
    const formData = new FormData();
    formData.set('id', readiness.id);
    setOpen(false);
    startTransition(() => formAction(formData));
  };

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground"
      data-ip-draft-delete={deletable ? 'deletable' : 'blocked'}
    >
      <h2 className="text-base leading-snug font-medium" id={titleId}>미사용 초안 삭제</h2>
      <p className="text-sm text-muted-foreground">
        공개된 적이 없고 연결된 항목이 없는 테스트 초안만 완전히 지울 수 있습니다. 지우면 되돌릴 수 없고,
        내부 ID <code className={CODE}>{readiness.id}</code>는 다시 쓰지 않습니다. 삭제 기록은 감사 로그에 남습니다.
      </p>
      <DeletionEvidence readiness={readiness} />
      {blockers.length ? (
        <AdminNotice tone="warning" title="삭제할 수 없습니다">
          <ul className="flex flex-col gap-1">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </AdminNotice>
      ) : null}
      {deletable && !canDelete ? (
        <p className="text-sm text-muted-foreground">미사용 IP 삭제는 관리자(admin)만 할 수 있습니다.</p>
      ) : null}
      {state.errors?.form ? <AdminNotice role="alert" tone="danger">{state.errors.form}</AdminNotice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!deletable || !canDelete || pending} onClick={() => setOpen(true)} variant="destructive">
          <Trash2 aria-hidden="true" /> {pending ? '삭제 중' : '삭제'}
        </Button>
      </div>
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>‘{readiness.title}’ IP를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              되돌릴 수 없습니다. 공개된 적이 없고 연결된 항목이 0건인 것을 확인했습니다.
              내부 ID {readiness.id}는 다시 발급하지 않고, 삭제한 내용은 감사 로그에 남습니다.
              {readiness.aliases.length ? ` 공개된 적 없는 이전 공개 URL ${readiness.aliases.length}개(${readiness.aliases.join(', ')})도 함께 지웁니다.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <DeletionEvidence readiness={readiness} />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} variant="danger">삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

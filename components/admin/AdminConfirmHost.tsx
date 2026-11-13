'use client';

import { useEffect, useRef, useState } from 'react';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { AdminKitPortalContainerProvider } from './kit/portal-container';
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
import { Label } from './kit/ui/label';
import { Textarea } from './kit/ui/textarea';

interface PendingConfirm {
  id: number;
  request: AdminConfirmRequest;
  /** 확인을 요청한 곳이 네이티브 모달 dialog 안이면 그 dialog. 그 밖에서는 body의 팝업 호스트를 쓴다. */
  container?: HTMLElement;
  resolve: (confirmed: boolean) => void;
  settled: boolean;
}

/**
 * `showModal()`로 열린 dialog는 top layer라 body에 붙은 팝업이 그 뒤에 가려진다. 요청한 곳(포커스가 있는 곳)이
 * 모달 dialog 안이면 확인창도 그 안에 띄운다. 모달이 여러 겹이면 포커스가 있는 가장 안쪽이다.
 */
function openModalDialog(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const modalSelector = 'dialog[open]:modal';
  try {
    const focused = document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>(modalSelector) : null;
    if (focused) return focused;
    return Array.from(document.querySelectorAll<HTMLElement>(modalSelector)).at(-1);
  } catch {
    return undefined;
  }
}

/*
 * 어드민 확인창 호스트. 셸에 한 번만 둔다(`lib/admin/confirm.ts`).
 * 확인 버튼은 약속을 한 번만 풀고(이중 클릭·Enter 연타가 실행을 두 번 만들지 않는다), 취소·Esc·바깥 클릭은 모두 취소다.
 * 요청이 겹치면 순서대로 하나씩 보여 준다.
 */
export function AdminConfirmHost() {
  const [current, setCurrent] = useState<PendingConfirm | null>(null);
  const queue = useRef<PendingConfirm[]>([]);
  const active = useRef<PendingConfirm | null>(null);
  const nextId = useRef(0);
  const [text, setText] = useState('');

  useEffect(() => {
    const unregister = setAdminConfirmHandler((request) => new Promise<boolean>((resolve) => {
      const pending: PendingConfirm = { id: nextId.current++, request, resolve, settled: false, container: openModalDialog() };
      if (active.current) queue.current.push(pending);
      else { active.current = pending; setText(''); setCurrent(pending); }
    }));
    return () => {
      unregister();
      for (const pending of [active.current, ...queue.current]) {
        if (pending && !pending.settled) { pending.settled = true; pending.resolve(false); }
      }
      queue.current = [];
      active.current = null;
    };
  }, []);

  function settle(pending: PendingConfirm, result: boolean) {
    if (pending.settled) return;
    pending.settled = true;
    pending.resolve(result);
    if (active.current !== pending) return;
    const next = queue.current.shift() ?? null;
    active.current = next;
    setText('');
    setCurrent(next);
  }

  if (!current) return null;
  const { request } = current;
  const input = request.input;
  const inputId = `admin-confirm-input-${current.id}`;
  const length = [...text.trim()].length;
  const inputInvalid = Boolean(input) && (length < (input?.minLength ?? 0) || length > (input?.maxLength ?? Number.MAX_SAFE_INTEGER));
  return (
    <AdminKitPortalContainerProvider container={current.container} key={current.id}>
    <AlertDialog open onOpenChange={(open) => { if (!open) settle(current, false); }}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg" data-admin-confirm="">
        <AlertDialogHeader>
          <AlertDialogTitle>{request.title ?? '확인'}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line text-foreground">{request.message}</AlertDialogDescription>
        </AlertDialogHeader>
        {input ? <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>{input.label}</Label>
          <Textarea autoFocus id={inputId} onChange={event => setText(event.target.value)} placeholder={input.placeholder} rows={3} value={text} />
          {input.minLength || input.maxLength ? <p className="text-xs text-muted-foreground tabular-nums">{length}자{input.minLength && input.maxLength ? ` · ${input.minLength}~${input.maxLength}자` : input.maxLength ? ` · 최대 ${input.maxLength}자` : ` · ${input.minLength}자 이상`}</p> : null}
        </div> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{request.cancelLabel ?? '취소'}</AlertDialogCancel>
          <AlertDialogAction disabled={inputInvalid} onClick={() => { if (input) request.receive?.(text.trim()); settle(current, true); }} variant={request.destructive ? 'danger' : 'default'}>{request.confirmLabel ?? '확인'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </AdminKitPortalContainerProvider>
  );
}

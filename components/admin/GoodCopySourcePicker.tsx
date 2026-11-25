'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { AdminGoodsPicker } from './AdminGoodsPicker';

export function GoodCopySourcePicker({ accountId, disabledReason = '' }: { accountId: string; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  /* 첫 화면을 필수 입력에 돌리려고 카드 대신 화면 머리의 버튼 하나로 둔다. 머리 줄은 오른쪽으로 붙으므로 안내는 버튼 왼쪽에 나와 버튼을 밀지 않는다. 재고 0·KC 재검토 안내는 복사 팝업이 보여 준다. */
  return <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm" aria-label="기존 상품으로 복사등록" data-good-copy-entry="" role="group">
    {disabledReason ? <p className="text-xs text-muted-foreground" role="status">{disabledReason}</p> : null}
    <Button type="button" variant="outline" size="sm" disabled={Boolean(disabledReason)} onClick={() => setOpen(true)}><Copy aria-hidden="true" />기존 상품으로 복사등록</Button>
    {open ? <GoodCopySourceDialog accountId={accountId} blocked={Boolean(disabledReason)} onClose={() => setOpen(false)} /> : null}
  </div>;
}

/** 복사할 상품 고르기. 공용 상품 선택창(화면 규칙 1)을 쓰고, 고르면 그 상품의 복사 설정으로 이동한다. */
export function GoodCopySourceDialog({ accountId, blocked, onClose }: { accountId: string; blocked: boolean; onClose: () => void }) {
  return <AdminGoodsPicker
    accountId={accountId}
    blockedReason={blocked ? '현재 입력을 저장하는 중이라 지금은 고를 수 없습니다. 저장이 끝난 뒤 다시 열어주세요.' : null}
    description="보관하지 않은 상품을 등록일 최신순으로 20개씩 보여 줍니다. [복사 설정]을 누르면 그 상품의 복사 설정으로 이동하고, 거기서 [새 초안으로 복사]를 눌러야 새 상품이 만들어집니다. 복사한 상품은 재고 0으로 시작하고 KC를 다시 검토합니다."
    onClose={onClose}
    onSelect={() => undefined}
    rowAction={(good, { busy }) => busy
      ? <span className="text-xs text-muted-foreground">잠시만요</span>
      : <Link aria-label={`${good.name} 복사 설정 열기`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={`/admin/catalog/goods?goodId=${encodeURIComponent(good.id)}#good-operation-clone`} onClick={onClose} prefetch={false}>복사 설정</Link>}
    title="복사할 상품 선택"
  />;
}

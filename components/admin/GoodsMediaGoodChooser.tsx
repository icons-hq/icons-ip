'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdminGoodsPicker } from '@/components/admin/AdminGoodsPicker';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { GOODS_MEDIA_PATH } from '@/lib/goods-media';

/**
 * 상품 없이 연 동영상·숏클립 화면(화면 규칙 1). 안내 글 대신 공용 상품 선택창을 바로 연다 —
 * 상품을 고르면 그 상품의 동영상·숏클립 화면(`?goodId=`)으로 이동한다. 창은 이동이 끝날 때까지 열려 있다.
 */
export function GoodsMediaGoodChooser() {
  const [open, setOpen] = useState(false);
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="goods-media">
    <AdminPageHeader
      actions={<Button onClick={() => setOpen(true)} type="button">상품 고르기</Button>}
      description="동영상·숏클립을 등록할 상품을 먼저 고릅니다."
      title="상품 동영상·숏클립"
    />
    {open ? <AdminGoodsPicker
      description="고르면 그 상품의 동영상·숏클립 화면으로 이동합니다."
      excludedNote="보관한 상품은 목록에서 뺐습니다."
      onClose={() => setOpen(false)}
      onSelect={() => undefined}
      rowAction={(good) => <Link aria-label={`${good.name} 선택`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={`${GOODS_MEDIA_PATH}?goodId=${encodeURIComponent(good.id)}`} prefetch={false}>선택</Link>}
      title="상품 고르기"
    /> : null}
  </section>;
}

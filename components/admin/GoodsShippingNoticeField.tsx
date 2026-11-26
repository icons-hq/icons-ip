'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { adminPickerLocalLoader } from '@/lib/admin/picker';
import { SHIPPING_NOTICE_TEMPLATES_PATH } from '@/lib/admin/shipping-notice-templates';
import type { ShippingNoticeSnapshot } from '@/lib/fulfillment';
import { AdminPickedBox, useAdminPickedValue } from './AdminPickedValue';
import { AdminField } from './console/AdminKit';

export type GoodsShippingNoticeOption = Omit<ShippingNoticeSnapshot, 'templateId'> & { id: string };

const DISPLAY_ID = 'good-shipping-notice-display';
const LABEL = '배송·교환·반품 안내 템플릿';
/** 템플릿을 고르지 않은 상품이 쓰는 안내의 이름. 편집기의 접힌 줄 요약과 같은 말이다. */
const DEFAULT_NOTICE = '기본 안내';
/** 제출 값. 코드와 버전은 운영자가 할 일이 없는 내부 값이라 화면에는 이름만 보인다(화면 규칙 8). */
const noticeValue = (option: GoodsShippingNoticeOption) => `${option.code}@${option.version}`;
const noticeText = (option: GoodsShippingNoticeOption) => option.name;

/** 선택창 한 줄: 이름 아래에 배송 안내 첫 줄을 보여 이름이 같은 템플릿을 내용으로 가린다. */
export function shippingNoticeRowView(option: GoodsShippingNoticeOption): AdminPickerRowView {
  const first = Array.from(option.shippingNotice.trim().split('\n')[0]?.trim() ?? '');
  return { title: option.name, meta: first.length ? `${first.slice(0, 40).join('')}${first.length > 40 ? '…' : ''}` : undefined };
}

/**
 * 상품 상세의 배송·교환·반품 안내 글(템플릿)을 고른다. 공용 선택창에서 고르고(화면 규칙 1), 값은 숨은 칸 name="shippingNoticeTemplate"가
 * `코드@버전`으로 제출한다. 고르면 그 칸에서 input 이벤트가 나가 편집기가 접힌 줄 요약과 미리보기를 새 안내로 바꾼다.
 * 선택창에는 지금 고를 수 있는 템플릿(`options`)만 나온다. `currentName`은 지금 상품에 적용 중인 안내의 이름이다 —
 * 목록에 없는 예전 안내가 적용 중이어도 바꾸지 않으면 그대로 제출해 저장 뒤에도 이어진다.
 * 그 안내는 선택창으로 다시 고를 수 없으므로, 다른 것으로 바꾼 동안에는 [원래 안내로]를 보여 되돌릴 길을 남긴다(화면 규칙 7).
 * `savedValue`는 상품에 저장돼 있는 값이다. 저장에 실패해 폼을 다시 그린 뒤에도 되돌릴 곳을 잃지 않게 따로 받는다(주지 않으면 `value`).
 */
export function GoodsShippingNoticeField({ options, value, error, currentName, savedValue = value }: {
  options: GoodsShippingNoticeOption[]; value: string; error?: string; currentName?: string | null; savedValue?: string;
}) {
  const { value: picked, setValue, inputRef } = useAdminPickedValue(value);
  const [open, setOpen] = useState(false);
  const listed = options.find((option) => noticeValue(option) === picked);
  /* 목록에 없는 값은 저장돼 있던 예전 안내뿐이다(선택창은 목록에 있는 것만 고르게 한다). */
  const unlisted = Boolean(picked) && !listed;
  /* 저장돼 있던 안내가 목록에 없는데 지금 다른 것을 골라 둔 상태. 이때만 [원래 안내로]가 보인다. */
  const canRestore = Boolean(savedValue) && picked !== savedValue && !options.some((option) => noticeValue(option) === savedValue);
  const text = !picked ? DEFAULT_NOTICE : listed ? listed.name : currentName || '지금 적용 중인 안내';
  return <div className="flex min-w-0 flex-col gap-2" data-goods-shipping-notice="">
    <AdminField error={error} inputId={DISPLAY_ID} label={LABEL}>
      <AdminPickedBox inputId={DISPLAY_ID} inputRef={inputRef} invalid={Boolean(error)} name="shippingNoticeTemplate" onOpen={() => setOpen(true)}
        pickLabel="템플릿 고르기" placeholder={DEFAULT_NOTICE} text={text} value={picked}>
        {picked ? <button className={buttonVariants({ variant: 'outline' })} data-slot="button" onClick={() => setValue('')} type="button">기본 안내로 되돌리기</button> : null}
        {canRestore ? <button className={buttonVariants({ variant: 'outline' })} data-goods-shipping-notice-restore="" data-slot="button" onClick={() => setValue(savedValue)} type="button">원래 안내로</button> : null}
        <Link className="text-sm underline underline-offset-4" href={SHIPPING_NOTICE_TEMPLATES_PATH} rel="noreferrer" target="_blank">배송 안내 템플릿 관리 ↗</Link>
      </AdminPickedBox>
    </AdminField>
    {unlisted ? <p className="text-xs text-muted-foreground" data-goods-shipping-notice-unlisted="">지금 적용 중인 안내는 템플릿 목록에 없습니다. 바꾸지 않으면 저장해도 그대로 유지됩니다.</p>
      : canRestore ? <p className="text-xs text-muted-foreground" data-goods-shipping-notice-replaced="">{`원래 쓰던 안내${currentName ? `(${currentName})` : ''}는 템플릿 목록에 없어 [템플릿 고르기]로는 다시 고를 수 없습니다. 되돌리려면 [원래 안내로]를 누릅니다.`}</p> : null}
    {open ? <AdminPickerDialog<GoodsShippingNoticeOption>
      description="고르면 상품 상세의 배송·교환·반품 안내 글이 바뀝니다. 배송비와 회수 주소는 출고지 설정을 따릅니다."
      emptyText="맞는 템플릿이 없습니다. 템플릿은 ‘배송 안내 템플릿 관리’에서 만듭니다."
      excludedNote="확인이 끝나지 않은 템플릿은 목록에서 뺐습니다."
      load={adminPickerLocalLoader(options, { textOf: noticeText })}
      onClose={() => setOpen(false)}
      onSelect={(option) => { setValue(noticeValue(option)); }}
      rowKey={noticeValue}
      rowView={shippingNoticeRowView}
      searchPlaceholder="템플릿 이름으로 찾기"
      selectedKeys={listed ? [noticeValue(listed)] : undefined}
      title="배송·교환·반품 안내 템플릿 고르기"
    /> : null}
  </div>;
}

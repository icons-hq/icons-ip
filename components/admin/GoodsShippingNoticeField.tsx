'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { listShippingNoticeTemplateOptionsAction } from '@/app/admin/shipping-notice-template-actions';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { adminPickerLocalPage, type AdminPickerLoader } from '@/lib/admin/picker';
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

/**
 * 선택창이 목록을 다시 읽었을 때, 읽기 전 목록에 있던 줄 가운데 새 목록에서 사라지고 같은 코드의 다른 버전이 대신 있는 줄(코드@버전).
 * 이 화면을 연 뒤에 그 템플릿이 고쳐졌다는 뜻이다 — 화면을 열 때부터 옛 내용을 들고 있던 상품은 이 목록에 들어가지 않는다.
 */
export function shippingNoticeStaleValues(before: GoodsShippingNoticeOption[], after: GoodsShippingNoticeOption[]): string[] {
  const now = new Set(after.map(noticeValue));
  return before.filter((option) => !now.has(noticeValue(option)) && after.some((next) => next.code === option.code)).map(noticeValue);
}

/** 선택창 한 줄: 이름 아래에 배송 안내 첫 줄을 보여 이름이 같은 템플릿을 내용으로 가린다. */
export function shippingNoticeRowView(option: GoodsShippingNoticeOption): AdminPickerRowView {
  const first = Array.from(option.shippingNotice.trim().split('\n')[0]?.trim() ?? '');
  return { title: option.name, meta: first.length ? `${first.slice(0, 40).join('')}${first.length > 40 ? '…' : ''}` : undefined };
}

/**
 * 상품 상세의 배송·교환·반품 안내 글(템플릿)을 고른다. 공용 선택창에서 고르고(화면 규칙 1), 값은 숨은 칸 name="shippingNoticeTemplate"가
 * `코드@버전`으로 제출한다. 고르면 그 칸에서 input 이벤트가 나가 편집기가 접힌 줄 요약과 미리보기를 새 안내로 바꾼다.
 * 선택창에는 지금 고를 수 있는 템플릿만 나온다(템플릿마다 지금 내용 하나). 처음 목록은 화면을 열 때 받은 `options`이고,
 * 선택창을 열 때마다 목록을 다시 읽어 다른 탭에서 방금 만들거나 고친 템플릿도 새로고침 없이 보인다.
 * 다시 읽은 목록은 `onOptionsChange`로 알린다 — 편집기가 요약과 미리보기에 같은 목록을 쓰게 한다.
 * `currentName`은 지금 상품에 적용 중인 안내의 이름이다 — 목록에 없는 예전 안내가 적용 중이어도 바꾸지 않으면 그대로 제출해 저장 뒤에도 이어진다.
 * 그 안내는 선택창으로 다시 고를 수 없으므로, 다른 것으로 바꾼 동안에는 [원래 안내로]를 보여 되돌릴 길을 남긴다(화면 규칙 7).
 * `savedValue`는 상품에 저장돼 있는 값이다. 저장에 실패해 폼을 다시 그린 뒤에도 되돌릴 곳을 잃지 않게 따로 받는다(주지 않으면 `value`).
 * 같은 템플릿의 옛 내용이 남아 있는 경우는 둘이고 안내가 다르다. (a) 화면을 열 때부터 상품이 옛 내용을 들고 있다(보관했다 복원한 상품 등) —
 * 상품을 저장하면 지금 내용으로 바뀐다. (b) 화면을 연 뒤 다른 곳에서 템플릿을 고쳤다 — 템플릿을 고치면 그 템플릿을 쓰는 상품이 그 자리에서 따라가므로
 * 이 상품에는 이미 새 내용이 적용돼 있고, 이 화면의 저장은 다른 사람이 먼저 바꿨다고 막힌다. 선택창이 목록을 다시 읽을 때 읽기 전 목록과 견줘 (b)를 가른다.
 */
export function GoodsShippingNoticeField({ options, value, error, currentName, savedValue = value, onOptionsChange }: {
  options: GoodsShippingNoticeOption[]; value: string; error?: string; currentName?: string | null; savedValue?: string;
  onOptionsChange?: (options: GoodsShippingNoticeOption[]) => void;
}) {
  const { value: picked, setValue, inputRef } = useAdminPickedValue(value);
  const [open, setOpen] = useState(false);
  /*
   * 선택창을 열 때 다시 읽은 목록. 화면이 준 목록(`base`)이 바뀌면(저장 뒤 다시 그린 화면) 그쪽이 더 새것이라 버린다.
   * 편집기가 `onOptionsChange`로 받은 목록을 그대로 `options`로 돌려주면 같은 목록이므로 그대로 쓴다.
   */
  const [fresh, setFresh] = useState<{ base: GoodsShippingNoticeOption[]; list: GoodsShippingNoticeOption[]; pendingCount: number; stale: string[] } | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  /* 선택창을 한 번 여는 동안의 조회. 그 창의 검색·페이지 이동은 같은 목록을 쓴다. */
  const reading = useRef<Promise<GoodsShippingNoticeOption[]> | null>(null);
  const current = fresh && (fresh.base === options || fresh.list === options) ? fresh : null;
  const list = current ? current.list : options;
  function readFresh(): Promise<GoodsShippingNoticeOption[]> {
    reading.current ??= listShippingNoticeTemplateOptionsAction().then((result) => {
      if (!result?.ok) { setRefreshFailed(true); return list; }
      /* 화면을 연 뒤 고쳐진 템플릿(읽기 전 목록의 줄이 새 목록에서 다른 버전으로 바뀜)을 기억한다. 같은 목록을 계속 쓰는 동안 이어진다. */
      setFresh({ base: options, list: result.options, pendingCount: result.pendingCount, stale: [...new Set([...(current?.stale ?? []), ...shippingNoticeStaleValues(list, result.options)])] });
      setRefreshFailed(false);
      onOptionsChange?.(result.options);
      return result.options;
    }).catch(() => { setRefreshFailed(true); return list; });
    return reading.current;
  }
  const load: AdminPickerLoader<GoodsShippingNoticeOption> = async (request) => adminPickerLocalPage(await readFresh(), request, { textOf: noticeText });
  const listed = list.find((option) => noticeValue(option) === picked);
  /* 목록에 없는 값은 저장돼 있던 예전 안내뿐이다(선택창은 목록에 있는 것만 고르게 한다). */
  const unlisted = Boolean(picked) && !listed;
  /* 같은 템플릿을 그 뒤에 고쳤는데 고른 값은 고치기 전 버전인 경우. 상품을 저장하면 DB가 그 템플릿의 지금 내용을 적용한다(옛 버전 번호가 실려 가도 같다). */
  const outdated = unlisted && list.some((option) => option.code === picked.split('@')[0]);
  /* 위 경우 가운데 이 화면을 연 뒤 템플릿이 고쳐진 경우(b). 고른 값이 상품에 저장돼 있던 값이면 상품에는 이미 새 내용이 적용돼 있다. */
  const editedAfterOpen = outdated && (current?.stale ?? []).includes(picked);
  const appliedAlready = editedAfterOpen && picked === savedValue;
  /* 저장돼 있던 안내가 목록에 없는데 지금 다른 것을 골라 둔 상태. 이때만 [원래 안내로]가 보인다. */
  const canRestore = Boolean(savedValue) && picked !== savedValue && !list.some((option) => noticeValue(option) === savedValue);
  /* 상품이 쓰던 안내가 아니라 방금 고른 템플릿이 고쳐졌으면, 상품에 들어갈 지금 내용의 이름을 보인다. */
  const text = !picked ? DEFAULT_NOTICE : listed ? listed.name : editedAfterOpen && !appliedAlready ? list.find((option) => option.code === picked.split('@')[0])?.name ?? '지금 적용 중인 안내' : currentName || '지금 적용 중인 안내';
  return <div className="flex min-w-0 flex-col gap-2" data-goods-shipping-notice="">
    <AdminField error={error} inputId={DISPLAY_ID} label={LABEL}>
      <AdminPickedBox inputId={DISPLAY_ID} inputRef={inputRef} invalid={Boolean(error)} name="shippingNoticeTemplate" onOpen={() => { reading.current = null; setOpen(true); }}
        pickLabel="템플릿 고르기" placeholder={DEFAULT_NOTICE} text={text} value={picked}>
        {picked ? <button className={buttonVariants({ variant: 'outline' })} data-slot="button" onClick={() => setValue('')} type="button">기본 안내로 되돌리기</button> : null}
        {canRestore ? <button className={buttonVariants({ variant: 'outline' })} data-goods-shipping-notice-restore="" data-slot="button" onClick={() => setValue(savedValue)} type="button">원래 안내로</button> : null}
        <Link className="text-sm underline underline-offset-4" href={SHIPPING_NOTICE_TEMPLATES_PATH} rel="noreferrer" target="_blank">배송 안내 템플릿 관리 ↗</Link>
      </AdminPickedBox>
    </AdminField>
    {appliedAlready ? <p className="text-xs text-muted-foreground" data-goods-shipping-notice-edited="" role="status">이 템플릿이 방금 고쳐졌습니다. 이 상품에는 이미 새 내용이 적용됐습니다. 화면을 새로고침한 뒤 이어서 고쳐 주세요.</p>
      : editedAfterOpen ? <p className="text-xs text-muted-foreground" data-goods-shipping-notice-edited="" role="status">고른 템플릿이 방금 고쳐졌습니다. 상품을 저장하면 지금 내용이 적용됩니다.</p>
      : outdated ? <p className="text-xs text-muted-foreground" data-goods-shipping-notice-outdated="">이 상품에는 템플릿을 고치기 전 내용이 적용돼 있습니다. 상품을 저장하면 지금 내용으로 바뀝니다.</p>
      : unlisted ? <p className="text-xs text-muted-foreground" data-goods-shipping-notice-unlisted="">지금 적용 중인 안내는 템플릿 목록에 없습니다. 바꾸지 않으면 저장해도 그대로 유지됩니다.</p>
        : canRestore ? <p className="text-xs text-muted-foreground" data-goods-shipping-notice-replaced="">{`원래 쓰던 안내${currentName ? `(${currentName})` : ''}는 템플릿 목록에 없어 [템플릿 고르기]로는 다시 고를 수 없습니다. 되돌리려면 [원래 안내로]를 누릅니다.`}</p> : null}
    {open ? <AdminPickerDialog<GoodsShippingNoticeOption>
      description="고르면 상품 상세의 배송·교환·반품 안내 글이 바뀝니다. 배송비와 반품 주소는 바뀌지 않습니다."
      emptyText="맞는 템플릿이 없습니다. 템플릿은 ‘배송 안내 템플릿 관리’에서 만듭니다."
      excludedNote={current?.pendingCount ? '준비 중인 템플릿은 목록에서 뺐습니다. ‘배송 안내 템플릿 관리’에서 [수정]을 눌러 저장하면 고를 수 있습니다.' : undefined}
      footer={refreshFailed ? <p className="text-xs text-muted-foreground" data-goods-shipping-notice-stale="" role="status">목록을 새로 읽지 못해 이 화면을 열 때의 목록을 보여 줍니다. 방금 만든 템플릿이 안 보이면 창을 닫고 다시 열어 주세요.</p> : undefined}
      load={load}
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

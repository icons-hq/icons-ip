import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { AdminCreateDialogButton } from '@/components/admin/console/AdminCreateDialogButton';
import { CONSOLE_FILTER_CARD_CLASS, CONSOLE_FILTER_FIELDS_CLASS, ConsoleFilterActions, ConsoleFilterField } from '@/components/admin/console/ConsoleFilterPanel';
import { CONSOLE_LIST_EMPTY_CLASS, ConsoleListCard } from '@/components/admin/console/ConsoleListCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import {
  GOODS_NOTICE_PRESET_NAME_MAX, GOODS_NOTICE_PRESET_PAGE_SIZE, GOODS_NOTICE_PRESETS_PATH,
  goodsNoticePresetHref, type GoodsNoticePresetPageData,
} from '@/lib/admin/goods-notice-presets';
import { GoodsNoticePresetDeleteForm, GoodsNoticePresetForm } from './GoodsNoticePresetForm';

const SUMMARY = 'flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden';

/* 템플릿 화면군 공통 골격: 머리(설명·등록) → 조회 카드 → 목록 카드(항목·페이지 이동). 등록은 머리 오른쪽 버튼의 팝업이다. */
export function GoodsNoticePresetsScreen({ data }: { data: GoodsNoticePresetPageData }) {
  const { presets, filters, total } = data;
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="notice-presets">
    <AdminPageHeader title="상품정보제공고시 템플릿 관리" description="자주 사용하는 제조사·소재·A/S 정보를 이름으로 저장합니다. 기존 상품에 입력된 값은 바뀌지 않습니다."
      actions={<AdminCreateDialogButton label="새 프리셋 등록" title="새 프리셋 등록" wide><GoodsNoticePresetForm inset={false} /></AdminCreateDialogButton>} />
    <form action={GOODS_NOTICE_PRESETS_PATH} className={CONSOLE_FILTER_CARD_CLASS}>
      <div className={CONSOLE_FILTER_FIELDS_CLASS}>
        <ConsoleFilterField className="w-full sm:w-80" htmlFor="notice-preset-query" label="프리셋 이름 검색"><Input id="notice-preset-query" name="q" type="search" defaultValue={filters.query} maxLength={GOODS_NOTICE_PRESET_NAME_MAX} placeholder="프리셋 이름" /></ConsoleFilterField>
      </div>
      <ConsoleFilterActions>
        {filters.query ? <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={GOODS_NOTICE_PRESETS_PATH}>전체 프리셋 보기</Link> : null}
        <Button type="submit">검색</Button>
      </ConsoleFilterActions>
    </form>
    <ConsoleListCard title="목록" total={total} unit="개" description="이름을 열어 7개 항목을 수정할 수 있습니다.">
      {presets.length ? <div className="flex flex-col overflow-hidden rounded-lg border" data-notice-presets="entries">
        {presets.map((preset) => <details key={preset.id} className="group/entry border-b last:border-b-0 open:bg-muted/20">
          <summary className={SUMMARY}><span className="flex min-w-0 flex-col gap-0.5 wrap-anywhere sm:flex-row sm:items-baseline sm:gap-4"><strong className="font-medium">{preset.name}</strong><span className="text-sm text-muted-foreground">{preset.notice.maker} · {preset.notice.origin}</span></span><ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/entry:rotate-180" /></summary>
          <div className="border-t bg-card"><GoodsNoticePresetForm preset={preset} /><GoodsNoticePresetDeleteForm preset={preset} /></div>
        </details>)}
      </div> : <p className={CONSOLE_LIST_EMPTY_CLASS}>{filters.query ? '조건에 맞는 프리셋이 없습니다.' : '아직 등록된 프리셋이 없습니다. 새 프리셋을 등록해주세요.'}</p>}
      <ConsolePagination page={filters.page} pageSize={GOODS_NOTICE_PRESET_PAGE_SIZE} total={total} hrefForPage={(page) => goodsNoticePresetHref(filters, page)} />
    </ConsoleListCard>
  </section>;
}

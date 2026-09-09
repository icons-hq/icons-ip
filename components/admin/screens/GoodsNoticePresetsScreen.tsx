import Link from 'next/link';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import {
  GOODS_NOTICE_PRESET_NAME_MAX, GOODS_NOTICE_PRESET_PAGE_SIZE, GOODS_NOTICE_PRESETS_PATH,
  goodsNoticePresetHref, type GoodsNoticePresetPageData,
} from '@/lib/admin/goods-notice-presets';
import { GoodsNoticePresetDeleteForm, GoodsNoticePresetForm } from './GoodsNoticePresetForm';

export function GoodsNoticePresetsScreen({ data }: { data: GoodsNoticePresetPageData }) {
  const { presets, filters, total } = data;
  return <section className="wc-admin-kit admin-notice-presets">
    <AdminPageHeader title="상품정보제공고시 프리셋" description="자주 사용하는 제조사·소재·A/S 정보를 이름으로 저장합니다. 기존 상품에 입력된 값은 바뀌지 않습니다." />
    <details className="admin-notice-presets__create">
      <summary>새 프리셋 등록</summary><GoodsNoticePresetForm />
    </details>
    <form action={GOODS_NOTICE_PRESETS_PATH} className="admin-notice-presets__search">
      <label htmlFor="notice-preset-query">프리셋 이름 검색</label>
      <div><input id="notice-preset-query" name="q" type="search" defaultValue={filters.query} maxLength={GOODS_NOTICE_PRESET_NAME_MAX} placeholder="프리셋 이름" />
        <button className="wc-admin-kit__button" type="submit">검색</button>
        {filters.query ? <Link href={GOODS_NOTICE_PRESETS_PATH}>전체 프리셋 보기</Link> : null}</div>
    </form>
    <p className="admin-notice-presets__count">총 {total.toLocaleString('ko-KR')}개 · 이름을 열어 7개 항목을 수정할 수 있습니다.</p>
    {presets.length ? <div className="admin-notice-presets__entries">
      {presets.map((preset) => <details key={preset.id} className="admin-notice-presets__entry">
        <summary><strong>{preset.name}</strong><span>{preset.notice.maker} · {preset.notice.origin}</span></summary>
        <GoodsNoticePresetForm preset={preset} /><GoodsNoticePresetDeleteForm preset={preset} />
      </details>)}
    </div> : <p className="admin-notice-presets__empty">{filters.query ? '조건에 맞는 프리셋이 없습니다.' : '아직 등록된 프리셋이 없습니다. 새 프리셋을 등록해주세요.'}</p>}
    <ConsolePagination page={filters.page} pageSize={GOODS_NOTICE_PRESET_PAGE_SIZE} total={total} hrefForPage={(page) => goodsNoticePresetHref(filters, page)} />
  </section>;
}

'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  archiveCategoryAction,
  moveCategoryAction,
  reorderCategoriesAction,
  reorderCategoryGoodsAction,
  setCategoryGoodDisplayWindowAction,
  syncErpCategoriesAction,
  upsertCategoryAction,
} from '@/app/admin/category-actions';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import {
  ADMIN_CATEGORY_NEW_RECORD,
  CATEGORY_AUTO_SORT_KEYS,
  CATEGORY_DISPLAY_MODES,
  CATEGORY_KINDS,
  CATEGORY_MAX_DEPTH,
  CATEGORY_STATUSES,
  GOOD_SALE_STATE_LABELS,
  adminCategoryHref,
  buildCategoryTree,
  categoryParentOptions,
  categoryPathLabel,
  flattenCategoryTree,
  isErpCategory,
  isErpLeafCategory,
  type AdminCategory,
  type AdminCategoryFilters,
  type AdminCategoryNode,
} from '@/lib/admin/categories';
import type { AdminCategoryGoodRow } from '@/lib/admin/categories.server';
import { Icon } from '@/components/ui/Icon';
import { CatalogEditorHeader } from './CatalogEditorHeader';
import { ErrorText, Field, FormShell, InlineNotice, SelectField, TextArea } from '../fields';
import { SeededForm } from '@/components/admin/form-seed';

/*
 * 분류 관리 (설계서 v2 §1-2 · PM 2026-09-09 「상품 분류는 ERP 기준으로」).
 *
 * 1~3단은 ERP(K-System) 품목대중소분류를 그대로 쓴다 — 이름·위치·순서는 ERP 가 원본이라 여기서 잠기고
 * 「ERP 분류 동기화」로만 바뀐다. 자체 분류는 ERP 소분류 아래 4단째로만 만든다(어떤 굿즈든 대표 분류의 조상 셋이
 * 항상 ERP 대/중/소분류가 되도록). 표시 상태·진열 방식·SEO 같은 진열 설정은 ERP 노드라도 우리 몫이라 열려 있다.
 *
 * 왼쪽이 트리, 오른쪽이 선택한 분류의 설정과 진열이다. 순서는 형제 전체를 한 번에 보내는 계약이라
 * (부분 재정렬은 서버가 거부한다) 위·아래 버튼이 한 폼 안에서 현재 순서를 통째로 들고 간다.
 */

const emptyState: AdminCatalogActionState = {};

const ERP_RULE = 'ERP(K-System) 품목분류가 1~3단입니다. 이름·위치·순서는 ERP 에서 바꾸고 「ERP 분류 동기화」로 맞춥니다. 자체 분류는 ERP 소분류 아래에만 만들 수 있습니다.';

function formatSyncTime(value: string | null) {
  if (!value) return '아직 없음';
  return value.slice(0, 16).replace('T', ' ');
}

function CategoryBadges({ category }: { category: AdminCategory }) {
  return (
    <>
      {isErpCategory(category) ? <span className="admin-badge" style={{ marginLeft: 6 }}>ERP</span> : null}
      {category.erpRemovedAt ? <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>ERP 삭제</span> : null}
      {category.status === 'hidden' ? <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>숨김</span> : null}
      {category.isInternal ? <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>내부</span> : null}
      {category.archivedAt ? <span className="admin-badge admin-badge--muted" style={{ marginLeft: 6 }}>보관</span> : null}
    </>
  );
}

/** 상위 분류 선택지 — ERP 잎을 「대 › 중」 묶음으로. */
function ParentOptions({ categories, parents }: { categories: readonly AdminCategory[]; parents: readonly AdminCategory[] }) {
  const byId = new Map(categories.map((entry) => [entry.id, entry]));
  const groups = new Map<string, { label: string; entries: AdminCategory[] }>();
  for (const parent of parents) {
    const mid = parent.parentId ? byId.get(parent.parentId) : null;
    const top = mid?.parentId ? byId.get(mid.parentId) : null;
    const key = mid?.id ?? 'root';
    const label = [top?.name, mid?.name].filter(Boolean).join(' › ') || '최상위';
    const group = groups.get(key) ?? { label, entries: [] };
    group.entries.push(parent);
    groups.set(key, group);
  }
  return (
    <>
      {[...groups.values()].map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}

function CategoryTree({
  categories,
  filters,
}: {
  categories: readonly AdminCategory[];
  filters: AdminCategoryFilters;
}) {
  const [state, action, pending] = useActionState(reorderCategoriesAction, emptyState);
  const tree = buildCategoryTree(categories);
  const flat = flattenCategoryTree(tree);
  /* 처음엔 대분류만 펼쳐 중분류까지 보인다(350개를 한 번에 늘어놓지 않는다). 소분류는 중분류를 눌러 연다. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(categories.filter((entry) => entry.depth === 1).map((entry) => entry.id)),
  );
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const withChildren = flat.filter((node) => node.children.length > 0).map((node) => node.id);
  const isVisible = (node: AdminCategoryNode) => node.path
    .split('/')
    .filter((id) => id && id !== node.id)
    .every((ancestor) => expanded.has(ancestor));
  const visible = flat.filter(isVisible);

  return (
    <SeededForm values={state.values} action={action} className="col" style={{ gap: 8, minWidth: 0 }}>
      <InlineNotice state={state} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setExpanded(new Set(withChildren))} type="button">모두 펼치기</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setExpanded(new Set())} type="button">모두 접기</button>
      </div>
      <ul className="admin-category-tree">
        {visible.map((node) => {
          const erp = isErpCategory(node);
          const siblings = categories
            .filter((entry) => (entry.parentId ?? null) === (node.parentId ?? null))
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
            .map((entry) => entry.id);
          const open = expanded.has(node.id);
          return (
            <li className="admin-category-tree-row" data-depth={node.depth} key={node.id}>
              <span style={{ paddingLeft: (node.depth - 1) * 16 }}>
                {node.children.length > 0 ? (
                  <button
                    aria-expanded={open}
                    aria-label={`${node.name} ${open ? '접기' : '펼치기'}`}
                    className="btn btn-sm btn-ghost"
                    onClick={() => toggle(node.id)}
                    style={{ marginRight: 4, minWidth: 24, padding: '0 4px' }}
                    type="button"
                  >
                    {open ? '▾' : '▸'}
                  </button>
                ) : <span style={{ display: 'inline-block', width: 28 }} />}
                <Link
                  className={filters.selected === node.id ? 'admin-console-grid-link is-active' : 'admin-console-grid-link'}
                  href={adminCategoryHref(filters, { selected: node.id, parent: null })}
                >
                  {node.name}
                </Link>
                <span className="muted mono" style={{ fontSize: 12, marginLeft: 6 }}>{node.id}</span>
                <CategoryBadges category={node} />
              </span>
              <span className="row" style={{ alignItems: 'center', gap: 6 }}>
                <span className="muted mono" style={{ fontSize: 12 }}>
                  {node.goodsCount.toLocaleString('ko-KR')}
                  {node.descendantGoodsCount !== node.goodsCount ? ` / ${node.descendantGoodsCount.toLocaleString('ko-KR')}` : ''}
                </span>
                {!erp ? (
                  <>
                    <input name="parentId" type="hidden" value={node.parentId ?? ''} />
                    <input name="orderedIds" type="hidden" value={siblings.join(',')} />
                    <button aria-label={`${node.name} 위로`} className="btn btn-sm btn-ghost" disabled={pending} name="move" value={`${node.id}:up`}>↑</button>
                    <button aria-label={`${node.name} 아래로`} className="btn btn-sm btn-ghost" disabled={pending} name="move" value={`${node.id}:down`}>↓</button>
                  </>
                ) : null}
                {isErpLeafCategory(node, categories) && node.depth < CATEGORY_MAX_DEPTH ? (
                  <Link
                    className="btn btn-sm btn-ghost"
                    href={adminCategoryHref(filters, { selected: ADMIN_CATEGORY_NEW_RECORD, parent: node.id })}
                  >
                    + 자체 분류
                  </Link>
                ) : null}
              </span>
            </li>
          );
        })}
        {flat.length === 0 ? <li className="muted" style={{ padding: 12 }}>분류가 없습니다. 「ERP 분류 동기화」로 ERP 분류를 먼저 들여오세요.</li> : null}
      </ul>
    </SeededForm>
  );
}

function ErpSyncPanel({ categories }: { categories: readonly AdminCategory[] }) {
  const [state, action, pending] = useActionState(syncErpCategoriesAction, emptyState);
  const erp = categories.filter(isErpCategory);
  const own = categories.filter((entry) => !isErpCategory(entry) && entry.kind === 'catalog');
  const removed = erp.filter((entry) => entry.erpRemovedAt).length;
  const lastSync = erp.reduce<string | null>((latest, entry) => (
    entry.erpSyncedAt && (!latest || entry.erpSyncedAt > latest) ? entry.erpSyncedAt : latest
  ), null);

  return (
    <section className="card col" style={{ borderRadius: 10, gap: 10, padding: 18 }}>
      <div>
        <span className="eyebrow">ERP</span>
        <h2 style={{ fontSize: 16, margin: '6px 0 0' }}>ERP 분류 동기화</h2>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        ERP 노드 {erp.length.toLocaleString('ko-KR')} · 자체 분류 {own.length.toLocaleString('ko-KR')} · ERP 에서 사라짐 {removed.toLocaleString('ko-KR')} · 마지막 동기화 {formatSyncTime(lastSync)}
      </p>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        ERP 「품목대중소분류정의」 화면에서 내려받은 표를 <span className="mono">erp-categories-from-xlsx.py</span> 로 JSON 으로 바꿔 올립니다.
        추가·이름 바뀜은 그대로 반영하고, ERP 에서 사라진 분류는 지우지 않고 「ERP 삭제」 표시와 숨김으로 둡니다(굿즈가 매달려 있을 수 있습니다).
      </p>
      <SeededForm values={state.values} action={action} className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <label className="col" style={{ gap: 7 }}>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 12 }}>ERP 분류 JSON</span>
          <input accept="application/json,.json" className="admin-field-control" name="file" required type="file" />
          <ErrorText id="file-error">{state.errors?.file}</ErrorText>
        </label>
        <button className="btn btn-holo" disabled={pending} style={{ minWidth: 140 }}>
          <Icon name="check" size={15} /> {pending ? '맞추는 중' : '동기화'}
        </button>
        <InlineNotice state={state} />
      </SeededForm>
    </section>
  );
}

function CategoryForm({
  categories,
  parentDefault,
  selected,
}: {
  categories: readonly AdminCategory[];
  parentDefault: string | null;
  selected: AdminCategory | null;
}) {
  const [state, action, pending] = useActionState(upsertCategoryAction, emptyState);
  const [kind, setKind] = useState(selected?.kind ?? 'catalog');
  const [displayMode, setDisplayMode] = useState(selected?.displayMode ?? 'manual');
  const parents = categoryParentOptions(categories, selected?.id ?? null);
  const erp = selected ? isErpCategory(selected) : false;
  const parentRecord = selected?.parentId ? categories.find((entry) => entry.id === selected.parentId) ?? null : null;

  return (
    <SeededForm values={state.values} action={action} className="card col" style={{ borderRadius: 10, gap: 14, padding: 18 }}>
      <input name="previousId" type="hidden" value={selected?.id ?? ''} />
      {erp && selected ? (
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          ERP 품목분류 <span className="mono">{selected.erpKey}</span> 입니다. 이름·위치·순서는 ERP 에서 바꾸고 동기화합니다 — 여기서는 표시 상태·진열 방식·SEO 만 정합니다.
        </p>
      ) : null}
      {!selected ? <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>{ERP_RULE}</p> : null}
      <div className="admin-form-grid">
        <Field
          defaultValue={selected?.id ?? ''}
          error={state.errors?.id}
          label="분류 코드 (주소에 쓰임)"
          name="id"
          placeholder="acrylic-stand"
          readOnly={Boolean(selected)}
          required
        />
        <Field
          defaultValue={selected?.name ?? ''}
          error={state.errors?.name}
          label={erp ? '분류 이름 (ERP 에서 관리)' : '분류 이름'}
          name="name"
          placeholder="아크릴 스탠드"
          readOnly={erp}
          required
        />
        {selected ? (
          <input name="kind" type="hidden" value={selected.kind} />
        ) : (
          <SelectField
            defaultValue="catalog"
            error={state.errors?.kind}
            label="유형"
            name="kind"
            onChange={(event) => setKind(event.target.value)}
          >
            {CATEGORY_KINDS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </SelectField>
        )}
        {kind === 'catalog' && !selected ? (
          <SelectField
            defaultValue={parentDefault ?? ''}
            error={state.errors?.parentId}
            key={`parent:${parentDefault ?? ''}`}
            label="상위 분류 (ERP 소분류)"
            name="parentId"
            required
          >
            <option value="">고르세요</option>
            <ParentOptions categories={categories} parents={parents} />
          </SelectField>
        ) : null}
        {selected && selected.kind === 'catalog' ? (
          <label className="col" style={{ gap: 7 }}>
            <span className="mono" style={{ color: 'var(--dim)', fontSize: 12 }}>위치</span>
            <span style={{ fontSize: 13, lineHeight: '42px' }}>
              {parentRecord ? categoryPathLabel(parentRecord, categories) : '최상위'}
            </span>
          </label>
        ) : null}
        <SelectField defaultValue={selected?.status ?? 'active'} error={state.errors?.status} label="표시 상태" name="status">
          {CATEGORY_STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </SelectField>
        <SelectField
          defaultValue={selected?.displayMode ?? 'manual'}
          error={state.errors?.displayMode}
          label="진열 방식"
          name="displayMode"
          onChange={(event) => setDisplayMode(event.target.value)}
        >
          {CATEGORY_DISPLAY_MODES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </SelectField>
        {displayMode !== 'manual' ? (
          <SelectField defaultValue={selected?.autoSortKey ?? 'newest'} error={state.errors?.autoSortKey} label="자동 정렬 기준" name="autoSortKey">
            {CATEGORY_AUTO_SORT_KEYS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </SelectField>
        ) : null}
        <Field defaultValue={selected?.seoTitle ?? ''} error={state.errors?.seoTitle} label="SEO 제목 (70자)" name="seoTitle" />
      </div>
      <TextArea defaultValue={selected?.description ?? ''} error={state.errors?.description} label="설명 (300자)" maxLength={300} name="description" />
      <TextArea defaultValue={selected?.seoDescription ?? ''} error={state.errors?.seoDescription} label="SEO 설명 (160자)" maxLength={160} name="seoDescription" />
      <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
        <label className="admin-variant-value">
          <input defaultChecked={selected?.isInternal ?? false} name="isInternal" type="checkbox" /> 내부 전용 (고객에게 감춤)
        </label>
        <label className="admin-variant-value">
          <input defaultChecked={selected?.soldoutLast ?? true} name="soldoutLast" type="checkbox" /> 품절 상품을 뒤로
        </label>
        <label className="admin-variant-value">
          <input defaultChecked={selected?.includeDescendants ?? true} name="includeDescendants" type="checkbox" /> 하위 분류 상품도 함께 진열
        </label>
      </div>
      <FormShell pending={pending} state={state} />
    </SeededForm>
  );
}

function CategoryMoveForm({ categories, selected }: { categories: readonly AdminCategory[]; selected: AdminCategory }) {
  const [state, action, pending] = useActionState(moveCategoryAction, emptyState);
  const parents = categoryParentOptions(categories, selected.id);
  if (selected.kind !== 'catalog' || isErpCategory(selected)) return null;

  return (
    <SeededForm values={state.values} action={action} className="card col" style={{ borderRadius: 10, gap: 10, padding: 16 }}>
      <h3 style={{ fontSize: 15, margin: 0 }}>다른 ERP 소분류 아래로 옮기기</h3>
      <input name="id" type="hidden" value={selected.id} />
      <div className="admin-form-grid">
        <SelectField defaultValue={selected.parentId ?? ''} label="새 상위 분류 (ERP 소분류)" name="parentId" required>
          <ParentOptions categories={categories} parents={parents} />
        </SelectField>
        <Field error={state.errors?.position} label="순서 (비우면 맨 뒤)" name="position" placeholder="0" step={1} type="number" />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        자체 분류는 ERP 소분류 아래에만 둘 수 있습니다. 옮겨도 소속 상품은 따라갑니다.
      </p>
      <InlineNotice state={state} />
      <button className="btn btn-holo" disabled={pending} style={{ justifySelf: 'start', minWidth: 140 }}>
        <Icon name="check" size={15} /> {pending ? '옮기는 중' : '옮기기'}
      </button>
    </SeededForm>
  );
}

function CategoryArchiveForm({ selected }: { selected: AdminCategory }) {
  const [state, action, pending] = useActionState(archiveCategoryAction, emptyState);
  const archived = selected.archivedAt !== null;
  if (isErpCategory(selected)) {
    return (
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        ERP 분류는 보관하지 않습니다. ERP 에서 없어지면 동기화 때 「ERP 삭제」 표시와 숨김으로 바뀝니다.
      </p>
    );
  }
  return (
    <SeededForm values={state.values} action={action} className="card row" style={{ alignItems: 'center', borderRadius: 10, gap: 12, padding: 16 }}>
      <input name="id" type="hidden" value={selected.id} />
      <input name="archived" type="hidden" value={archived ? 'false' : 'true'} />
      <span className="muted" style={{ fontSize: 12 }}>
        {archived ? '보관된 분류입니다. 복원하면 다시 진열에 쓸 수 있습니다.' : '소속 상품이 모두 빠져야 보관할 수 있습니다.'}
      </span>
      <InlineNotice state={state} />
      <button className="btn btn-sm btn-ghost" disabled={pending} style={{ marginLeft: 'auto' }}>
        {archived ? '보관 복원' : '분류 보관'}
      </button>
    </SeededForm>
  );
}

function CategoryGoodsPanel({ categoryId, goods, manual }: { categoryId: string; goods: AdminCategoryGoodRow[]; manual: boolean }) {
  const [state, action, pending] = useActionState(reorderCategoryGoodsAction, emptyState);
  const [windowState, windowAction, windowPending] = useActionState(setCategoryGoodDisplayWindowAction, emptyState);
  const direct = goods.filter((row) => row.direct).map((row) => row.goodId);
  const pinned = goods.filter((row) => row.pinned).map((row) => row.goodId);

  return (
    <section className="card col" style={{ borderRadius: 10, gap: 12, padding: 18 }}>
      <div>
        <span className="eyebrow">DISPLAY</span>
        <h2 style={{ fontSize: 16, margin: '6px 0 0' }}>분류별 진열</h2>
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        고정 핀이 가장 앞이고, 그다음 이 분류에 직접 속한 상품, 그다음 하위 분류에서 올라온 상품입니다. 품절은 설정에 따라 맨 뒤로 갑니다.
      </p>
      <SeededForm values={state.values} action={action}>
        <input name="categoryId" type="hidden" value={categoryId} />
        <input name="orderedGoodIds" type="hidden" value={direct.join(',')} />
        <input name="pinnedGoodIds" type="hidden" value={pinned.join(',')} />
        <div className="admin-console-grid-scroll">
          <table className="admin-console-grid-table">
            <thead>
              <tr>
                <th scope="col">상품</th>
                <th scope="col">상태</th>
                <th scope="col">소속</th>
                <th scope="col">진열 기간</th>
                <th scope="col">순서</th>
              </tr>
            </thead>
            <tbody>
              {goods.map((row) => (
                <tr key={row.goodId}>
                  <td>
                    <Link className="admin-console-grid-link" href={`/admin/catalog/goods?selected=${encodeURIComponent(row.goodId)}`}>
                      {row.goodName}
                    </Link>
                    <span className="muted mono" style={{ fontSize: 12, marginLeft: 6 }}>{row.goodId}</span>
                  </td>
                  <td><span className="admin-badge">{GOOD_SALE_STATE_LABELS[row.saleState] ?? row.saleState}</span></td>
                  <td>
                    {row.direct ? (row.isPrimary ? <span className="admin-badge">대표</span> : <span>직속</span>) : <span className="muted">하위 분류</span>}
                  </td>
                  <td className="muted mono" style={{ fontSize: 12 }}>
                    {row.displayFrom || row.displayUntil
                      ? `${row.displayFrom?.slice(0, 16).replace('T', ' ') ?? '즉시'} ~ ${row.displayUntil?.slice(0, 16).replace('T', ' ') ?? '무기한'}`
                      : '상시'}
                  </td>
                  <td>
                    {row.direct && manual ? (
                      <span className="row" style={{ gap: 4 }}>
                        <button aria-label={`${row.goodName} 위로`} className="btn btn-sm btn-ghost" disabled={pending} name="move" value={`${row.goodId}:up`}>↑</button>
                        <button aria-label={`${row.goodName} 아래로`} className="btn btn-sm btn-ghost" disabled={pending} name="move" value={`${row.goodId}:down`}>↓</button>
                        <button className="btn btn-sm btn-ghost" disabled={pending} name="move" value={`${row.goodId}:pin`}>
                          {row.pinned ? '고정 해제' : '고정'}
                        </button>
                      </span>
                    ) : <span className="muted">-</span>}
                  </td>
                </tr>
              ))}
              {goods.length === 0 ? <tr><td className="muted" colSpan={5}>이 분류에 진열된 상품이 없습니다. 굿즈 편집 화면의 「분류」 카드에서 분류를 지정하세요.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <InlineNotice state={state} />
      </SeededForm>

      <SeededForm values={windowState.values} action={windowAction} className="col" style={{ gap: 10 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>진열 기간 지정</h3>
        <input name="categoryId" type="hidden" value={categoryId} />
        <div className="admin-form-grid">
          <SelectField label="상품" name="goodId">
            {goods.filter((row) => row.direct).map((row) => (
              <option key={row.goodId} value={row.goodId}>{row.goodName}</option>
            ))}
          </SelectField>
          <Field label="시작 (비우면 즉시)" name="displayFrom" type="datetime-local" />
          <Field label="종료 (비우면 무기한)" name="displayUntil" type="datetime-local" />
        </div>
        <InlineNotice state={windowState} />
        <button className="btn btn-holo" disabled={windowPending || direct.length === 0} style={{ justifySelf: 'start', minWidth: 140 }}>
          <Icon name="check" size={15} /> {windowPending ? '저장 중' : '진열 기간 저장'}
        </button>
      </SeededForm>
    </section>
  );
}

export function CategoryConsole({
  categories,
  categoryGoods,
  filters,
  selected,
}: {
  categories: AdminCategory[];
  categoryGoods: AdminCategoryGoodRow[];
  filters: AdminCategoryFilters;
  selected: AdminCategory | 'new' | null;
}) {
  const editing = selected !== null;
  const record = selected === 'new' ? null : selected;

  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      {editing ? (
        <CatalogEditorHeader
          eyebrow="CATEGORIES"
          listHref={adminCategoryHref(filters, { selected: null, parent: null })}
          title={record ? `${record.id} · ${record.name}` : '새 분류'}
        />
      ) : (
        <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <span className="eyebrow">CATEGORIES</span>
            <h1 style={{ fontSize: 22, margin: '6px 0 0' }}>상품 분류</h1>
          </div>
          <span className="row" style={{ gap: 8 }}>
            <Link className="btn btn-sm btn-ghost" href={adminCategoryHref(filters, { archived: !filters.archived })}>
              {filters.archived ? '보관 숨기기' : '보관 포함'}
            </Link>
            <Link className="btn btn-sm btn-holo" href={adminCategoryHref(filters, { selected: ADMIN_CATEGORY_NEW_RECORD, parent: null })}>
              <Icon name="plus" size={14} /> 새 분류
            </Link>
          </span>
        </div>
      )}

      {editing ? (
        <>
          <CategoryForm categories={categories} parentDefault={filters.parent} selected={record} />
          {record ? <CategoryMoveForm categories={categories} selected={record} /> : null}
          {record ? <CategoryArchiveForm selected={record} /> : null}
          {record ? (
            <CategoryGoodsPanel categoryId={record.id} goods={categoryGoods} manual={record.displayMode !== 'auto'} />
          ) : null}
        </>
      ) : (
        <>
          <section className="card" style={{ borderRadius: 10, padding: 18 }}>
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 12px' }}>{ERP_RULE}</p>
            <CategoryTree categories={categories} filters={filters} />
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: '12px 0 0' }}>
              숫자는 이 분류에 직접 속한 상품 수이고, 빗금 뒤는 하위 분류까지 합한 수입니다. 「+ 자체 분류」는 ERP 소분류에만 붙습니다.
            </p>
          </section>
          <ErpSyncPanel categories={categories} />
        </>
      )}
    </div>
  );
}

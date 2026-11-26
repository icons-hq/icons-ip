'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getShippingChargeGroupAction, listShippingChargeGroupsAction } from '@/app/admin/shipping-charge-group-actions';
import type { AdminPickerLoader } from '@/lib/admin/picker';
import type { ShippingChargeGroup, ShippingChargeGroupIdentity } from '@/lib/admin/shipping-charge-groups';
import { AdminPickerDialog, type AdminPickerRowView } from '@/components/admin/console/AdminPickerDialog';
import { Badge } from '@/components/admin/kit/ui/badge';
import { buttonVariants } from '@/components/admin/kit/ui/button';

/* 묶음그룹 요약 상자 — 확인 중·지정 안 함·지정 세 경우가 같은 모양을 쓴다. */
const SUMMARY_CLASS = 'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-muted/30 p-3 text-sm font-normal text-foreground';
const LINK_CLASS = 'underline underline-offset-4';

export type ShippingChargeGroupSummaryValue = Pick<ShippingChargeGroup,
  'id' | 'originId' | 'revision' | 'name' | 'enabled' | 'archived' | 'calculationMode'> & {
  regionalMode?: 'inherit' | 'override'; regional?: ShippingChargeGroup['regional'];
};

/* 고른 그룹의 뜻을 말과 예시 금액으로 보인다. 계산은 그룹 안 상품마다 배송비를 구해 가장 싼(또는 비싼) 금액 하나만 받고, 무료가 되는 상품이 있으면 0원이다(ADR-0023). */
const CALCULATION_PHRASE = { min: '가장 싼', max: '가장 비싼' } as const;
const CALCULATION_EXAMPLE = { min: '2,500원', max: '3,000원' } as const;
/** 계산 방식의 이름. 목록·선택창·편집 창이 같은 말을 쓴다. */
export const SHIPPING_CHARGE_GROUP_MODE_LABELS = { min: `${CALCULATION_PHRASE.min} 배송비 한 번`, max: `${CALCULATION_PHRASE.max} 배송비 한 번` } as const;
/** 지역별 추가배송비를 어디서 정하는지의 이름. */
export const SHIPPING_CHARGE_GROUP_REGION_LABELS = { inherit: '출고지 설정 그대로', override: '이 묶음그룹의 지역표대로' } as const;
function regionalMode(group: ShippingChargeGroupSummaryValue) { return group.regional?.mode ?? group.regionalMode; }

export function ShippingChargeGroupSummary({ group, originName, ownerGoodId, inherited = false, manageLink = false, example = false }: {
  group: ShippingChargeGroupSummaryValue | null | undefined; originName?: string; ownerGoodId?: string; inherited?: boolean; manageLink?: boolean;
  /** 예시 금액 한 줄을 더한다. 표 안의 줄처럼 좁은 자리에서는 끈다. */
  example?: boolean;
}) {
  if (group === undefined) return <div className={SUMMARY_CLASS} data-shipping-charge-group-summary="pending"><p className="text-muted-foreground">묶음그룹을 확인하고 있습니다. 확인이 끝나기 전에는 배송비를 바꾸지 않습니다.</p></div>;
  if (group === null) return <div className={SUMMARY_CLASS} data-shipping-charge-group-summary="none">
    <strong className="font-medium">묶음그룹에 넣지 않음</strong>
    <p className="text-muted-foreground">상품과 출고지의 배송비를 그대로 받습니다.</p>
    {inherited && ownerGoodId ? <p className="text-muted-foreground">묶음그룹은 <Link className={`${LINK_CLASS} text-foreground`} href={`/admin/catalog/goods?goodId=${encodeURIComponent(ownerGoodId)}`}>원상품</Link>에서 바꿉니다.</p> : null}
  </div>;
  const mode = regionalMode(group);
  return <div className={SUMMARY_CLASS} data-shipping-charge-group-summary="group">
    <strong className="flex min-w-0 flex-wrap items-center gap-2 font-medium wrap-anywhere">{group.name} <Badge variant={group.archived || !group.enabled ? 'outline' : 'secondary'}>{group.archived ? '보관' : group.enabled ? '사용' : '사용 안 함'}</Badge></strong>
    <p>같은 묶음그룹 상품을 함께 주문하면 {CALCULATION_PHRASE[group.calculationMode]} 배송비 한 번만 받습니다.</p>
    {example ? <p className="text-muted-foreground">예) 배송비가 3,000원과 2,500원인 상품을 함께 주문하면 {CALCULATION_EXAMPLE[group.calculationMode]}을 받습니다. 무료배송이 되는 상품이 하나라도 있으면 0원입니다.</p> : null}
    {mode ? <p className="text-muted-foreground">{mode === 'inherit' ? '지역별 추가배송비는 출고지 설정 그대로 받습니다.' : '지역별 추가배송비는 이 묶음그룹의 지역표대로 한 번만 받습니다.'}</p> : null}
    {originName ? <p className="text-muted-foreground">출고지 · {originName}</p> : null}
    {inherited && ownerGoodId ? <p className="text-muted-foreground">이 상품은 <Link className={`${LINK_CLASS} text-foreground`} href={`/admin/catalog/goods?goodId=${encodeURIComponent(ownerGoodId)}`}>원상품</Link>의 묶음그룹을 함께 씁니다.</p> : null}
    {manageLink ? <Link className={`${LINK_CLASS} w-fit`} href="/admin/settings/origins#shipping-charge-groups">배송비 묶음그룹 관리</Link> : null}
  </div>;
}

export interface ShippingChargeGroupFieldProps {
  identity: ShippingChargeGroupIdentity | null;
  originId: string | null | undefined;
  value: string | null;
  onChange: (value: string | null, group: ShippingChargeGroup | null) => void;
  selectedGroup?: ShippingChargeGroupSummaryValue | null;
  disabled?: boolean;
  readOnly?: boolean;
  ownerGoodId?: string;
  error?: string;
  allowClear?: boolean;
  name?: string;
}
function createReadLane(owner: string) {
  let alive = true;
  return { owner, isAlive: () => alive, activate: () => { alive = true; }, dispose: () => { alive = false; } };
}

/** 선택창의 줄 설명: 가장 싼(비싼) 배송비 한 번 · 지역별 추가배송비를 어디서 정하는지. */
function groupLine(group: ShippingChargeGroup): string {
  return `${SHIPPING_CHARGE_GROUP_MODE_LABELS[group.calculationMode]} · 지역별 추가배송비는 ${SHIPPING_CHARGE_GROUP_REGION_LABELS[group.regional.mode]}`;
}
/** 묶음그룹 선택창의 조회: 이 출고지의 '사용' 묶음그룹만 서버에 묻는다(다른 출고지·사용 안 함·보관은 조회 단계에서 빠진다). */
export function shippingChargeGroupPickerLoader(identity: ShippingChargeGroupIdentity | null, originId: string | null | undefined): AdminPickerLoader<ShippingChargeGroup> {
  return async (request) => {
    if (!identity || !originId) return { error: '출고지를 먼저 골라 주세요.' };
    const result = await listShippingChargeGroupsAction({ originId, query: request.query.trim(), status: 'active', page: request.page }, identity);
    return 'data' in result ? { rows: result.data.groups, total: result.data.total, page: result.data.page, pageSize: result.data.pageSize } : { error: result.error };
  };
}
/** 묶음그룹 선택창의 줄: 이름(+ 추천) · 계산 방식과 지역별 추가배송비. 내부 번호·버전은 보이지 않는다(화면 규칙 8). */
export function shippingChargeGroupPickerRowView(group: ShippingChargeGroup, note?: string | null): AdminPickerRowView {
  return { title: <>{group.name}{group.isDefault ? <> <Badge variant="secondary">추천</Badge></> : null}</>,
    meta: <>{groupLine(group)}{note ? <span className="block text-warning">{note}</span> : null}</> };
}
export const SHIPPING_CHARGE_GROUP_PICKER_TITLE = '묶음그룹 고르기';
export const SHIPPING_CHARGE_GROUP_PICKER_EXCLUDED = "다른 출고지의 묶음그룹과 '사용 안 함'·보관된 묶음그룹은 목록에서 뺐습니다.";
export const SHIPPING_CHARGE_GROUP_PICKER_EMPTY = '이 출고지에 고를 수 있는 묶음그룹이 없습니다. 배송정보 관리에서 묶음그룹을 먼저 만들어 주세요.';

/**
 * 배송비 묶음그룹 고르기. 읽기 전용 조회와 명시적인 화면 안 선택만 하고 저장은 부르는 쪽 흐름이 맡는다.
 * 묶음그룹은 공용 선택창(화면 규칙 1)에서 고르고, 지금 출고지의 '사용' 묶음그룹만 보인다(서버가 거른다).
 * 버튼은 [묶음그룹 고르기]·[묶음그룹에서 빼기]다(낱말은 관리 화면의 넣기·빼기와 같다).
 */
export function ShippingChargeGroupField({ identity, originId, value, onChange, selectedGroup, disabled = false,
  readOnly = false, ownerGoodId, error, allowClear = true, name }: ShippingChargeGroupFieldProps) {
  const actorId = identity?.expectedActorId ?? '', sessionId = identity?.expectedSessionId ?? '';
  const owner = `${actorId}:${sessionId}:${originId ?? ''}`;
  const lane = useMemo(() => createReadLane(owner), [owner]);
  /* 로그인 계정·세션·출고지가 바뀌면 열려 있던 선택창을 닫는다(이전 조건의 결과가 새 조건에 섞이지 않게). */
  const [storedPicker, setPicker] = useState<{ owner: string; open: boolean }>({ owner, open: false });
  const picker = storedPicker.owner === owner ? storedPicker : { owner, open: false };
  const [storedGroup, setGroup] = useState<{ owner: string; id: string; group: ShippingChargeGroup | null; error: string } | null>(null);
  const loadedGroup = storedGroup?.owner === owner && storedGroup.id === value ? storedGroup : null;
  const selected = value === null ? null : selectedGroup?.id === value ? selectedGroup : loadedGroup?.group ?? undefined;
  const mismatch = selected && selected.originId !== originId;
  const locked = disabled || readOnly || !identity || !originId;
  useEffect(() => { lane.activate(); return () => lane.dispose(); }, [lane]);
  useEffect(() => {
    if (!actorId || !sessionId || !value || selectedGroup?.id === value) return;
    let current = true;
    void getShippingChargeGroupAction(value, { expectedActorId: actorId, expectedSessionId: sessionId }).then(result => {
      if (!current || !lane.isAlive()) return;
      setGroup({ owner, id: value, group: 'data' in result ? result.data.group : null,
        error: 'error' in result ? result.error : '' });
    }).catch(() => { if (current && lane.isAlive()) setGroup({ owner, id: value, group: null, error: '고른 묶음그룹을 불러오지 못했습니다. 고른 것은 그대로 있습니다.' }); });
    return () => { current = false; };
  }, [actorId, sessionId, value, selectedGroup?.id, owner, lane]);
  /* 같은 그룹이라도 고를 때 본 설정이 지금과 다르면(저장이 충돌한 뒤) 다시 골라야 요약과 저장 기준이 최신 설정으로 바뀐다. */
  const current = (group: ShippingChargeGroup) => value === group.id && selected !== undefined && selected !== null && selected.revision === group.revision;
  const stale = (group: ShippingChargeGroup) => value === group.id && selected !== undefined && selected !== null && selected.revision !== group.revision;
  const load = shippingChargeGroupPickerLoader(identity, originId);
  const rowView = (group: ShippingChargeGroup) => shippingChargeGroupPickerRowView(group, stale(group) ? '묶음그룹 설정이 바뀌었습니다. [선택]을 다시 눌러 주세요.' : null);
  /* 목록에서 뺀 그룹이 새어 들어와도 이 출고지에서 쓸 수 없는 그룹은 고르지 않는다. */
  const choose = (group: ShippingChargeGroup) => {
    if (locked || group.originId !== originId || !group.enabled || group.archived) return false;
    onChange(group.id, group);
  };
  return <div className="flex min-w-0 flex-col gap-2.5 text-sm" data-shipping-charge-group-field="">
    {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
    <ShippingChargeGroupSummary group={selected} ownerGoodId={ownerGoodId} inherited={readOnly} manageLink example />
    {!originId ? <p className="text-muted-foreground">출고지를 먼저 고르면 그 출고지의 묶음그룹을 고를 수 있습니다.</p> : null}
    {mismatch ? <p className="text-destructive wrap-anywhere" role="alert">고른 묶음그룹의 출고지가 지금 출고지와 다릅니다. {allowClear ? '같은 출고지의 묶음그룹을 다시 고르거나 [묶음그룹에서 빼기]를 눌러 주세요.' : '같은 출고지의 묶음그룹을 다시 골라 주세요.'}</p> : null}
    {error || loadedGroup?.error ? <p className="text-destructive wrap-anywhere" role="alert">{error || loadedGroup?.error}</p> : null}
    {!readOnly ? <div className="flex min-w-0 flex-wrap items-center gap-2 print:hidden">
      <button className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" type="button" disabled={locked} aria-haspopup="dialog"
        onClick={() => { if (!locked) setPicker({ owner, open: true }); }}>{SHIPPING_CHARGE_GROUP_PICKER_TITLE}</button>
      {allowClear && value !== null ? <button className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-slot="button" type="button" disabled={locked} onClick={() => { if (!locked) { onChange(null, null); setPicker({ owner, open: false }); } }}>묶음그룹에서 빼기</button> : null}
    </div> : null}
    {picker.open && !readOnly ? <AdminPickerDialog<ShippingChargeGroup>
      blockedReason={disabled ? '다른 작업을 처리하는 중이라 지금은 고를 수 없습니다. 끝난 뒤 다시 열어주세요.' : null}
      emptyText={SHIPPING_CHARGE_GROUP_PICKER_EMPTY}
      excludedNote={SHIPPING_CHARGE_GROUP_PICKER_EXCLUDED}
      load={load}
      onClose={() => setPicker({ owner, open: false })}
      onSelect={choose}
      rowBlocked={(group) => current(group) ? '선택됨' : null}
      rowKey={(group) => group.id}
      rowView={rowView}
      searchPlaceholder="묶음그룹 이름"
      title={SHIPPING_CHARGE_GROUP_PICKER_TITLE}
    /> : null}
  </div>;
}

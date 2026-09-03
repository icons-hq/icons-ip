'use client';

import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  GOODS_NOTICE_PRESET_NAME_MAX,
  GOODS_NOTICE_PRESETS_STORAGE_KEY,
  goodsNoticeValuesFromForm,
  isGoodsNoticeComplete,
  parseGoodsNoticePresets,
  removeGoodsNoticePreset,
  serializeGoodsNoticePresets,
  upsertGoodsNoticePreset,
  type GoodsNoticePreset,
} from '@/lib/admin/goods-notice-presets';
import { useBrowserStoredValue, writeBrowserStoredValue } from './browser-store';

/*
 * 고시정보 프리셋 바 (#171 고시정보 7칸 위에 얹는다).
 *
 * 같은 제조사·원산지·A/S 정보를 굿즈마다 다시 치지 않게, 현재 7칸 값을 이름 붙여
 * 브라우저에 저장하고 다음 등록에서 한 번에 채운다. 폼 필드를 늘리지 않는다 —
 * 여기 있는 select·input 에는 name 이 없어 제출값에 섞이지 않고, 버튼은 전부
 * type="button" 이라 저장 폼을 건드리지 않는다.
 */
export function GoodsNoticePresetBar({
  onApply,
}: {
  /** 선택한 프리셋 값(FormData 키 기준)을 7칸에 채우라는 신호. */
  onApply: (values: Record<string, string>) => void;
}) {
  const raw = useBrowserStoredValue(GOODS_NOTICE_PRESETS_STORAGE_KEY);
  const presets = useMemo(() => parseGoodsNoticePresets(raw), [raw]);
  const [selectedName, setSelectedName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const selected = presets.find((preset) => preset.name === selectedName) ?? null;

  function persist(next: GoodsNoticePreset[]) {
    writeBrowserStoredValue(GOODS_NOTICE_PRESETS_STORAGE_KEY, serializeGoodsNoticePresets(next));
  }

  function apply() {
    if (!selected) return;
    onApply(selected.values);
    setNotice(`「${selected.name}」 프리셋으로 채웠습니다.`);
  }

  function remove() {
    if (!selected) return;
    persist(removeGoodsNoticePreset(presets, selected.name));
    setSelectedName('');
    setNotice(`「${selected.name}」 프리셋을 지웠습니다.`);
  }

  function saveCurrent(form: HTMLFormElement | null) {
    if (!form) return;
    const values = goodsNoticeValuesFromForm(new FormData(form));
    if (!isGoodsNoticeComplete(values)) {
      setNotice('고시정보 7칸을 모두 채운 뒤 프리셋으로 저장할 수 있습니다.');
      return;
    }
    const name = draftName.trim();
    if (!name) {
      setNotice('프리셋 이름을 입력해주세요.');
      return;
    }
    persist(upsertGoodsNoticePreset(presets, name, values));
    setSelectedName(name);
    setDraftName('');
    setNotice(`「${name}」 프리셋으로 저장했습니다.`);
  }

  function onSaveClick(event: MouseEvent<HTMLButtonElement>) {
    saveCurrent(event.currentTarget.form);
  }

  /* 이름 칸에서 Enter 는 굿즈 저장이 아니라 프리셋 저장이어야 한다. */
  function onNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    saveCurrent(event.currentTarget.form);
  }

  return (
    <div aria-label="고시정보 프리셋" className="admin-notice-presets" role="group">
      <select
        aria-label="고시정보 프리셋 선택"
        onChange={(event) => setSelectedName(event.target.value)}
        value={selectedName}
      >
        <option value="">{presets.length ? '프리셋 선택' : '저장된 프리셋 없음'}</option>
        {presets.map((preset) => (
          <option key={preset.name} value={preset.name}>{preset.name}</option>
        ))}
      </select>
      <button className="btn btn-sm" disabled={!selected} onClick={apply} type="button">
        채우기
      </button>
      <button className="btn btn-sm btn-ghost" disabled={!selected} onClick={remove} type="button">
        지우기
      </button>
      <span aria-hidden="true" className="admin-notice-presets-divider" />
      <input
        aria-label="새 프리셋 이름"
        className="admin-notice-presets-name"
        maxLength={GOODS_NOTICE_PRESET_NAME_MAX}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={onNameKeyDown}
        placeholder="현재 7칸을 프리셋으로 — 이름"
        type="text"
        value={draftName}
      />
      <button className="btn btn-sm btn-ghost" onClick={onSaveClick} type="button">
        현재 값 저장
      </button>
      <span className="muted admin-notice-presets-note" role="status">
        {notice ?? '이 브라우저에만 저장됩니다.'}
      </span>
    </div>
  );
}

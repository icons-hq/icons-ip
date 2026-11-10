'use client';

import {
  CONSOLE_DATE_PRESET_IDS,
  consoleDatePresets,
  isConsoleDateRangeActive,
  type ConsoleDatePresetId,
  type ConsoleDateRange,
} from '@/components/admin/console/date-presets';
import { Button } from '@/components/admin/kit/ui/button';

/**
 * 스마트스토어식 조회기간 빠른 선택(오늘·1주·1개월·3개월) — ADR-0028 결정 2.
 *
 * shadcn/Dice 레지스트리에 없는 ICONS 부품이다. 기간은 기존 콘솔과 같은 KST 계산
 * (`consoleDatePresets`)으로 만들고, 고른 기간을 화면의 URL 계약으로 옮기는 일은 호출부가 한다.
 * 지금 조건과 정확히 같은 기간의 버튼은 눌린 상태(aria-pressed)로 보인다.
 */
export function KitDatePresets({
  disabled = false,
  from,
  now,
  onSelect,
  presets = CONSOLE_DATE_PRESET_IDS,
  to,
}: {
  disabled?: boolean;
  from: string | null;
  now?: Date;
  onSelect: (range: ConsoleDateRange) => void;
  presets?: readonly ConsoleDatePresetId[];
  to: string | null;
}) {
  return (
    <div aria-label="조회기간 빠른 선택" className="flex items-center gap-1" data-admin-kit="date-presets" role="group">
      {consoleDatePresets(presets, now).map((preset) => {
        const active = isConsoleDateRangeActive(preset.range, { from, to });
        return (
          <Button
            aria-pressed={active}
            disabled={disabled}
            key={preset.id}
            onClick={() => onSelect(preset.range)}
            size="sm"
            type="button"
            variant={active ? 'default' : 'outline'}
          >
            {preset.label}
          </Button>
        );
      })}
    </div>
  );
}

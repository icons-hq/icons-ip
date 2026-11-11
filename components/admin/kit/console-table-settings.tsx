'use client';

import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Settings2 } from 'lucide-react';
import { moveGridColumn, normalizeGridPreferences, type GridPreferenceColumn, type GridPreferences } from '@/lib/admin/grid-preferences';
import { Button } from '@/components/admin/kit/ui/button';
import { Checkbox } from '@/components/admin/kit/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/admin/kit/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/admin/kit/ui/select';

export interface ConsoleTableSettingsColumn extends GridPreferenceColumn {
  label: string;
}

/**
 * 조회항목 설정 — kit 판(ADR-0028). 콘솔 표(ConsoleGrid)와 kit 표가 함께 쓰는 계약(DESIGN.md §어드민 콘솔):
 * 열 표시·순서·왼쪽 0~4열 고정, 첫 열과 필수 열은 숨기지 못한다. 설정은 같은 계정별 그리드 설정 저장소
 * (`useGridPreferences`)에 남아 기존 표에서 저장한 배치가 그대로 이어진다. 확인을 눌러야 저장한다.
 */
export function ConsoleTableSettings({ columns, onSave, preferences }: {
  columns: readonly ConsoleTableSettingsColumn[];
  onSave: (next: GridPreferences) => boolean;
  preferences: GridPreferences;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(preferences);
  const [message, setMessage] = useState('');
  const freezeId = useId();
  const byKey = new Map(columns.map((column, index) => [column.key, { ...column, required: index === 0 || Boolean(column.required) }]));
  const visible = draft.order.filter((key) => !draft.hidden.includes(key));
  const freezeItems = Array.from({ length: Math.min(4, visible.length) + 1 }, (_, count) => ({
    value: String(count),
    label: count === 0 ? '사용 안 함' : `왼쪽 ${count}열`,
  }));

  return (
    <div className="flex items-center gap-2" data-admin-kit="table-settings">
      {message ? <span className="text-xs text-muted-foreground" role="status">{message}</span> : null}
      <Dialog
        onOpenChange={(next) => {
          if (next) setDraft(preferences);
          setOpen(next);
        }}
        open={open}
      >
        <DialogTrigger render={<Button variant="outline" />}>
          <Settings2 className="text-muted-foreground" />
          조회항목 설정
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>조회항목 설정</DialogTitle>
            <DialogDescription>목록에 표시할 항목과 순서를 선택하세요. 필수 항목은 항상 표시됩니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <section aria-label="조회항목 선택" className="flex flex-col gap-2">
              <h3 className="font-medium">조회항목</h3>
              <ul className="flex flex-col gap-1.5">
                {columns.map((column, index) => {
                  const required = index === 0 || Boolean(column.required);
                  return (
                    <li key={column.key}>
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={!draft.hidden.includes(column.key)}
                          disabled={required}
                          onCheckedChange={(checked) => {
                            const hidden = checked ? draft.hidden.filter((key) => key !== column.key) : [...draft.hidden, column.key];
                            setDraft(normalizeGridPreferences({ ...draft, hidden }, columns));
                          }}
                        />
                        <span>{column.label}</span>
                        {required ? <span className="text-xs text-muted-foreground">필수</span> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section aria-label="조회항목 순서" className="flex flex-col gap-2">
              <h3 className="font-medium">선택한 항목 <span className="text-muted-foreground">{visible.length}개</span></h3>
              <ol className="flex flex-col gap-1">
                {draft.order.map((key, index) => {
                  const column = byKey.get(key);
                  if (!column) return null;
                  const hidden = draft.hidden.includes(key);
                  return (
                    <li className="flex items-center justify-between gap-2 rounded-md border px-2 py-1" data-hidden={hidden || undefined} key={key}>
                      <span className={hidden ? 'text-muted-foreground' : undefined}>
                        {column.label}{hidden ? <span className="ml-1 text-xs">숨김</span> : null}
                      </span>
                      <span className="flex gap-1">
                        <Button aria-label={`${column.label} 위로`} disabled={index === 0} onClick={() => setDraft(moveGridColumn(draft, key, -1))} size="icon-sm" type="button" variant="ghost"><ArrowUp /></Button>
                        <Button aria-label={`${column.label} 아래로`} disabled={index === draft.order.length - 1} onClick={() => setDraft(moveGridColumn(draft, key, 1))} size="icon-sm" type="button" variant="ghost"><ArrowDown /></Button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
          <div className="flex items-center gap-2">
            <span id={freezeId}>틀고정</span>
            <Select
              items={freezeItems}
              onValueChange={(value) => { if (typeof value === 'string') setDraft({ ...draft, frozenCount: Number(value) }); }}
              value={String(Math.min(draft.frozenCount, freezeItems.length - 1))}
            >
              <SelectTrigger aria-labelledby={freezeId} className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {freezeItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">설정은 이 브라우저에서 사용하는 관리자 계정별로 저장됩니다.</p>
          <DialogFooter className="sm:justify-between">
            <Button onClick={() => setDraft(normalizeGridPreferences(null, columns))} type="button" variant="ghost">기본값 복원</Button>
            <div className="flex gap-2">
              <Button onClick={() => setOpen(false)} type="button" variant="outline">취소</Button>
              <Button
                onClick={() => {
                  const persisted = onSave(normalizeGridPreferences(draft, columns));
                  setMessage(persisted ? '조회항목 설정을 저장했습니다.' : '현재 화면에 적용했습니다. 브라우저 저장소를 사용할 수 없어 새로고침하면 초기화됩니다.');
                  setOpen(false);
                }}
                type="button"
              >
                확인
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

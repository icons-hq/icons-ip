export interface GridPreferenceColumn {
  key: string;
  required?: boolean;
  defaultVisible?: boolean;
}

export interface GridPreferences {
  version: 1;
  order: string[];
  hidden: string[];
  frozenCount: number;
}

/**
 * Persist only presentation keys. Unknown/deleted keys never become new table cells.
 * A saved order always lists every column that existed when it was saved, so a missing key is a column added later:
 * it goes right after its closest preceding column in definition order (not at the end), and a column that is hidden
 * by default stays hidden for accounts that saved before it existed. The operator's own order and choices are kept.
 */
export function normalizeGridPreferences(value: unknown, columns: readonly GridPreferenceColumn[]): GridPreferences {
  const source = value && typeof value === 'object' ? value as Partial<GridPreferences> : {};
  const keys = columns.map((column) => column.key);
  const known = new Set(keys);
  const saved = source.version === 1 && Array.isArray(source.order);
  const order = [...new Set((saved ? source.order as unknown[] : []).filter((key): key is string => typeof key === 'string' && known.has(key)))];
  const added: string[] = [];
  keys.forEach((key, index) => {
    if (order.includes(key)) return;
    const previous = keys.slice(0, index).reverse().find((candidate) => order.includes(candidate));
    order.splice(previous ? order.indexOf(previous) + 1 : 0, 0, key);
    added.push(key);
  });
  const required = new Set(columns.filter((column, index) => index === 0 || column.required).map((column) => column.key));
  const hiddenByDefault = columns.filter((column) => column.defaultVisible === false).map((column) => column.key);
  const savedHidden = source.version === 1 && Array.isArray(source.hidden)
    ? [...source.hidden, ...(saved ? hiddenByDefault.filter((key) => added.includes(key)) : [])]
    : hiddenByDefault;
  const hidden = [...new Set(savedHidden.filter((key): key is string => typeof key === 'string' && known.has(key) && !required.has(key)))];
  const frozen = typeof source.frozenCount === 'number' && Number.isFinite(source.frozenCount) ? Math.trunc(source.frozenCount) : 0;
  return { version: 1, order, hidden, frozenCount: Math.max(0, Math.min(4, order.length - hidden.length, frozen)) };
}

export function parseGridPreferences(raw: string, columns: readonly GridPreferenceColumn[]): GridPreferences {
  try {
    return normalizeGridPreferences(JSON.parse(raw), columns);
  } catch {
    return normalizeGridPreferences(null, columns);
  }
}

export function gridPreferencesStorageKey(accountId: string, gridKey: string): string {
  return `icons-admin-grid:v1:${encodeURIComponent(accountId)}:${encodeURIComponent(gridKey)}`;
}

export function moveGridColumn(preferences: GridPreferences, key: string, direction: -1 | 1): GridPreferences {
  const order = [...preferences.order];
  const index = order.indexOf(key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return preferences;
  [order[index], order[target]] = [order[target], order[index]];
  return { ...preferences, order };
}

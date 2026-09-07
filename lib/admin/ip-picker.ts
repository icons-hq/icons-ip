/*
 * IP 검색형 선택기의 순수 규칙 (규모 ④).
 *
 * 왜 select 가 아니라 선택기인가: IP 가 1만 개면 `<select>` 는 브라우저가 1만 옵션을
 * 그리거나(느리다), 상위 50개만 담아(대부분을 고를 수 없다) 둘 중 하나로 망가진다.
 * 검색은 서버가 하고(`admin_pick_ips`), 화면은 한 페이지만 그린다.
 */

export interface IpPickerOption {
  id: string;
  title: string;
  archivedAt: string | null;
}

export const IP_PICKER_RECENT_KEY = 'admin:ip-picker:recent';
export const IP_PICKER_RECENT_LIMIT = 8;
/** 한 번에 그리는 줄 수. 서버 검색 상한(`ADMIN_IP_PICK_LIMIT`)과 같다. */
export const IP_PICKER_PAGE_LIMIT = 50;

/** 저장된 최근 목록. 형식이 깨졌으면 빈 목록으로 떨어뜨린다 — 선택기가 못 열리는 것보다 낫다. */
export function parseRecentIps(raw: string): IpPickerOption[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const options: IpPickerOption[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, title } = entry as { id?: unknown; title?: unknown };
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title) continue;
    if (options.some((option) => option.id === id)) continue;
    options.push({ id, title, archivedAt: null });
    if (options.length >= IP_PICKER_RECENT_LIMIT) break;
  }
  return options;
}

/** 고른 IP 를 최근 목록 맨 앞으로. 같은 id 는 하나만 남고 오래된 것부터 밀린다. */
export function rememberRecentIp(
  current: readonly IpPickerOption[],
  chosen: IpPickerOption,
): IpPickerOption[] {
  const rest = current.filter((option) => option.id !== chosen.id);
  return [{ id: chosen.id, title: chosen.title, archivedAt: null }, ...rest].slice(
    0,
    IP_PICKER_RECENT_LIMIT,
  );
}

export function serializeRecentIps(options: readonly IpPickerOption[]): string {
  return JSON.stringify(options.map((option) => ({ id: option.id, title: option.title })));
}

/**
 * 목록에 무엇을 보여줄지.
 *
 * - 검색어가 있으면 **서버 결과만** 보여준다. 최근 고른 것을 섞으면 검색어와 상관없는 줄이
 *   끼어들어 「왜 이게 나오지」가 된다.
 * - 검색어가 없으면 최근 고른 것이 먼저 오고, 그 뒤에 서버가 준 상위 목록이 붙는다.
 * - **지금 선택된 IP 는 어떤 경우에도 맨 위에 있다.** 보관됐거나 검색어에 안 걸려 사라지면
 *   저장할 때 그 값을 다시 만들 수 없다(기존 select 가 selectedId 를 끼워 넣던 이유와 같다).
 * - 한 번에 그리는 줄은 `IP_PICKER_PAGE_LIMIT` 까지다. 전량 로더가 1만 개를 넘겨도 화면은
 *   한 페이지만 그린다 — 나머지는 검색으로 닿는다.
 */
export function buildPickerOptions(input: {
  query: string;
  results: readonly IpPickerOption[];
  recents: readonly IpPickerOption[];
  selected: IpPickerOption | null;
}): IpPickerOption[] {
  const query = input.query.trim();
  const ordered = query ? [...input.results] : [...input.recents, ...input.results];
  const selectedId = input.selected?.id ?? null;

  const seen = new Set<string>();
  const rest: IpPickerOption[] = [];
  /* 선택된 줄은 서버가 준 판(보관 여부가 최신이다)을 쓰되, 없으면 넘겨받은 값을 그대로 쓴다. */
  let selected = input.selected;

  for (const option of ordered) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    if (option.id === selectedId) {
      selected = option;
      continue;
    }
    rest.push(option);
  }

  return (selected ? [selected, ...rest] : rest).slice(0, IP_PICKER_PAGE_LIMIT);
}

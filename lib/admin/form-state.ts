/*
 * 어드민 폼의 실패-후 입력 보존.
 *
 * React 19 `<form action>` 은 액션이 끝나면 비제어 입력을 리셋한다. 검증·RPC 실패가
 * 돌아온 뒤에도 운영자가 친 값(업로드해 둔 아트워크 경로 포함)이 남아 있으려면,
 * 액션이 제출값을 상태로 되돌려주고 폼이 그 값을 defaultValue 로 다시 심어야 한다 —
 * 폼은 `attempt` 를 key 에 섞어 리마운트한다.
 *
 * 완전 제어 컴포넌트로 바꾸지 않는 이유: 섹션 전부가 비제어 defaultValue 규약이고,
 * 이 헬퍼는 IP 폼을 시작으로 굿즈·카드·이벤트 폼이 같은 방식으로 붙을 수 있게 둔다.
 */

export interface AdminFormValuesState {
  /** 실패한 제출의 문자열 필드 값. File 값은 되돌릴 수 없어 싣지 않는다. */
  values?: Record<string, string>;
  /** 제출마다 1씩 오른다. 폼 key 에 섞어 실패 뒤 defaultValue 를 다시 심는다. */
  attempt?: number;
}

/* Next 가 폼에 심는 내부 필드(`$ACTION_ID_…`)는 되돌릴 대상이 아니다. */
const INTERNAL_FIELD_PREFIX = '$ACTION';

/* 우리 폼의 필드 이름은 전부 camelCase 다. 이 밖의 키(`__proto__` 같은 값)는 버린다. */
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** 기본 스코프 키. 카탈로그 폼은 hidden `previousId` 로 "어느 레코드의 제출인지"를 밝힌다. */
const DEFAULT_SCOPE_KEY = 'previousId';

export function collectFormValues(
  formData: FormData,
  options: { exclude?: readonly string[] } = {},
): Record<string, string> {
  const exclude = new Set(options.exclude ?? []);
  const values: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue;
    if (key.startsWith(INTERNAL_FIELD_PREFIX) || exclude.has(key)) continue;
    if (!FIELD_NAME_PATTERN.test(key)) continue;
    /* 같은 이름이 반복되면 첫 값만 남긴다 — 지금 카탈로그 폼에 다중값 필드는 없다. */
    if (Object.hasOwn(values, key)) continue;
    values[key] = value;
  }

  return values;
}

export function nextFormAttempt(state: AdminFormValuesState | null | undefined): number {
  return (state?.attempt ?? 0) + 1;
}

/** 게시·보관 전환은 편집값을 저장하지 않으므로 폼을 리마운트하지 않는다. */
export function adminFormRemountKey(
  state: AdminFormValuesState | null | undefined,
  selected: object | null | undefined,
): string {
  const fields = selected
    ? Object.fromEntries(Object.entries(selected).filter(([key]) => key !== 'publishedAt' && key !== 'archivedAt'))
    : null;
  return `${JSON.stringify(fields)}:${state?.attempt ?? 0}`;
}

/** 실패 상태에 제출값과 회차를 싣는다. 성공 상태에는 쓰지 않는다 — 성공 뒤 폼은 저장된 레코드를 보여야 한다. */
export function withPreservedFormValues<T extends object>(
  failure: T,
  previousState: AdminFormValuesState | null | undefined,
  formData: FormData,
  options: { exclude?: readonly string[] } = {},
): T & AdminFormValuesState {
  return {
    ...failure,
    values: collectFormValues(formData, options),
    attempt: nextFormAttempt(previousState),
  };
}

/**
 * 실패한 제출값이 지금 편집 중인 레코드의 것일 때만 되살린다.
 * 폼의 hidden `previousId`(신규면 빈 값)와 선택 레코드 id 를 비교한다 — 실패 뒤 목록에서
 * 다른 레코드를 고르면 그 레코드의 저장값이 보여야 하고, "새로 등록"으로 돌아오면
 * 실패한 신규 입력이 다시 보인다.
 */
export function preservedFormValues(
  state: AdminFormValuesState | null | undefined,
  selectedId: string | null | undefined,
  options: { scopeKey?: string } = {},
): Record<string, string> | null {
  const values = state?.values;
  if (!values) return null;
  const scopeKey = options.scopeKey ?? DEFAULT_SCOPE_KEY;
  return (values[scopeKey] ?? '') === (selectedId ?? '') ? values : null;
}

function selectedId(selected: object | null | undefined): string | null {
  const id = (selected as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' ? id : null;
}

/** 레코드 값을 defaultValue 문자열로 접는다. boolean 은 hidden 체크박스 규약('on' / '')을 따른다. */
export function fieldValueFromRecord(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'on' : '';
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value : '';
}

/** 필드 기본값: 실패한 제출값 → 선택 레코드 값 → 빈 문자열. */
export function resolveFieldDefault(
  state: AdminFormValuesState | null | undefined,
  selected: object | null | undefined,
  key: string,
  options: { scopeKey?: string } = {},
): string {
  const values = preservedFormValues(state, selectedId(selected), options);
  if (values && Object.hasOwn(values, key)) return values[key];
  return fieldValueFromRecord((selected as Record<string, unknown> | null | undefined)?.[key]);
}

export interface ArtworkFieldDefault {
  currentPath: string | null;
  currentUrl: string | null;
}

/**
 * 아트워크 칸의 초기값. 실패 뒤에는 제출된 경로가 진실이고, 미리보기 URL 은 경로에서
 * 다시 만든다(업로드 직후의 object URL 은 리마운트에서 사라졌다). 제출 경로가 저장된
 * 레코드와 같으면 서버가 계산해 준 URL 을 그대로 쓴다 — 레거시 레코드는 경로 없이
 * `bg` 에서 뽑은 미리보기를 갖기 때문이다.
 */
export function resolveArtworkDefault(
  state: AdminFormValuesState | null | undefined,
  selected: object | null | undefined,
  urlForPath: (path: string) => string | null,
  options: { pathKey?: string; scopeKey?: string; urlKey?: string } = {},
): ArtworkFieldDefault {
  const pathKey = options.pathKey ?? 'imagePath';
  const urlKey = options.urlKey ?? 'imageUrl';
  const record = selected as Record<string, unknown> | null | undefined;
  const storedPath = typeof record?.[pathKey] === 'string' && record[pathKey] ? (record[pathKey] as string) : null;
  const storedUrl = typeof record?.[urlKey] === 'string' && record[urlKey] ? (record[urlKey] as string) : null;

  const values = preservedFormValues(state, selectedId(selected), options);
  if (!values || !Object.hasOwn(values, pathKey)) {
    return { currentPath: storedPath, currentUrl: storedUrl };
  }

  const submittedPath = values[pathKey] || null;
  if (submittedPath === storedPath) {
    return { currentPath: storedPath, currentUrl: storedUrl };
  }

  return {
    currentPath: submittedPath,
    currentUrl: submittedPath ? urlForPath(submittedPath) : null,
  };
}

/** Postgres UUID의 하이픈 표기 형식. 버전은 식별자 소유권·권한 검사를 대신하지 않는다. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

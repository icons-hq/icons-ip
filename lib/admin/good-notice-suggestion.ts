/**
 * 고시 템플릿 제안(ADR-0044): 상품 유형이 없으므로 대표 카테고리 이름으로 템플릿을 찾는다.
 * 이름은 말단 → 위(가까운 상위) 순서이고, 템플릿이 하나라도 나오는 첫 이름을 쓴다. 조회 결과(없음 포함)는 cache에 남겨
 * 같은 이름을 다시 부르지 않는다. 호출 순서는 이름 순서 그대로이고 첫 결과를 찾으면 나머지는 부르지 않는다.
 */
/** find가 권한·DB 오류로 조회하지 못했을 때 돌려주는 값 — 캐시하지 않고 다음 이름으로 넘어간다(다음 호출에서 다시 조회한다). */
export const SUGGEST_LOOKUP_FAILED = Symbol('suggest-lookup-failed');

export async function suggestNoticePresetByNames<Preset>(
  names: readonly string[],
  find: (name: string) => Promise<Preset | null | typeof SUGGEST_LOOKUP_FAILED>,
  cache: Map<string, Preset | null>,
  isCancelled: () => boolean = () => false,
): Promise<{ name: string; preset: Preset } | null> {
  for (const name of names) {
    let preset = cache.get(name);
    if (preset === undefined) {
      const found = await find(name);
      if (found === SUGGEST_LOOKUP_FAILED) { if (isCancelled()) return null; continue; }
      preset = found;
      cache.set(name, preset);
    }
    if (isCancelled()) return null;
    if (preset) return { name, preset };
  }
  return null;
}

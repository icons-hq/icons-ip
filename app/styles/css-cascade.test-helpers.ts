import type { AtRule, Rule } from 'postcss';

/*
 * Helpers for tests that read the console stylesheets rule by rule.
 *
 * ADR-0028: the console's older stylesheets sit in `@layer components`, and every selector's subject
 * carries `:not([data-slot])` so it never matches a kit part. Tests that look a rule up by its
 * selector compare without that guard, and treat `@layer` blocks as transparent.
 */
export const KIT_GUARD = ':not([data-slot])';

export function withoutKitGuard(selector: string) {
  return selector.replaceAll(KIT_GUARD, '').replace(/\s+/g, ' ').trim();
}

/** The nearest `@media` around a rule, looking through `@layer` blocks. */
export function mediaOf(rule: Rule): AtRule | null {
  for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule' && (parent as AtRule).name === 'media') return parent as AtRule;
  }
  return null;
}

/** True when nothing but `@layer` blocks wraps the rule. */
export function atTopLevel(rule: Rule) {
  for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule' && (parent as AtRule).name !== 'layer') return false;
  }
  return true;
}

import { isUuid } from './uuid';

export const GOODS_ATTRIBUTE_KINDS = ['single', 'multi', 'text', 'number'] as const;
export type GoodsAttributeKind = typeof GOODS_ATTRIBUTE_KINDS[number];
export type GoodsAttributeField = { id: string; name: string; kind: GoodsAttributeKind; required: boolean; unit: string; options: { id: string; label: string }[] };
export type GoodsAttributeSchema = { categoryId: string; revision: number; fields: GoodsAttributeField[] };
export type GoodsAttributeValue = string | number | string[];
export type GoodsAttributeEntry = { field: GoodsAttributeField; value: GoodsAttributeValue };
export type GoodsAttributeDocument = { revision: number; entries: GoodsAttributeEntry[] };
export type GoodsAttributeSubmission = { categoryId: string | null; schemaRevision: number; expectedRevision: number; values: Record<string, GoodsAttributeValue | null>; removeIds: string[] };
export const EMPTY_GOODS_ATTRIBUTES: GoodsAttributeDocument = { revision: 0, entries: [] };
const canonicalId = (value: unknown): value is string => isUuid(value) && value === value.toLowerCase();
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;
const boundedText = (v: unknown, max: number, allowEmpty = false): v is string => typeof v === 'string' && v === v.trim() && (allowEmpty || v.length > 0) && [...v].length <= max;

export function parseGoodsAttributeFields(value: unknown): GoodsAttributeField[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;
  const ids = new Set<string>(); const names = new Set<string>();
  for (const field of value) {
    if (!object(field) || !exactKeys(field, ['id','name','kind','required','unit','options']) || !canonicalId(field.id)
      || ids.has(field.id) || !boundedText(field.name, 60) || names.has(field.name) || !(GOODS_ATTRIBUTE_KINDS as readonly unknown[]).includes(field.kind)
      || typeof field.required !== 'boolean' || !boundedText(field.unit, 20, true) || field.kind !== 'number' && field.unit !== ''
      || !Array.isArray(field.options) || field.options.length > 100) return null;
    ids.add(field.id); names.add(field.name);
    if (['single','multi'].includes(String(field.kind)) ? !field.options.length : field.options.length !== 0) return null;
    const optionIds = new Set<string>(); const labels = new Set<string>();
    for (const option of field.options) {
      if (!object(option) || !exactKeys(option, ['id','label']) || !canonicalId(option.id) || optionIds.has(option.id)
        || !boundedText(option.label, 80) || labels.has(option.label)) return null;
      optionIds.add(option.id); labels.add(option.label);
    }
  }
  return value as GoodsAttributeField[];
}
export function parseGoodsAttributeSchema(value: unknown): GoodsAttributeSchema | null {
  if (!object(value) || !isUuid(value.categoryId) || !integer(value.revision)) return null;
  const fields = parseGoodsAttributeFields(value.fields);
  return fields ? { categoryId: value.categoryId, revision: value.revision as number, fields } : null;
}
export function validGoodsAttributeValue(field: GoodsAttributeField, value: unknown): value is GoodsAttributeValue {
  if (field.kind === 'text') return boundedText(value, 500);
  if (field.kind === 'number') return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000 && Number(value.toFixed(6)) === value;
  const options = new Set(field.options.map(option => option.id));
  if (field.kind === 'single') return typeof value === 'string' && options.has(value);
  return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(id => typeof id === 'string' && options.has(id)) && new Set(value).size === value.length;
}
export function parseGoodsAttributeDocument(value: unknown): GoodsAttributeDocument | null {
  if (!object(value) || !integer(value.revision) || !Array.isArray(value.entries) || value.entries.length > 100) return null;
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (!object(entry) || !exactKeys(entry, ['field','value'])) return null;
    const fields = parseGoodsAttributeFields([entry.field]);
    if (!fields || ids.has(fields[0].id) || !validGoodsAttributeValue(fields[0], entry.value)) return null;
    ids.add(fields[0].id);
  }
  return value as GoodsAttributeDocument;
}
export function goodsAttributeEntryMatches(entry: GoodsAttributeEntry, field: GoodsAttributeField | undefined): boolean {
  return Boolean(field && entry.field.kind === field.kind && entry.field.unit === field.unit && validGoodsAttributeValue(field, entry.value));
}
export function goodsAttributeValueLabel(field: GoodsAttributeField, value: GoodsAttributeValue): string {
  if (field.kind === 'single' || field.kind === 'multi') return (Array.isArray(value) ? value : [value]).map(id => field.options.find(option => option.id === id)?.label ?? String(id)).join(', ');
  return `${value}${field.unit ? ` ${field.unit}` : ''}`;
}
export function goodsAttributeRows(schema: GoodsAttributeSchema | null, document: GoodsAttributeDocument): { id: string; name: string; value: string }[] {
  return (schema?.fields ?? []).flatMap(field => {
    const entry = document.entries.find(item => item.field.id === field.id);
    return entry && goodsAttributeEntryMatches(entry, field) ? [{ id: field.id, name: field.name, value: goodsAttributeValueLabel(field, entry.value) }] : [];
  });
}
export function parseGoodsAttributeSubmission(value: unknown): GoodsAttributeSubmission | null {
  if (!object(value) || !exactKeys(value, ['categoryId','schemaRevision','expectedRevision','values','removeIds'])
    || value.categoryId !== null && !isUuid(value.categoryId) || !integer(value.schemaRevision) || !integer(value.expectedRevision)
    || !object(value.values) || Object.keys(value.values).length > 30 || !Array.isArray(value.removeIds) || value.removeIds.length > 100
    || value.removeIds.some(id => !canonicalId(id)) || new Set(value.removeIds).size !== value.removeIds.length) return null;
  if (Object.entries(value.values).some(([id, v]) => !canonicalId(id) || (v !== null && typeof v !== 'string' && typeof v !== 'number' && !Array.isArray(v))
    || typeof v === 'string' && [...v].length > 500 || typeof v === 'number' && !Number.isFinite(v)
    || Array.isArray(v) && (v.length > 100 || v.some(item => typeof item !== 'string' || !isUuid(item))))) return null;
  return value as GoodsAttributeSubmission;
}

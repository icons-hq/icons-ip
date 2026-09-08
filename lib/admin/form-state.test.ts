import { describe, expect, it } from 'vitest';
import {
  collectFormValues,
  adminFormRemountKey,
  fieldValueFromRecord,
  nextFormAttempt,
  preservedFormValues,
  resolveArtworkDefault,
  resolveFieldDefault,
  withPreservedFormValues,
} from './form-state';

function ipForm(values: Record<string, string | File>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe('adminFormRemountKey', () => {
  const record = { id: 'hwasan', title: '화산강림', publishedAt: null, archivedAt: null };

  it('keeps unsaved inputs mounted when only publish or archive state changes', () => {
    expect(adminFormRemountKey({}, { ...record, publishedAt: '2026-09-08T00:00:00Z' }))
      .toBe(adminFormRemountKey({}, record));
    expect(adminFormRemountKey({}, { ...record, archivedAt: '2026-09-08T00:00:00Z' }))
      .toBe(adminFormRemountKey({}, record));
  });

  it('remounts for a failed submission, a different record, or newly saved field values', () => {
    const key = adminFormRemountKey({}, record);
    expect(adminFormRemountKey({ attempt: 1 }, record)).not.toBe(key);
    expect(adminFormRemountKey({}, { ...record, id: 'lumen' })).not.toBe(key);
    expect(adminFormRemountKey({}, { ...record, title: '새 이름' })).not.toBe(key);
    expect(adminFormRemountKey({}, null)).not.toBe(key);
    expect(adminFormRemountKey({ attempt: 1 }, null)).not.toBe(adminFormRemountKey({}, null));
  });
});

describe('collectFormValues', () => {
  it('keeps every string field and drops files and Next internals', () => {
    const formData = ipForm({
      previousId: '',
      id: 'hwasan',
      title: '화산강림',
      imagePath: 'public-media/catalog/ip/a.png',
      $ACTION_ID_abc: 'internal',
      $ACTION_REF_1: 'internal',
    });
    formData.set('artwork', new File(['x'], 'a.png', { type: 'image/png' }));

    expect(collectFormValues(formData)).toEqual({
      previousId: '',
      id: 'hwasan',
      title: '화산강림',
      imagePath: 'public-media/catalog/ip/a.png',
    });
  });

  it('honours an exclude list and refuses non-field keys', () => {
    const formData = ipForm({ id: 'hwasan', secret: 'x', __proto__: 'poison', 'bad key': 'y' });

    expect(collectFormValues(formData, { exclude: ['secret'] })).toEqual({ id: 'hwasan' });
  });

  it('keeps the first value of a repeated field name', () => {
    const formData = new FormData();
    formData.append('tag', 'first');
    formData.append('tag', 'second');

    expect(collectFormValues(formData)).toEqual({ tag: 'first' });
  });
});

describe('withPreservedFormValues / nextFormAttempt', () => {
  it('increments the attempt from the previous state and carries the submitted values', () => {
    const failure = { errors: { title: 'IP 이름을 입력해주세요.' } };

    expect(withPreservedFormValues(failure, {}, ipForm({ id: 'hwasan', title: '' }))).toEqual({
      errors: { title: 'IP 이름을 입력해주세요.' },
      values: { id: 'hwasan', title: '' },
      attempt: 1,
    });
    expect(withPreservedFormValues(failure, { attempt: 4 }, ipForm({ id: 'x' })).attempt).toBe(5);
    expect(nextFormAttempt(undefined)).toBe(1);
    expect(nextFormAttempt({ values: {}, attempt: 2 })).toBe(3);
  });
});

describe('preservedFormValues', () => {
  const values = { previousId: 'hwasan', title: '수정 중' };

  it('returns the submitted values only for the record they were submitted for', () => {
    expect(preservedFormValues({ values }, 'hwasan')).toEqual(values);
    expect(preservedFormValues({ values }, 'lumen')).toBeNull();
    expect(preservedFormValues({ values }, null)).toBeNull();
  });

  it('treats a missing previousId as the new-record form', () => {
    expect(preservedFormValues({ values: { title: '신규' } }, null)).toEqual({ title: '신규' });
    expect(preservedFormValues({ values: { title: '신규' } }, 'hwasan')).toBeNull();
    expect(preservedFormValues({}, null)).toBeNull();
    expect(preservedFormValues(undefined, null)).toBeNull();
  });

  it('accepts a custom scope key', () => {
    expect(preservedFormValues({ values: { operationId: 'op-1', name: 'x' } }, 'op-1', { scopeKey: 'operationId' }))
      .toEqual({ operationId: 'op-1', name: 'x' });
  });
});

describe('resolveFieldDefault', () => {
  const selected = { id: 'hwasan', title: '화산강림', sub: null, featured: true, fansCount: 12 };

  it('prefers the failed submission over the stored record, including cleared fields', () => {
    const state = { values: { previousId: 'hwasan', title: '새 이름', sub: '' }, attempt: 1 };

    expect(resolveFieldDefault(state, selected, 'title')).toBe('새 이름');
    expect(resolveFieldDefault(state, selected, 'sub')).toBe('');
    /* 제출에 없던 필드는 레코드 값으로 돌아간다. */
    expect(resolveFieldDefault(state, selected, 'featured')).toBe('on');
  });

  it('falls back to the record and then to an empty string', () => {
    expect(resolveFieldDefault({}, selected, 'title')).toBe('화산강림');
    expect(resolveFieldDefault({}, selected, 'sub')).toBe('');
    expect(resolveFieldDefault({}, selected, 'fansCount')).toBe('12');
    expect(resolveFieldDefault({}, selected, 'missing')).toBe('');
    expect(resolveFieldDefault(undefined, null, 'title')).toBe('');
  });

  it('ignores a submission that belongs to another record', () => {
    const state = { values: { previousId: 'lumen', title: '루멘' }, attempt: 1 };

    expect(resolveFieldDefault(state, selected, 'title')).toBe('화산강림');
    expect(resolveFieldDefault(state, null, 'title')).toBe('');
  });

  it('folds record values into the hidden-input vocabulary', () => {
    expect(fieldValueFromRecord(true)).toBe('on');
    expect(fieldValueFromRecord(false)).toBe('');
    expect(fieldValueFromRecord(0)).toBe('0');
    expect(fieldValueFromRecord(undefined)).toBe('');
    expect(fieldValueFromRecord({ nested: true })).toBe('');
  });
});

describe('resolveArtworkDefault', () => {
  const urlForPath = (path: string) => `https://cdn.test/${path}`;
  const stored = { id: 'hwasan', imagePath: 'public-media/catalog/ip/old.png', imageUrl: 'https://cdn.test/old-from-server.png' };
  const legacy = { id: 'legacy', imagePath: null, imageUrl: 'https://cdn.test/generated/legacy.png' };

  it('uses the stored record when there is no failed submission', () => {
    expect(resolveArtworkDefault({}, stored, urlForPath)).toEqual({
      currentPath: 'public-media/catalog/ip/old.png',
      currentUrl: 'https://cdn.test/old-from-server.png',
    });
    expect(resolveArtworkDefault({}, null, urlForPath)).toEqual({ currentPath: null, currentUrl: null });
  });

  it('restores a freshly uploaded path and rebuilds its preview for the new-record form', () => {
    const state = { values: { previousId: '', imagePath: 'public-media/catalog/ip/new.png' }, attempt: 1 };

    expect(resolveArtworkDefault(state, null, urlForPath)).toEqual({
      currentPath: 'public-media/catalog/ip/new.png',
      currentUrl: 'https://cdn.test/public-media/catalog/ip/new.png',
    });
  });

  it('keeps the server preview when the submitted path equals the stored one', () => {
    const unchanged = { values: { previousId: 'hwasan', imagePath: 'public-media/catalog/ip/old.png' }, attempt: 1 };
    const legacyUnchanged = { values: { previousId: 'legacy', imagePath: '' }, attempt: 1 };

    expect(resolveArtworkDefault(unchanged, stored, urlForPath).currentUrl).toBe('https://cdn.test/old-from-server.png');
    expect(resolveArtworkDefault(legacyUnchanged, legacy, urlForPath)).toEqual({
      currentPath: null,
      currentUrl: 'https://cdn.test/generated/legacy.png',
    });
  });

  it('reflects a removed image and a replaced image after a failed save', () => {
    const removed = { values: { previousId: 'hwasan', imagePath: '' }, attempt: 1 };
    const replaced = { values: { previousId: 'hwasan', imagePath: 'public-media/catalog/ip/next.png' }, attempt: 1 };

    expect(resolveArtworkDefault(removed, stored, urlForPath)).toEqual({ currentPath: null, currentUrl: null });
    expect(resolveArtworkDefault(replaced, stored, urlForPath)).toEqual({
      currentPath: 'public-media/catalog/ip/next.png',
      currentUrl: 'https://cdn.test/public-media/catalog/ip/next.png',
    });
  });

  it('ignores a submission scoped to another record', () => {
    const state = { values: { previousId: 'lumen', imagePath: 'public-media/catalog/ip/lumen.png' }, attempt: 1 };

    expect(resolveArtworkDefault(state, stored, urlForPath).currentPath).toBe('public-media/catalog/ip/old.png');
  });
});

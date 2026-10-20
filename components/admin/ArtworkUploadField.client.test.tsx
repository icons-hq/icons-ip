import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtworkUploadField } from './ArtworkUploadField';

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  refIndex: 0,
  state: [] as unknown[],
  stateIndex: 0,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: () => undefined,
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      hooks.refs[index] ??= { current: initial };
      return hooks.refs[index];
    },
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.state)) {
        hooks.state[index] = typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
      }
      return [
        hooks.state[index],
        (next: unknown) => {
          hooks.state[index] = typeof next === 'function'
            ? (next as (current: unknown) => unknown)(hooks.state[index])
            : next;
        },
      ];
    },
  };
});

vi.mock('../../lib/admin/artwork-upload.client', () => ({ uploadAdminArtwork: vi.fn() }));

function renderField(maxFileSizeBytes?: number) {
  hooks.refIndex = 0;
  hooks.stateIndex = 0;
  return ArtworkUploadField({
    allowRemove: true,
    maxFileSizeBytes,
    currentPath: 'public-media/catalog/curation/123e4567-e89b-42d3-a456-426614174000.webp',
    currentUrl: 'https://cdn.example/catalog/curation/current.webp',
    kind: 'curation',
  });
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function findElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  if (!isValidElement(node)) return [];
  const matches = predicate(node) ? [node] : [];
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    matches.push(...findElements(child, predicate));
  }
  return matches;
}

describe('ArtworkUploadField removal interaction', () => {
  beforeEach(() => {
    hooks.refs = [];
    hooks.state = [];
  });

  it('rejects a mosaic file over 900KB without changing its committed image', () => {
    const initial = renderField(900 * 1024);
    const input = findElement(initial, element => element.type === 'input' && (element.props as { type?: string }).type === 'file');
    const target = { files: [{ size: 900 * 1024 + 1, type: 'image/png' }], value: 'oversize.png', setCustomValidity: vi.fn() };
    (input!.props as { onChange: (event: unknown) => void }).onChange({ currentTarget: target });
    const result = renderField(900 * 1024);
    expect(target.value).toBe('');
    const imagePath = findElement(result, element => element.type === 'input' && (element.props as { name?: string }).name === 'imagePath');
    expect((imagePath!.props as { value: string }).value).toContain('123e4567');
    expect(findElements(result, () => true).some(element => (element.props as { children?: unknown }).children === '이미지는 최대 900KB까지 등록할 수 있습니다.')).toBe(true);
  });

  it('submits one empty imagePath after the operator selects image removal', () => {
    const initial = renderField();
    const removeButton = findElement(
      initial,
      (element) => element.type === 'button'
        && (element.props as { children?: ReactNode }).children === '이미지 제거',
    );

    (removeButton?.props as { onClick: () => void }).onClick();

    const updated = renderField();
    const submittedInputs = findElements(
      updated,
      (element) => element.type === 'input'
        && typeof (element.props as { name?: unknown }).name === 'string',
    );
    const payload = new FormData();
    for (const element of submittedInputs) {
      const input = element.props as { name: string; value?: string };
      payload.append(input.name, input.value ?? '');
    }

    expect(removeButton).not.toBeNull();
    expect([...payload.entries()]).toEqual([['imagePath', '']]);
  });
});

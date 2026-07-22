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

function renderField() {
  hooks.refIndex = 0;
  hooks.stateIndex = 0;
  return ArtworkUploadField({
    allowRemove: true,
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

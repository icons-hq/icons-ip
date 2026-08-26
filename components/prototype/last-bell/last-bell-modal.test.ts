import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./LastBellClient.tsx', import.meta.url), 'utf8');

describe('last bell modal accessibility contract', () => {
  it('keeps entry, pause, capture, and completion mutually exclusive', () => {
    expect((source.match(/role="dialog"/g) ?? [])).toHaveLength(3);
    expect((source.match(/aria-modal="true"/g) ?? [])).toHaveLength(3);
    expect(source).toContain("paused && state.phase !== 'opening'");
    expect(source).toContain("!portrait && state.phase === 'opening' && (");
    expect(source).toContain('{activeModal === \'paused\' && (');
    expect(source).toContain('{activeModal === \'captured\' && (');
    expect(source).toContain('{activeModal === \'complete\' && (');
  });

  it('focuses the primary action, traps Tab, restores focus, and gates gameplay keys', () => {
    expect(source).toContain('modalPrimaryRef.current?.focus()');
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain('previousFocusRef.current.focus()');
    expect(source).toContain('if (modalOpenRef.current || !gameplayInputEnabledRef.current) return;');
    expect(source).toContain('event.stopPropagation();');
  });
});

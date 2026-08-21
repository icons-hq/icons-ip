import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./LastBellClient.tsx', import.meta.url), 'utf8');

describe('last bell modal accessibility contract', () => {
  it('marks pause, capture, and completion overlays as modal dialogs', () => {
    expect((source.match(/role="dialog"/g) ?? [])).toHaveLength(3);
    expect((source.match(/aria-modal="true"/g) ?? [])).toHaveLength(3);
    expect(source).toContain("const activeModal = state.phase === 'complete'");
    expect(source).toContain("? 'complete'");
    expect(source).toContain("? 'captured'");
    expect(source).toContain("? 'paused'");
    expect(source).toContain("{activeModal === 'paused' && (");
    expect(source).toContain("{activeModal === 'captured' && (");
    expect(source).toContain("{activeModal === 'complete' && (");
    expect(source).toContain('aria-labelledby="last-bell-modal-title"');
    expect(source).toContain('aria-describedby="last-bell-modal-description"');
  });

  it('focuses the primary action, traps Tab, restores focus, and suppresses gameplay keys', () => {
    expect(source).toContain('modalPrimaryRef.current?.focus()');
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain('previousFocusRef.current.focus()');
    expect(source).toContain('if (modalOpenRef.current) return;');
    expect(source).toContain('event.stopPropagation();');
  });
});

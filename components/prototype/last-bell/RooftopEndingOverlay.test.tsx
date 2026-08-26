import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RooftopEndingOverlay } from './RooftopEndingOverlay';

const noop = () => undefined;

function resultMarkup(authority: 'local-qa' | 'verified-candidate', isAuthenticated: boolean) {
  return renderToStaticMarkup(
    <RooftopEndingOverlay
      phase="black"
      phaseElapsedSeconds={10}
      suspended={false}
      gameComplete
      authority={authority}
      isAuthenticated={isAuthenticated}
      runReady
      syncFailed={false}
      onOpenInventory={noop}
      onReplayChapter={noop}
      onRetrySync={noop}
    />,
  );
}

describe('RooftopEndingOverlay completion routes', () => {
  it('keeps verified completions on the verified-gated store route', () => {
    const authenticated = resultMarkup('verified-candidate', true);
    const guest = resultMarkup('verified-candidate', false);

    expect(authenticated).toContain('href="/experiences/all-of-us-are-dead/last-bell/store"');
    expect(guest).toContain(
      'href="/login?next=%2Fexperiences%2Fall-of-us-are-dead%2Flast-bell%2Fstore"',
    );
    expect(authenticated).not.toContain('/games/prototype-last-bell/popup/store');
    expect(guest).not.toContain('/games/prototype-last-bell/popup/store');
  });

  it('keeps the disposable local QA completion on the prototype popup store', () => {
    expect(resultMarkup('local-qa', false)).toContain(
      'href="/games/prototype-last-bell/popup/store"',
    );
  });
});

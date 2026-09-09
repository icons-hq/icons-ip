// A reveal belongs to one mounted round. Changing rounds cancels pending waits
// before they can play sound or show a result from the previous session.
export function createRoundPlayback() {
  let current = null;

  const isCurrent = (run) => current === run && !run.signal.aborted;
  const cancel = () => {
    current?.controller.abort();
    current = null;
  };

  return {
    get busy() { return current !== null; },
    begin() {
      if (current) return null;
      const controller = new AbortController();
      current = { controller, signal: controller.signal };
      return current;
    },
    isCurrent,
    wait(run, ms) {
      if (!isCurrent(run)) return Promise.resolve(false);
      return new Promise((resolve) => {
        const abort = () => { clearTimeout(timer); resolve(false); };
        const timer = setTimeout(() => {
          run.signal.removeEventListener("abort", abort);
          resolve(isCurrent(run));
        }, ms);
        run.signal.addEventListener("abort", abort, { once: true });
      });
    },
    finish(run) {
      if (isCurrent(run)) cancel();
    },
    cancel,
  };
}

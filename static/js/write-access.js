(function (global) {
  async function acquire(
    key,
    locks = global.navigator?.locks,
    lifecycle = global,
  ) {
    let writable = false;
    let release;
    let generation = 0;
    const request = () =>
      new Promise((resolve) => {
        const requestedGeneration = generation;
        if (!locks) {
          resolve();
          return;
        }
        locks
          .request(key, { ifAvailable: true }, (lock) => {
            if (requestedGeneration !== generation) {
              resolve();
              return;
            }
            writable = Boolean(lock);
            resolve();
            if (!lock) return;
            return new Promise((done) => {
              release = done;
            });
          })
          .catch(() => resolve());
      });
    await request();
    const close = () => {
      generation += 1;
      writable = false;
      if (release) release();
      release = null;
    };
    lifecycle.addEventListener?.("pagehide", close);
    lifecycle.addEventListener?.("pageshow", (event) => {
      if (event.persisted) request();
    });
    return {
      assertWritable() {
        if (!writable) throw new Error("conflict");
      },
      close,
      get writable() {
        return writable;
      },
    };
  }
  const api = { acquire };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.WriteAccess = api;
})(globalThis);

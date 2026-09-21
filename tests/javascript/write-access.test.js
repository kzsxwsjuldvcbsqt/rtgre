const test = require("node:test");
const assert = require("node:assert/strict");
const { acquire } = require("../../static/js/write-access.js");
test("independent editors cannot acquire the same write lease concurrently", async () => {
  const held = new Set();
  const locks = {
    async request(key, options, callback) {
      if (held.has(key)) return callback(null);
      held.add(key);
      try {
        await callback({ name: key });
      } finally {
        held.delete(key);
      }
    },
  };
  const [first, second] = await Promise.all([
    acquire("notes", locks, {}),
    acquire("notes", locks, {}),
  ]);
  first.assertWritable();
  assert.throws(() => second.assertWritable(), /conflict/);
  const other = await acquire("absences", locks, {});
  other.assertWritable();
  first.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const replacement = await acquire("notes", locks, {});
  replacement.assertWritable();
  replacement.close();
  other.close();
});
test("missing lock support never silently enables unsafe writes", async () => {
  const access = await acquire("notes", null, {});
  assert.throws(() => access.assertWritable(), /conflict/);
});

test("returning through the browser history reacquires write access", async () => {
  const listeners = {};
  let releases = 0;
  const access = await acquire(
    "notes",
    {
      async request(key, options, callback) {
        await callback({ name: key });
        releases += 1;
      },
    },
    {
      addEventListener(name, callback) {
        listeners[name] = callback;
      },
    },
  );
  access.assertWritable();
  listeners.pagehide();
  assert.throws(() => access.assertWritable(), /conflict/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(releases, 1);
  listeners.pageshow({ persisted: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  access.assertWritable();
  listeners.pagehide();
});

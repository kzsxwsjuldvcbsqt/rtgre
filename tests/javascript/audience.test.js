const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function load(hostname, stored) {
  const storage = new Map(Object.entries(stored || {}));
  const appended = [];
  const context = {
    AppUtils: { onDOMReady() {} },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      currentScript: {
        dataset: {
          tracker: "/mesure.js",
          websiteId: "00000000-0000-4000-8000-000000000000",
          domain: "example.org",
        },
      },
      createElement: () => ({ dataset: {} }),
      head: { appendChild: (element) => appended.push(element) },
    },
  };
  context.window = context;
  context.location = { hostname };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("static/js/audience.js", "utf8"), context);
  return { audience: context.Audience, appended, storage };
}

test("loads the tracker on the production domain only", () => {
  const production = load("example.org");
  assert.equal(production.appended.length, 1);
  assert.equal(production.appended[0].src, "/mesure.js");
  assert.equal(
    production.appended[0].dataset.websiteId,
    "00000000-0000-4000-8000-000000000000",
  );
  assert.equal(load("localhost").appended.length, 0);
  assert.equal(load("test.example.org").appended.length, 0);
});

test("does not load the tracker for a visitor who refused", () => {
  const refused = load("example.org", { audience_opt_out: "1" });
  assert.equal(refused.appended.length, 0);
  assert.equal(refused.audience.refused(), true);
});

test("remembers the choice and tells the tracker to stop at once", () => {
  const { audience, storage } = load("example.org");
  audience.choose(false);
  assert.equal(audience.refused(), true);
  assert.equal(storage.get("umami.disabled"), "1");
  audience.choose(true);
  assert.equal(audience.refused(), false);
  assert.equal(storage.has("umami.disabled"), false);
});

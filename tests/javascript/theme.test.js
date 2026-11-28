const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const SEASONAL = "auto";
const CLASSIC = "classic";
const BASE = "https://example.org/static/themes/";

function load(options) {
  const storage = new Map(Object.entries(options.stored || {}));
  const root = {
    classList: { add() {}, toggle() {} },
    dataset: options.seasonal ? { theme: options.seasonal } : {},
  };
  const links = options.themes.map((id) => ({
    href: BASE + id + "/theme.css",
    dataset: { themeId: id, preloadImages: JSON.stringify(["cover.webp"]) },
  }));
  const preloads = [];
  const context = {
    URL,
    scrollY: 0,
    addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      documentElement: root,
      currentScript: {
        dataset: { themeSeasonal: SEASONAL, themeClassic: CLASSIC },
      },
      querySelectorAll: (selector) =>
        selector === "link[data-theme-id]" ? links : [],
      createElement: () => ({}),
      head: { appendChild: (element) => preloads.push(element.href) },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("static/js/boot.js", "utf8"), context);
  return { theme: context.Theme, root, storage, preloads };
}

test("follows the seasonal theme until a choice is stored", () => {
  const page = load({ themes: ["vice", "hiver"], seasonal: "hiver" });
  assert.equal(page.theme.choice(), SEASONAL);
  assert.equal(page.root.dataset.theme, "hiver");
  assert.deepEqual(page.preloads, [BASE + "hiver/cover.webp"]);
});

test("applies a stored theme outside its period", () => {
  const page = load({ themes: ["vice", "hiver"], stored: { theme: "vice" } });
  assert.equal(page.theme.choice(), "vice");
  assert.equal(page.root.dataset.theme, "vice");
  assert.deepEqual(page.preloads, [BASE + "vice/cover.webp"]);
});

test("the classic choice removes the seasonal theme", () => {
  const page = load({
    themes: ["hiver"],
    seasonal: "hiver",
    stored: { theme: CLASSIC },
  });
  assert.equal(page.theme.choice(), CLASSIC);
  assert.equal("theme" in page.root.dataset, false);
  assert.deepEqual(page.preloads, []);
});

test("a stored theme that no longer exists falls back to the season", () => {
  for (const stored of ["retired", "constructor", ""]) {
    const page = load({
      themes: ["hiver"],
      seasonal: "hiver",
      stored: { theme: stored },
    });
    assert.equal(page.theme.choice(), SEASONAL);
    assert.equal(page.root.dataset.theme, "hiver");
  }
});

test("choosing a theme stores it and applies it at once", () => {
  const page = load({ themes: ["vice", "hiver"], seasonal: "hiver" });
  page.theme.choose("vice");
  assert.equal(page.storage.get("theme"), "vice");
  assert.equal(page.root.dataset.theme, "vice");
  page.theme.choose(CLASSIC);
  assert.equal("theme" in page.root.dataset, false);
  page.theme.choose(SEASONAL);
  assert.equal(page.storage.has("theme"), false);
  assert.equal(page.root.dataset.theme, "hiver");
});

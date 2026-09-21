const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = {
  URLSearchParams,
  document: { readyState: "loading", addEventListener() {} },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("static/js/utils.js", "utf8"), context);
const utils = context.AppUtils;

test("French and decimal grades are parsed completely", () => {
  for (const [input, expected] of [
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["0", 0],
    ["20", 20],
    ["12abc", null],
    ["12,5,6", null],
    ["21", null],
    ["", null],
    [" ", null],
    [true, null],
    [[], null],
    [Infinity, null],
  ]) {
    assert.equal(utils.parseGrade(input, 0, 20), expected, String(input));
  }
  assert.equal(utils.parseGrade("75,5", 0, 100), 75.5);
});

test("malformed fragments cannot interrupt initialization", () => {
  assert.equal(utils.parseHash("#search=%").search, "%");
  assert.equal(utils.parseHash("#search=a%3Db").search, "a=b");
  assert.equal(
    utils.parseHash("#search=cours+communs").search,
    "cours communs",
  );
  assert.equal(Object.getPrototypeOf(utils.parseHash("#__proto__=x")), null);
});

test("fragments and configurable labels round trip", () => {
  const state = { view: "week", search: "réseau & cloud = test" };
  assert.equal(utils.parseHash(utils.buildHash(state)).search, state.search);
  assert.equal(
    utils.formatText("Note / {maximum}", { maximum: 100 }),
    "Note / 100",
  );
});

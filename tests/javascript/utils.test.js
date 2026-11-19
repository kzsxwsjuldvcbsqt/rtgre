const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = {
  URLSearchParams,
  Intl,
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

const limits = { daysMax: 13, weeksMax: 8 };

function relative(date, today) {
  const result = utils.relativeDay(date, today, limits);
  return [result.value, result.unit];
}

test("delays switch from days to weeks to months", () => {
  assert.deepEqual(relative("2026-11-15", "2026-11-15"), [0, "day"]);
  assert.deepEqual(relative("2026-11-16", "2026-11-15"), [1, "day"]);
  assert.deepEqual(relative("2026-11-28", "2026-11-15"), [13, "day"]);
  assert.deepEqual(relative("2026-11-29", "2026-11-15"), [2, "week"]);
  assert.deepEqual(relative("2027-01-10", "2026-11-15"), [8, "week"]);
  assert.deepEqual(relative("2027-02-01", "2026-11-15"), [3, "month"]);
  assert.deepEqual(relative("2026-11-10", "2026-11-15"), [-5, "day"]);
});

test("delays cross month and year boundaries by calendar day", () => {
  assert.deepEqual(relative("2026-12-01", "2026-11-30"), [1, "day"]);
  assert.deepEqual(relative("2027-01-01", "2026-12-31"), [1, "day"]);
});

test("delays are worded in the site language", () => {
  assert.equal(
    utils.formatRelativeDay({ value: 1, unit: "day" }, "fr"),
    "demain",
  );
  assert.equal(
    utils.formatRelativeDay({ value: 10, unit: "day" }, "fr"),
    "dans 10 jours",
  );
  assert.equal(
    utils.formatRelativeDay({ value: 3, unit: "week" }, "fr"),
    "dans 3 semaines",
  );
  assert.equal(
    utils.formatRelativeDay({ value: -2, unit: "day" }, "fr"),
    "avant-hier",
  );
});

test("search text ignores case, accents and extra spaces", () => {
  assert.equal(utils.normalizeSearch("  SAÉ501   Projet "), "sae501 projet");
  assert.equal(utils.normalizeSearch(""), "");
});

test("data age is counted in whole hours", () => {
  const built = "2026-11-18T08:00:00+01:00";
  assert.equal(
    utils.hoursSince(built, Date.parse("2026-11-18T08:59:59+01:00")),
    0,
  );
  assert.equal(
    utils.hoursSince(built, Date.parse("2026-11-18T20:00:00+01:00")),
    12,
  );
  assert.equal(
    utils.hoursSince(built, Date.parse("2026-11-19T09:30:00+01:00")),
    25,
  );
});

test("a pressed control must be usable", () => {
  let clicks = 0;
  const button = { disabled: false, hidden: false, click: () => clicks++ };
  assert.equal(utils.press(button), true);
  assert.equal(utils.press({ ...button, disabled: true }), false);
  assert.equal(utils.press({ ...button, hidden: true }), false);
  assert.equal(utils.press(null), false);
  assert.equal(clicks, 1);
});

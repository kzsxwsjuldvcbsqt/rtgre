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
global.AppUtils = context.AppUtils;

const model = require("../../static/js/grades-model.js");

const config = {
  semesters: [
    {
      id: "s5",
      units: [
        { id: "ue1", weight: 2 },
        { id: "ue2", weight: 1 },
      ],
      subjects: [
        { code: "R1", coeffs: { ue1: 2, ue2: 1 } },
        { code: "R2", coeffs: { ue1: 1, ue2: 1 } },
      ],
    },
  ],
  annual_units: [{ id: "annual", weight: 1, units: { s5: "ue1" } }],
};

test("grade averages are independent from the DOM", () => {
  const result = model.calculate({ R1: 10, R2: 20 }, config);
  assert.equal(result.units.ue1, 40 / 3);
  assert.equal(result.units.ue2, 15);
  assert.ok(Math.abs(result.semesters.s5 - 125 / 9) < 1e-12);
  assert.equal(result.annualUnits.annual, 40 / 3);
  assert.equal(result.global, 40 / 3);
});

test("grade data accepts compatible values and rejects unsafe structures", () => {
  assert.deepEqual(
    model.normalizeGrades({ R1: "12,5", removed: 18 }, ["R1", "R2"], {
      minimum: 0,
      maximum: 20,
      maxEntries: 3,
    }),
    { grades: { R1: 12.5 }, ignored: 1 },
  );
  assert.throws(
    () =>
      model.normalizeGrades({ R1: {} }, ["R1"], {
        minimum: 0,
        maximum: 20,
        maxEntries: 3,
      }),
    /format/,
  );
  assert.throws(
    () =>
      model.normalizeGrades({ R1: 10, R2: 12 }, ["R1", "R2"], {
        minimum: 0,
        maximum: 20,
        maxEntries: 1,
      }),
    /format/,
  );
});

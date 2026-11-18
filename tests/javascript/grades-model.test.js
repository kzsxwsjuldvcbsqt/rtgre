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
  annual_units: [{ id: "annual", units: { s5: "ue1" } }],
};

test("grade averages are independent from the DOM", () => {
  const result = model.calculate({ R1: 10, R2: 20 }, config);
  assert.equal(result.units.ue1, 40 / 3);
  assert.equal(result.units.ue2, 15);
  assert.ok(Math.abs(result.semesters.s5 - 125 / 9) < 1e-12);
  assert.equal(result.annualUnits.annual, 40 / 3);
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

const detailConfig = {
  semesters: [
    {
      id: "s5",
      units: [{ id: "ue1", weight: 1 }],
      subjects: [
        {
          code: "R1",
          coeffs: { ue1: 1 },
          evaluations: [
            { id: "tp", weight: 1 },
            { id: "ds", weight: 3 },
          ],
        },
        { code: "R2", coeffs: { ue1: 1 }, evaluations: [] },
      ],
    },
  ],
  annual_units: [],
};
const detailLimits = { minimum: 0, maximum: 20, maxEntries: 10 };

test("detailed module grades are weighted averages of entered evaluations", () => {
  assert.deepEqual(
    model.moduleGradesFromDetail({ R1: { tp: 8, ds: 16 } }, detailConfig),
    { R1: 14 },
  );
  assert.deepEqual(
    model.moduleGradesFromDetail({ R1: { ds: 12 } }, detailConfig),
    { R1: 12 },
  );
  assert.deepEqual(model.moduleGradesFromDetail({}, detailConfig), {});
});

test("detail mode replaces direct grades only for detailed modules", () => {
  const direct = { R1: 5, R2: 9 };
  const detail = { enabled: true, evaluations: { R1: { tp: 10, ds: 10 } } };
  assert.deepEqual(model.effectiveGrades(direct, detail, detailConfig), {
    R1: 10,
    R2: 9,
  });
  assert.deepEqual(
    model.effectiveGrades(
      direct,
      { enabled: true, evaluations: {} },
      detailConfig,
    ),
    { R2: 9 },
  );
  assert.equal(
    model.effectiveGrades(
      direct,
      { enabled: false, evaluations: {} },
      detailConfig,
    ),
    direct,
  );
});

test("detail data keeps known evaluations and counts the rest as ignored", () => {
  const result = model.normalizeDetail(
    {
      enabled: true,
      evaluations: { R1: { tp: "12,5", other: 4, ds: 25 }, R9: { x: 3 } },
    },
    detailConfig,
    detailLimits,
  );
  assert.deepEqual(result.detail, {
    enabled: true,
    evaluations: { R1: { tp: 12.5 } },
  });
  assert.equal(result.ignored, 3);
  assert.equal(result.entries, 4);
  assert.equal(
    model.normalizeDetail(
      { enabled: true },
      { semesters: [{ subjects: [] }] },
      detailLimits,
    ).detail.enabled,
    false,
  );
  assert.throws(() => model.normalizeDetail([], detailConfig, detailLimits));
  assert.throws(() =>
    model.normalizeDetail(
      { evaluations: { R1: { tp: {} } } },
      detailConfig,
      detailLimits,
    ),
  );
});

test("reads a backup file and names what is wrong with it", () => {
  const backup = { format: "notes", version: 2, class: "b3dc3", grades: {} };
  const read = (value) => model.parseBackup(JSON.stringify(value), "notes", 2);

  assert.deepEqual(read(backup), { data: backup });
  assert.deepEqual(read({ ...backup, detail: { enabled: true } }).data.detail, {
    enabled: true,
  });
  assert.deepEqual(model.parseBackup("{", "notes", 2), {
    error: "invalid_json",
  });
  assert.deepEqual(read({ ...backup, version: 3 }), {
    error: "newer_version",
  });
  for (const broken of [
    null,
    [],
    { ...backup, format: "other" },
    { ...backup, class: "" },
    { ...backup, class: 3 },
    { ...backup, grades: [] },
    { ...backup, grades: null },
    { ...backup, version: 0 },
    { ...backup, version: 1.5 },
    { ...backup, detail: null },
    { ...backup, detail: [] },
  ]) {
    assert.deepEqual(read(broken), { error: "bad_format" });
  }
});

test("the grade still needed is worked out per unit", () => {
  const needs = model.requirements({ R1: 8 }, config, 10);
  const byUnit = Object.fromEntries(needs.map((need) => [need.unit, need]));
  for (const need of needs) {
    assert.equal(need.semester, "s5");
    assert.ok(need.remaining >= 1);
  }
  const unit = config.semesters[0].units[0].id;
  const subjects = config.semesters[0].subjects.filter(
    (subject) => subject.coeffs[unit],
  );
  const total = subjects.reduce(
    (sum, subject) => sum + subject.coeffs[unit],
    0,
  );
  const graded = subjects.find((subject) => subject.code === "R1").coeffs[unit];
  assert.equal(byUnit[unit].remaining, subjects.length - 1);
  assert.equal(
    byUnit[unit].needed,
    (10 * total - 8 * graded) / (total - graded),
  );
  assert.deepEqual(model.requirements({}, config, 10), []);
  const full = Object.fromEntries(
    config.semesters.flatMap((semester) =>
      semester.subjects.map((subject) => [subject.code, 12]),
    ),
  );
  assert.deepEqual(model.requirements(full, config, 10), []);
});

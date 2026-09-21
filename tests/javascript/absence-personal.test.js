const test = require("node:test");
const assert = require("node:assert/strict");
const personal = require("../../static/js/absence-personal.js");
const model = require("../../static/js/absence-model.js");
const config = require("../../config/absences.json");
test("identity accepts Unicode names and rejects empty punctuation controls and oversized input", () => {
  for (const name of [
    "Élodie",
    "Jean-Luc",
    "O’Connor",
    "D’Ambrosio",
    "de La Tour",
    "李",
    "E\u0301lodie",
    "J. Dupont",
  ])
    assert.ok(personal.validName(name, 100), name);
  for (const name of [
    "",
    "---",
    "...",
    "\u0301",
    "123",
    "Jean3",
    "A\nB",
    "a".repeat(101),
  ])
    assert.equal(personal.validName(name, 100), false, name);
});
test("PDF data has independent text limits and a real signature date unrestricted by school year", () => {
  const values = {
    lastName: "O’Connor",
    firstName: "Élodie",
    reason: "Motif libre < >\nAutre ligne",
    date: "2028-01-01",
  };
  assert.deepEqual(personal.validate(values, config, model.civilDate), values);
  assert.throws(
    () =>
      personal.validate(
        { ...values, date: "2026-02-30" },
        config,
        model.civilDate,
      ),
    /sheet_signing_date_invalid/,
  );
  assert.throws(
    () =>
      personal.validate(
        { ...values, reason: "x".repeat(config.max_text_length + 1) },
        config,
        model.civilDate,
      ),
    /sheet_invalid_reason/,
  );
});

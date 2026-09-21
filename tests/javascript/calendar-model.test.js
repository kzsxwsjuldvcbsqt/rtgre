const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../../static/js/calendar-model.js");

function event(overrides = {}) {
  return {
    occurrence_id: "one",
    start: "2026-09-08T08:00:00+02:00",
    end: "2026-09-08T10:00:00+02:00",
    title: "R501",
    slug: "r501",
    module: "R501",
    category: null,
    rooms: [],
    teachers: [],
    staff_markers: [],
    groups: [],
    flags: [],
    ...overrides,
  };
}

test("calendar civil dates and simulated instants are validated exactly", () => {
  assert.ok(model.parseCivilDate("2026-09-08"));
  assert.equal(model.parseCivilDate("2026-02-30"), null);
  assert.equal(model.parseCivilDate("08-09-2026"), null);
  assert.equal(model.validSiteDateTime("2026-09-08T10:30"), true);
  assert.equal(model.validSiteDateTime("2026-09-08T25:30"), false);
  assert.equal(model.validInstant("2026-09-08T10:30:00+02:00"), true);
  assert.equal(model.validInstant("tomorrow"), false);
});

test("comparison events are canonicalized before calendar rendering", () => {
  const source = event({ unknown: "discarded", title: "<img onerror=x>" });
  const normalized = model.normalizeEnvelope(
    { class: "b3cya", events: [source] },
    "b3cya",
    10,
  );
  assert.equal(normalized[0].title, "<img onerror=x>");
  assert.equal(normalized[0].unknown, undefined);
  assert.throws(
    () =>
      model.normalizeEnvelope(
        { class: "b3cya", events: [event({ start: "invalid" })] },
        "b3cya",
        10,
      ),
    /format/,
  );
  assert.throws(
    () =>
      model.normalizeEnvelope(
        { class: "b3cya", events: [event(), event()] },
        "b3cya",
        1,
      ),
    /format/,
  );
});

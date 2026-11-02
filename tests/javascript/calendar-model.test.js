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

test("calendar events are canonicalized before rendering", () => {
  const source = event({ unknown: "discarded", title: "<img onerror=x>" });
  const normalized = model.normalizeEnvelope(
    { class: "b3cya", events: [source] },
    "b3cya",
  );
  assert.equal(normalized[0].title, "<img onerror=x>");
  assert.equal(normalized[0].unknown, undefined);
  assert.throws(
    () =>
      model.normalizeEnvelope(
        { class: "b3cya", events: [event({ start: "invalid" })] },
        "b3cya",
      ),
    /format/,
  );
  assert.throws(
    () =>
      model.normalizeEnvelope({ class: "b3cyb", events: [event()] }, "b3cya"),
    /format/,
  );
});

test("break boundaries are replaced by the real start and end times", () => {
  const events = [
    event({
      start: "2026-09-08T08:00:00+02:00",
      end: "2026-09-08T10:00:00+02:00",
    }),
    event({
      start: "2026-09-08T10:00:00+02:00",
      end: "2026-09-08T12:00:00+02:00",
    }),
  ];
  model.applyBreaks(events, [
    { boundary: "10:00", before: "09:50", after: "10:10" },
  ]);
  assert.equal(events[0].end, "2026-09-08T09:50:00+02:00");
  assert.equal(events[1].start, "2026-09-08T10:10:00+02:00");
  assert.equal(events[0].start, "2026-09-08T08:00:00+02:00");
});

test("an instant is converted to the wall clock of the site timezone", () => {
  const local = model.inSiteTimezone(
    new Date("2026-09-08T06:30:00Z"),
    "Europe/Paris",
  );
  assert.equal(local.getHours(), 8);
  assert.equal(local.getMinutes(), 30);
});

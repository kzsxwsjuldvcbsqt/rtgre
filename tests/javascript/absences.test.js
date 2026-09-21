const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../../static/js/absence-model.js");
const validation = require("../../static/js/absence-records.js");
const persistence = require("../../static/js/absence-store.js");
const config = require("../../config/absences.json");
const context = {
  config,
  classId: "test",
  year: {
    first_date: "2026-09-01",
    last_date: "2027-07-31",
    label: "2026-2027",
  },
  timezone: "Europe/Paris",
};
const events = model.normalizeCourses(
  [
    {
      start: "2026-09-08T08:00:00+02:00",
      end: "2026-09-08T10:00:00+02:00",
      title: "R501-A",
      module: "R501",
      category: "",
    },
    {
      start: "2026-09-08T10:00:00+02:00",
      end: "2026-09-08T12:00:00+02:00",
      title: "R502-DS",
      module: "R502",
      category: "ds",
    },
    {
      start: "2026-09-08T11:00:00+02:00",
      end: "2026-09-08T13:00:00+02:00",
      title: "R503",
      module: "R503",
      category: "",
    },
    {
      start: "2026-09-09T13:30:00+02:00",
      end: "2026-09-09T15:30:00+02:00",
      title: "R501-B",
      module: "R501",
      category: "",
    },
  ],
  { ds: "DS" },
);
function record(selection, options = {}) {
  const course =
      selection.mode === "course"
        ? events.find((item) => item.key === selection.courseKey)
        : null,
    range = course
      ? model.courseRecordRange(course, config)
      : model.rangeFor(selection, config),
    courses = course
      ? [model.selectedCourse(course)]
      : model.findCourses(events, range);
  return {
    ...range,
    kind: "absence",
    selectionMode: selection.mode,
    selectedCourseKey: course?.key || "",
    id: options.id || crypto.randomUUID(),
    courses,
    halfDays: model
      .affectedHalfDays(courses, range, config)
      .map(({ date, period }) => ({ date, period })),
    justificationAvailable: !!options.justificationAvailable,
    submitted: !!options.submitted,
    createdAt: "2026-09-10T12:00:00Z",
    updatedAt: "2026-09-10T12:00:00Z",
  };
}
test("day, half-day and inclusive multi-day selections preserve the configured boundary", () => {
  assert.equal(record({ mode: "day", date: "2026-09-08" }).halfDays.length, 2);
  assert.equal(
    record({ mode: "half_day", date: "2026-09-08", period: "morning" }).halfDays
      .length,
    1,
  );
  const range = record({
    mode: "range",
    startDate: "2026-09-08",
    startPeriod: "morning",
    endDate: "2026-09-10",
    endPeriod: "morning",
  });
  assert.equal(range.end, "2026-09-10T12:00");
  assert.equal(model.summarize(range).minutes, 420);
});
test("continuous multi-day ranges include intermediate days and respect the inclusive final boundary", () => {
  const schedule = model.normalizeCourses(
      [
        {
          start: "2026-09-07T08:00:00+02:00",
          end: "2026-09-07T10:00:00+02:00",
          title: "Monday",
          module: "R1",
          category: "",
        },
        {
          start: "2026-09-08T15:00:00+02:00",
          end: "2026-09-08T17:00:00+02:00",
          title: "Tuesday",
          module: "R2",
          category: "",
        },
        {
          start: "2026-09-09T09:00:00+02:00",
          end: "2026-09-09T11:00:00+02:00",
          title: "Wednesday",
          module: "R3",
          category: "",
        },
        {
          start: "2026-09-10T09:00:00+02:00",
          end: "2026-09-10T11:00:00+02:00",
          title: "Thursday morning",
          module: "R4",
          category: "",
        },
        {
          start: "2026-09-10T14:00:00+02:00",
          end: "2026-09-10T16:00:00+02:00",
          title: "Thursday afternoon",
          module: "R5",
          category: "",
        },
      ],
      {},
    ),
    full = model.rangeFor(
      {
        mode: "range",
        startDate: "2026-09-07",
        startPeriod: "morning",
        endDate: "2026-09-10",
        endPeriod: "afternoon",
      },
      config,
    ),
    morning = model.rangeFor(
      {
        mode: "range",
        startDate: "2026-09-07",
        startPeriod: "morning",
        endDate: "2026-09-10",
        endPeriod: "morning",
      },
      config,
    );
  assert.deepEqual(
    model.findCourses(schedule, full).map((item) => item.title),
    [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday morning",
      "Thursday afternoon",
    ],
  );
  assert.deepEqual(
    model.findCourses(schedule, morning).map((item) => item.title),
    ["Monday", "Tuesday", "Wednesday", "Thursday morning"],
  );
  assert.equal(full.end, "2026-09-11T00:00");
  assert.equal(morning.end, "2026-09-10T12:00");
});
test("same-date boundaries are accepted only when coherent", () => {
  assert.equal(
    model.rangeFor(
      {
        mode: "range",
        startDate: "2026-09-08",
        startPeriod: "morning",
        endDate: "2026-09-08",
        endPeriod: "morning",
      },
      config,
    ).end,
    "2026-09-08T12:00",
  );
  assert.equal(
    model.rangeFor(
      {
        mode: "range",
        startDate: "2026-09-08",
        startPeriod: "afternoon",
        endDate: "2026-09-08",
        endPeriod: "afternoon",
      },
      config,
    ).end,
    "2026-09-09T00:00",
  );
  assert.throws(
    () =>
      model.rangeFor(
        {
          mode: "range",
          startDate: "2026-09-08",
          startPeriod: "afternoon",
          endDate: "2026-09-08",
          endPeriod: "morning",
        },
        config,
      ),
    /range/,
  );
  assert.throws(
    () =>
      model.rangeFor(
        {
          mode: "range",
          startDate: "2026-09-10",
          startPeriod: "morning",
          endDate: "2026-09-09",
          endPeriod: "afternoon",
        },
        config,
      ),
    /range/,
  );
});
test("an isolated course keeps only its occurrence and crossing courses affect both half-days", () => {
  const single = record({ mode: "course", courseKey: events[1].key });
  assert.equal(single.courses.length, 1);
  assert.equal(single.courses[0].title, "R502-DS");
  assert.equal(single.halfDays.length, 1);
  const crossing = record({ mode: "day", date: "2026-09-08" });
  assert.deepEqual(
    crossing.halfDays.map((item) => item.period),
    ["morning", "afternoon"],
  );
  assert.equal(model.summarize(crossing).minutes, 300);
});
test("covered occurrences are refused but two different courses on one morning are allowed once in the annual total", () => {
  const first = record(
      { mode: "course", courseKey: events[0].key },
      { id: "first", justificationAvailable: true },
    ),
    second = record(
      { mode: "course", courseKey: events[1].key },
      { id: "second" },
    );
  assert.equal(model.coveredRecord([first], second, null), null);
  assert.equal(
    model.coveredRecord([first], { ...first, id: "copy" }, null).id,
    "first",
  );
  assert.deepEqual(model.annualSummary([first, second], config), {
    total: 1,
    justified: 0,
    unjustified: 1,
    review: 0,
  });
});
test("annual statuses are exclusive and legacy data remains to review", () => {
  const justified = record(
    { mode: "half_day", date: "2026-09-08", period: "morning" },
    { id: "yes", justificationAvailable: true },
  );
  const legacy = {
    kind: "legacy",
    id: "old",
    original: {
      ...justified,
      id: "old",
      start: "2026-09-08T09:00",
      end: "2026-09-08T10:00",
    },
  };
  assert.deepEqual(model.annualSummary([justified, legacy], config), {
    total: 1,
    justified: 0,
    unjustified: 0,
    review: 1,
  });
});
test("v1 migration and current storage validate atomically", () => {
  const saved = record({ mode: "day", date: "2026-09-08" }),
    payload = {
      format: config.export_format,
      version: 1,
      class: context.classId,
      schoolYear: context.year.label,
      timezone: context.timezone,
      records: [
        {
          ...saved,
          kind: undefined,
          selectionMode: undefined,
          selectedCourseKey: undefined,
        },
      ],
    };
  assert.equal(validation.migratePayload(payload, context)[0].kind, "legacy");
  const map = new Map(),
    store = persistence.create(
      context,
      () => ({
        getItem: (key) => map.get(key) || null,
        setItem: (key, value) => map.set(key, value),
        removeItem: (key) => map.delete(key),
      }),
      validation.validatePayload,
      validation.migratePayload,
    );
  store.save([saved]);
  assert.deepEqual(store.load(), [saved]);
  assert.throws(() =>
    validation.migratePayload(
      { ...store.payload([saved]), class: "other" },
      context,
    ),
  );
  assert.deepEqual(store.load(), [saved]);
});
test("clearing storage is isolated and reports an unavailable storage without deleting other data", () => {
  const saved = record({ mode: "day", date: "2026-09-08" }),
    map = new Map(),
    storage = {
      getItem: (key) => map.get(key) || null,
      setItem: (key, value) => map.set(key, value),
      removeItem: (key) => map.delete(key),
    },
    current = persistence.create(
      context,
      () => storage,
      validation.validatePayload,
      validation.migratePayload,
    ),
    other = persistence.create(
      { ...context, classId: "other" },
      () => storage,
      validation.validatePayload,
      validation.migratePayload,
    );
  current.save([saved]);
  other.save([{ ...saved, id: "other" }]);
  map.set("grades_test", '{"R501":14}');
  current.clear();
  assert.deepEqual(current.load(), []);
  assert.equal(other.load()[0].id, "other");
  assert.equal(map.get("grades_test"), '{"R501":14}');
  const unavailable = persistence.create(
    context,
    () => ({
      removeItem() {
        throw new Error("unavailable");
      },
    }),
    validation.validatePayload,
    validation.migratePayload,
  );
  assert.throws(() => unavailable.clear(), /unavailable/);
});

test("current records reject invalid identifiers, modes, display dates and timestamps", () => {
  const saved = record({ mode: "course", courseKey: events[0].key });
  const payload = (value) => ({
    format: config.export_format,
    version: config.export_format_version,
    class: context.classId,
    schoolYear: context.year.label,
    timezone: context.timezone,
    records: [value],
  });
  assert.throws(
    () =>
      validation.validatePayload(
        payload({ ...saved, id: { value: "x" } }),
        context,
      ),
    /format/,
  );
  assert.throws(
    () =>
      validation.validatePayload(
        payload({ ...saved, id: 'record"] [autofocus]' }),
        context,
      ),
    /format/,
  );
  assert.throws(
    () =>
      validation.validatePayload(
        payload({ ...saved, selectionMode: "unknown" }),
        context,
      ),
    /format/,
  );
  assert.throws(
    () =>
      validation.validatePayload(
        payload({ ...saved, startDate: "2026-02-30" }),
        context,
      ),
    /format/,
  );
  assert.throws(
    () =>
      validation.validatePayload(
        payload({ ...saved, updatedAt: "yesterday" }),
        context,
      ),
    /format/,
  );
});

test("course and text limits are enforced and unknown fields are not propagated", () => {
  const saved = record({ mode: "day", date: "2026-09-08" });
  const payload = {
    format: config.export_format,
    version: config.export_format_version,
    class: context.classId,
    schoolYear: context.year.label,
    timezone: context.timezone,
    records: [{ ...saved, unknown: "discarded" }],
  };
  const canonical = validation.validatePayload(payload, context);
  assert.equal(canonical[0].unknown, undefined);
  const limited = {
    ...context,
    config: { ...config, max_courses_per_record: 2 },
  };
  assert.throws(() => validation.validatePayload(payload, limited), /format/);
  const totalLimited = {
    ...context,
    config: { ...config, max_total_text_length: 10 },
  };
  assert.throws(
    () => validation.validatePayload(payload, totalLimited),
    /format/,
  );
  assert.throws(
    () =>
      validation.validatePayload(
        { ...payload, exportedAt: "not-an-instant" },
        context,
      ),
    /format/,
  );
});

test("v1 migration rejects duplicate identifiers and keeps midnight endings on the preceding day", () => {
  const saved = record({ mode: "day", date: "2026-09-08" }, { id: "legacy" });
  const legacy = { ...saved };
  delete legacy.kind;
  delete legacy.selectionMode;
  delete legacy.selectedCourseKey;
  const payload = {
    format: config.export_format,
    version: 1,
    class: context.classId,
    schoolYear: context.year.label,
    timezone: context.timezone,
    records: [legacy, { ...legacy }],
  };
  assert.throws(() => validation.migratePayload(payload, context), /format/);
  const migrated = validation.migratePayload(
    { ...payload, records: [legacy] },
    context,
  )[0];
  assert.deepEqual(model.selectionFromLegacy(migrated, config), {
    mode: "range",
    startDate: "2026-09-08",
    startPeriod: "morning",
    endDate: "2026-09-08",
    endPeriod: "afternoon",
  });
});

test("a course ending at the configured boundary belongs only to the morning", () => {
  const morningCourse = events.find(
    (course) => course.end === "2026-09-08T12:00",
  );
  const range = model.courseRecordRange(morningCourse, config);
  assert.equal(range.endPeriod, "morning");
  assert.deepEqual(
    model
      .affectedHalfDays([model.selectedCourse(morningCourse)], range, config)
      .map((item) => item.period),
    ["morning"],
  );
});

test("storage detects an external replacement after loading", () => {
  const saved = record({ mode: "day", date: "2026-09-08" });
  const map = new Map();
  const storage = {
    getItem: (key) => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
  const first = persistence.create(
    context,
    () => storage,
    validation.validatePayload,
    validation.migratePayload,
  );
  const second = persistence.create(
    context,
    () => storage,
    validation.validatePayload,
    validation.migratePayload,
  );
  first.load();
  second.load();
  first.save([saved]);
  assert.throws(() => second.save([{ ...saved, id: "second" }]), /conflict/);
  assert.equal(first.load()[0].id, saved.id);
});

test("instant rejects impossible calendar dates while accepting valid ones", () => {
  const validInstant = "2026-02-28T10:00:00+01:00";
  const impossibleInstant = "2026-02-30T10:00:00+01:00";
  const saved = record({ mode: "day", date: "2026-09-08" });
  const payload = (createdAt) => ({
    format: config.export_format,
    version: config.export_format_version,
    class: context.classId,
    schoolYear: context.year.label,
    timezone: context.timezone,
    records: [{ ...saved, createdAt, updatedAt: createdAt }],
  });
  assert.doesNotThrow(() =>
    validation.validatePayload(payload(validInstant), context),
  );
  assert.throws(
    () => validation.validatePayload(payload(impossibleInstant), context),
    /format/,
  );
});

test("a v2 course record with legacy endPeriod=afternoon on a noon-ending course is accepted and normalized", () => {
  const noonCourse = events.find((c) => c.end === "2026-09-08T12:00");
  assert.ok(
    noonCourse,
    "fixture must include a course ending exactly at 12:00",
  );
  const currentRange = model.courseRecordRange(noonCourse, config);
  assert.equal(currentRange.endPeriod, "morning");
  const legacyRecord = {
    kind: "absence",
    id: "legacy-noon-test",
    selectionMode: "course",
    selectedCourseKey: noonCourse.key,
    start: currentRange.start,
    end: currentRange.end,
    startDate: currentRange.startDate,
    startPeriod: currentRange.startPeriod,
    endDate: currentRange.endDate,
    endPeriod: "afternoon",
    courses: [model.selectedCourse(noonCourse)],
    halfDays: [{ date: currentRange.endDate, period: "morning" }],
    justificationAvailable: false,
    submitted: false,
    createdAt: "2026-09-10T12:00:00Z",
    updatedAt: "2026-09-10T12:00:00Z",
  };
  const payload = {
    format: config.export_format,
    version: config.export_format_version,
    class: context.classId,
    schoolYear: context.year.label,
    timezone: context.timezone,
    records: [legacyRecord],
  };
  const canonical = validation.validatePayload(payload, context);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].endPeriod, "morning");
  assert.equal(canonical[0].halfDays.length, 1);
  assert.equal(canonical[0].halfDays[0].period, "morning");
});

test("save rejects a payload that exceeds max_import_bytes when pretty-printed", () => {
  const saved = record({ mode: "day", date: "2026-09-08" });
  const map = new Map();
  const tinyContext = {
    ...context,
    config: { ...config, max_import_bytes: 10 },
  };
  const store = persistence.create(
    tinyContext,
    () => ({
      getItem: (key) => map.get(key) || null,
      setItem: (key, value) => map.set(key, value),
      removeItem: (key) => map.delete(key),
    }),
    validation.validatePayload,
    validation.migratePayload,
  );
  assert.throws(() => store.save([saved]), /size/);
  assert.equal(map.size, 0);
});

test("historical course keys resolve to a unique current occurrence without merging distinct occurrences", () => {
  const old = { ...events[0] };
  const current = { ...old, key: "occurrence:first", occurrenceId: "first" };
  const other = { ...old, key: "occurrence:second", occurrenceId: "second" };
  assert.equal(model.matchingCourses(old, [current]).length, 1);
  assert.equal(model.matchingCourses(old, [current, other]).length, 2);
  assert.equal(model.matchingCourses(current, [current, other]).length, 1);
  assert.equal(model.sameCourseSnapshot([old], [current]), true);
  assert.equal(model.sameCourseSnapshot([current], [other]), false);
  assert.equal(
    model.coveredRecord(
      [{ kind: "absence", id: "old", courses: [old] }],
      { id: "new", courses: [current] },
      null,
    ).id,
    "old",
  );
  assert.equal(
    model.coveredRecord(
      [{ kind: "absence", id: "first", courses: [current] }],
      { id: "new", courses: [other] },
      null,
    ),
    null,
  );
});

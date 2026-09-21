const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../../static/js/tasks-model.js");
const { create } = require("../../static/js/tasks-store.js");
const config = require("../../config/tasks.json");

const context = {
  classId: "b3cy1",
  schoolYear: "2026-2027",
  config,
};

function item(overrides = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    text: "Préparer le rendu <script>alert(1)</script>",
    createdAt: "2026-09-14T10:00:00.000Z",
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

function payload(items = [item()], overrides = {}) {
  return {
    format: config.export_format,
    version: config.export_format_version,
    class: context.classId,
    schoolYear: context.schoolYear,
    exportedAt: "2026-09-14T10:00:00.000Z",
    items,
    ...overrides,
  };
}

test("free text is normalized and preserved as data", () => {
  const created = model.createItem(
    "  Première ligne\r\n<script>alert(1)</script>  ",
    item().id,
    item().createdAt,
    config,
  );
  assert.equal(created.text, "Première ligne\n<script>alert(1)</script>");
  assert.throws(
    () => model.createItem(" \n ", item().id, item().createdAt, config),
    /empty/,
  );
  assert.throws(
    () => model.createItem("a\u0000b", item().id, item().createdAt, config),
    /text/,
  );
});

test("imports enforce identity limits and canonical records", () => {
  assert.deepEqual(model.validatePayload(payload(), context), [item()]);
  assert.throws(
    () =>
      model.validatePayload(payload(undefined, { class: "b3cy2" }), context),
    /class/,
  );
  assert.throws(
    () =>
      model.validatePayload(
        payload(undefined, { schoolYear: "2025-2026" }),
        context,
      ),
    /year/,
  );
  assert.throws(
    () => model.validatePayload(payload([item(), item()]), context),
    /format/,
  );
  assert.throws(
    () =>
      model.validatePayload(
        payload([item({ text: "x".repeat(config.max_text_length + 1) })]),
        context,
      ),
    /format/,
  );
});

test("storage is scoped and detects concurrent changes", () => {
  const values = new Map(),
    storage = {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
      removeItem(key) {
        values.delete(key);
      },
    },
    store = create(
      context,
      () => storage,
      model.validatePayload,
      () => {},
    );
  assert.equal(store.key, "tasks_b3cy1_2026-2027");
  assert.deepEqual(store.load(), []);
  assert.deepEqual(store.save([item()]), [item()]);
  values.set(store.key, JSON.stringify(payload([])));
  assert.throws(() => store.save([]), /conflict/);
});

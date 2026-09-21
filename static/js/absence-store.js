(function (global) {
  function create(
    context,
    getStorage,
    validatePayload,
    migratePayload,
    assertWritable = () => {},
  ) {
    const key = [
      context.config.storage_key_prefix,
      context.classId,
      context.year.label,
    ].join("_");
    let baseline;

    function payload(records) {
      return {
        format: context.config.export_format,
        version: context.config.export_format_version,
        class: context.classId,
        schoolYear: context.year.label,
        timezone: context.timezone,
        exportedAt: new Date().toISOString(),
        records,
      };
    }

    function current(storage) {
      return storage.getItem(key);
    }

    function assertCurrent(storage) {
      if (baseline !== undefined && current(storage) !== baseline) {
        throw new Error("conflict");
      }
    }

    return {
      key,
      payload,
      load() {
        const storage = getStorage();
        const raw = current(storage);
        baseline = raw;
        if (raw === null) {
          return [];
        }
        const records = migratePayload(JSON.parse(raw), context);
        return records;
      },
      save(records) {
        assertWritable();
        const storage = getStorage();
        assertCurrent(storage);
        const data = payload(records);
        data.records = validatePayload(data, context);
        if (
          new TextEncoder().encode(JSON.stringify(data, null, 2)).byteLength >
          context.config.max_import_bytes
        ) {
          throw new Error("size");
        }
        const raw = JSON.stringify(data);
        storage.setItem(key, raw);
        baseline = raw;
        return data.records;
      },
      clear() {
        assertWritable();
        const storage = getStorage();
        assertCurrent(storage);
        storage.removeItem(key);
        baseline = null;
      },
    };
  }

  const api = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.AbsenceStore = api;
})(globalThis);

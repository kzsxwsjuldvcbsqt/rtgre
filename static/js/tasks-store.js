(function (global) {
  function create(context, getStorage, validatePayload, assertWritable) {
    const key = [
      context.config.storage_key_prefix,
      context.classId,
      context.schoolYear,
    ].join("_");
    let baseline;

    function payload(items) {
      return {
        format: context.config.export_format,
        version: context.config.export_format_version,
        class: context.classId,
        schoolYear: context.schoolYear,
        exportedAt: new Date().toISOString(),
        items,
      };
    }

    function current(storage) {
      return storage.getItem(key);
    }

    function assertCurrent(storage) {
      if (baseline !== undefined && current(storage) !== baseline)
        throw new Error("conflict");
    }

    return {
      key,
      payload,
      load() {
        const storage = getStorage(),
          raw = current(storage);
        baseline = raw;
        return raw === null ? [] : validatePayload(JSON.parse(raw), context);
      },
      save(items) {
        assertWritable();
        const storage = getStorage();
        assertCurrent(storage);
        const data = payload(items);
        data.items = validatePayload(data, context);
        const raw = JSON.stringify(data);
        if (
          new TextEncoder().encode(raw).byteLength >
          context.config.max_import_bytes
        )
          throw new Error("size");
        storage.setItem(key, raw);
        baseline = raw;
        return data.items;
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
  else global.TasksStore = api;
})(globalThis);

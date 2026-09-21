(function (global) {
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeText(value) {
    return typeof value === "string"
      ? value.replace(/\r\n?/g, "\n").trim()
      : "";
  }

  function validText(value, config) {
    const text = normalizeText(value);
    return (
      text.length > 0 &&
      text.length <= config.max_text_length &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    );
  }

  function validInstant(value) {
    return (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
      Number.isFinite(Date.parse(value))
    );
  }

  function canonicalItem(value, config) {
    if (!isObject(value) || Object.keys(value).length !== 4) return null;
    if (
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(value.id || "") ||
      !validText(value.text, config) ||
      !validInstant(value.createdAt) ||
      !validInstant(value.updatedAt) ||
      value.updatedAt < value.createdAt
    )
      return null;
    return {
      id: value.id,
      text: normalizeText(value.text),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  function validateItems(values, config) {
    if (!Array.isArray(values) || values.length > config.max_items)
      throw new Error("limit");
    const ids = new Set();
    let total = 0;
    const items = values.map(function (value) {
      const item = canonicalItem(value, config);
      if (!item || ids.has(item.id)) throw new Error("format");
      ids.add(item.id);
      total += item.text.length;
      if (total > config.max_total_text_length) throw new Error("size");
      return item;
    });
    return items;
  }

  function validatePayload(value, context) {
    if (!isObject(value)) throw new Error("format");
    if (value.format !== context.config.export_format)
      throw new Error("format");
    if (value.version !== context.config.export_format_version)
      throw new Error("version");
    if (value.class !== context.classId) throw new Error("class");
    if (value.schoolYear !== context.schoolYear) throw new Error("year");
    if (!validInstant(value.exportedAt)) throw new Error("format");
    return validateItems(value.items, context.config);
  }

  function createItem(text, id, instant, config) {
    const normalized = normalizeText(text);
    if (!normalized) throw new Error("empty");
    if (!validText(normalized, config)) throw new Error("text");
    const item = {
      id,
      text: normalized,
      createdAt: instant,
      updatedAt: instant,
    };
    const canonical = canonicalItem(item, config);
    if (!canonical) throw new Error("format");
    return canonical;
  }

  const api = {
    normalizeText,
    validText,
    validateItems,
    validatePayload,
    createItem,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.TasksModel = api;
})(globalThis);

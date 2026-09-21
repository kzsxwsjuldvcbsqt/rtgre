(function (global) {
  const model =
    typeof module !== "undefined" && module.exports
      ? require("./absence-model.js")
      : global.AbsenceModel;
  const {
    rangeFromRecord,
    civilTime,
    civilDate,
    legacyCourseKey,
    withinYear,
    affectedHalfDays,
    courseRecordRange,
    rangeFor,
  } = model;
  const MODES = new Set(["day", "half_day", "course", "range"]);
  const PERIODS = new Set(["morning", "afternoon"]);
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function validText(value, maximum, allowEmpty = true) {
    return (
      typeof value === "string" &&
      value.length <= maximum &&
      (allowEmpty || value.trim().length > 0)
    );
  }

  function instant(value) {
    return (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) &&
      Number.isFinite(Date.parse(value)) &&
      civilDate(value.slice(0, 10))
    );
  }

  function courseTextSize(course) {
    return [
      course.key,
      course.title,
      course.module,
      course.category,
      course.categoryLabel,
      course.occurrenceId || "",
    ].reduce(function (total, value) {
      return total + value.length;
    }, 0);
  }

  function canonicalCourse(course, record, keys, context) {
    const maximum = context.config.max_text_length;
    if (!isObject(course)) return null;
    const textFields = ["key", "title", "module", "category", "categoryLabel"];
    if (
      !textFields.every(function (key) {
        return validText(
          course[key],
          maximum,
          key !== "key" && key !== "title",
        );
      }) ||
      !["start", "end", "missedStart", "missedEnd"].every(function (key) {
        return Number.isFinite(civilTime(course[key]));
      })
    ) {
      return null;
    }
    if (
      course.start >= course.end ||
      course.missedStart >= course.missedEnd ||
      course.missedStart < course.start ||
      course.missedEnd > course.end ||
      course.missedStart < record.start ||
      course.missedEnd > record.end
    ) {
      return null;
    }
    const occurrenceId = course.occurrenceId;
    if (
      occurrenceId !== undefined &&
      occurrenceId !== "" &&
      !validText(occurrenceId, context.config.max_id_length, false)
    ) {
      return null;
    }
    const expectedKeys = new Set([legacyCourseKey(course)]);
    if (occurrenceId) expectedKeys.add("occurrence:" + occurrenceId);
    if (!expectedKeys.has(course.key) || keys.has(course.key)) return null;
    keys.add(course.key);
    const canonical = {
      key: course.key,
      start: course.start,
      end: course.end,
      title: course.title,
      module: course.module,
      category: course.category,
      categoryLabel: course.categoryLabel,
      missedStart: course.missedStart,
      missedEnd: course.missedEnd,
    };
    if (occurrenceId !== undefined) canonical.occurrenceId = occurrenceId;
    return canonical;
  }

  function canonicalCourses(record, context) {
    if (
      !Array.isArray(record.courses) ||
      record.courses.length > context.config.max_courses_per_record
    ) {
      return null;
    }
    const keys = new Set();
    const courses = record.courses.map(function (course) {
      return canonicalCourse(course, record, keys, context);
    });
    if (
      courses.some(function (course) {
        return course === null;
      })
    )
      return null;
    return courses;
  }

  function validIdentifier(value, context) {
    return (
      validText(value, context.config.max_id_length, false) &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    );
  }

  function canonicalLegacySource(record, context) {
    if (
      !isObject(record) ||
      !validIdentifier(record.id, context) ||
      !Number.isFinite(civilTime(record.start)) ||
      !Number.isFinite(civilTime(record.end)) ||
      record.start >= record.end ||
      !withinYear(record, context.year)
    ) {
      return null;
    }
    const courses = canonicalCourses(record, context);
    if (!courses) return null;
    const source = {
      id: record.id,
      start: record.start,
      end: record.end,
      courses,
    };
    if (instant(record.createdAt)) source.createdAt = record.createdAt;
    if (instant(record.updatedAt)) source.updatedAt = record.updatedAt;
    return source;
  }

  function canonicalHalfDays(record, range, context) {
    if (!Array.isArray(record.halfDays)) return null;
    const actual = [];
    const keys = new Set();
    for (const item of record.halfDays) {
      if (
        !isObject(item) ||
        !civilDate(item.date) ||
        !PERIODS.has(item.period)
      ) {
        return null;
      }
      const key = item.date + ":" + item.period;
      if (keys.has(key)) return null;
      keys.add(key);
      actual.push({ date: item.date, period: item.period });
    }
    const expected = new Set(
      affectedHalfDays(record.courses, range, context.config).map(
        function (item) {
          return item.key;
        },
      ),
    );
    if (actual.length !== expected.size) return null;
    return actual.every(function (item) {
      return expected.has(item.date + ":" + item.period);
    })
      ? actual
      : null;
  }

  function canonicalCurrentRecord(record, context) {
    if (
      !isObject(record) ||
      record.kind !== "absence" ||
      !validIdentifier(record.id, context) ||
      !MODES.has(record.selectionMode) ||
      typeof record.justificationAvailable !== "boolean" ||
      typeof record.submitted !== "boolean" ||
      !instant(record.createdAt) ||
      !instant(record.updatedAt)
    ) {
      return null;
    }
    let range = rangeFromRecord(record);
    if (
      !withinYear(range, context.year) ||
      !Number.isFinite(civilTime(range.start)) ||
      !Number.isFinite(civilTime(range.end)) ||
      range.start >= range.end ||
      !civilDate(range.startDate) ||
      !civilDate(range.endDate) ||
      !PERIODS.has(range.startPeriod) ||
      !PERIODS.has(range.endPeriod)
    ) {
      return null;
    }
    const courses = canonicalCourses(record, context);
    if (!courses) return null;
    const courseRecord = { ...record, courses };
    if (record.selectionMode === "course") {
      if (
        !validText(
          record.selectedCourseKey,
          context.config.max_text_length,
          false,
        ) ||
        courses.length !== 1 ||
        courses[0].key !== record.selectedCourseKey ||
        courses[0].missedStart !== courses[0].start ||
        courses[0].missedEnd !== courses[0].end
      ) {
        return null;
      }
      const expected = courseRecordRange(courses[0], context.config);
      const rangeKeys = Object.keys(expected);
      if (
        rangeKeys.some(function (key) {
          return expected[key] !== range[key];
        })
      ) {
        const legacyNoon =
          expected.endPeriod === "morning" &&
          range.endPeriod === "afternoon" &&
          courses[0].end.slice(11) === context.config.afternoon_start &&
          rangeKeys.every(function (key) {
            return key === "endPeriod" || expected[key] === range[key];
          });
        if (!legacyNoon) return null;
        range = { ...range, endPeriod: "morning" };
      }
    } else {
      let declared;
      try {
        const selection =
          record.selectionMode === "day"
            ? { mode: "day", date: record.startDate }
            : record.selectionMode === "half_day"
              ? {
                  mode: "half_day",
                  date: record.startDate,
                  period: record.startPeriod,
                }
              : { mode: "range", ...range };
        declared = rangeFor(selection, context.config);
      } catch (error) {
        return null;
      }
      if (
        Object.keys(declared).some(function (key) {
          return declared[key] !== range[key];
        })
      ) {
        return null;
      }
    }
    const halfDays = canonicalHalfDays(courseRecord, range, context);
    if (!halfDays) return null;
    return {
      kind: "absence",
      id: record.id,
      selectionMode: record.selectionMode,
      selectedCourseKey:
        record.selectionMode === "course" ? record.selectedCourseKey : "",
      ...range,
      courses,
      halfDays,
      justificationAvailable: record.justificationAvailable,
      submitted: record.submitted,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  function canonicalRecord(record, context) {
    if (!isObject(record)) return null;
    if (record.kind === "legacy") {
      const original = canonicalLegacySource(record.original, context);
      return original && record.id === original.id
        ? { kind: "legacy", id: record.id, original }
        : null;
    }
    return canonicalCurrentRecord(record, context);
  }

  function validateEnvelope(payload, context) {
    if (!isObject(payload) || payload.format !== context.config.export_format) {
      throw new Error("format");
    }
    if (payload.class !== context.classId) throw new Error("class");
    if (
      payload.schoolYear !== context.year.label ||
      payload.timezone !== context.timezone
    ) {
      throw new Error("year");
    }
    if (
      !Array.isArray(payload.records) ||
      payload.records.length > context.config.max_records
    ) {
      throw new Error("format");
    }
  }

  function validatePayload(payload, context) {
    validateEnvelope(payload, context);
    if (payload.version !== context.config.export_format_version) {
      throw new Error("version");
    }
    if (payload.exportedAt !== undefined && !instant(payload.exportedAt)) {
      throw new Error("format");
    }
    const records = payload.records.map(function (record) {
      return canonicalRecord(record, context);
    });
    if (
      records.some(function (record) {
        return record === null;
      }) ||
      new Set(
        records.map(function (record) {
          return record.id;
        }),
      ).size !== records.length ||
      records.reduce(function (total, record) {
        const source = record.kind === "legacy" ? record.original : record;
        return (
          total +
          record.id.length +
          source.courses.reduce(function (size, course) {
            return size + courseTextSize(course);
          }, 0)
        );
      }, 0) > context.config.max_total_text_length
    ) {
      throw new Error("format");
    }
    return records;
  }

  function migratePayload(payload, context) {
    validateEnvelope(payload, context);
    if (payload.version === context.config.export_format_version) {
      return validatePayload(payload, context);
    }
    if (
      !context.config.legacy_export_format_versions.includes(payload.version)
    ) {
      throw new Error("version");
    }
    const originals = payload.records.map(function (record) {
      return canonicalLegacySource(record, context);
    });
    if (
      originals.some(function (record) {
        return record === null;
      }) ||
      new Set(
        originals.map(function (record) {
          return record.id;
        }),
      ).size !== originals.length ||
      originals.reduce(function (total, record) {
        return (
          total +
          record.id.length +
          record.courses.reduce(function (size, course) {
            return size + courseTextSize(course);
          }, 0)
        );
      }, 0) > context.config.max_total_text_length
    ) {
      throw new Error("format");
    }
    return originals.map(function (original) {
      return { kind: "legacy", id: original.id, original };
    });
  }

  const api = { validatePayload, migratePayload };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.AbsenceRecords = api;
})(globalThis);

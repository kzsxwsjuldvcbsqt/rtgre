(function (global) {
  const MINUTE_MS = 60000;
  const DAY_MS = 86400000;
  const MODES = new Set(["day", "half_day", "course", "range"]);
  const PERIODS = new Set(["morning", "afternoon"]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function civilTime(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ) {
      return NaN;
    }
    const time = Date.parse(value + ":00Z");
    return Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 16) === value
      ? time
      : NaN;
  }

  function civilDate(value) {
    return (
      typeof value === "string" && Number.isFinite(civilTime(value + "T00:00"))
    );
  }

  function nextDate(date) {
    const time = civilTime(date + "T00:00");
    return Number.isFinite(time)
      ? new Date(time + DAY_MS).toISOString().slice(0, 10)
      : "";
  }

  function previousDate(date) {
    const time = civilTime(date + "T00:00");
    return Number.isFinite(time)
      ? new Date(time - DAY_MS).toISOString().slice(0, 10)
      : "";
  }

  function legacyCourseKey(course) {
    return JSON.stringify([
      course.start,
      course.end,
      course.title,
      course.module,
    ]);
  }

  function courseKey(course) {
    const occurrenceId = course.occurrenceId || course.occurrence_id;
    return typeof occurrenceId === "string" && occurrenceId
      ? "occurrence:" + occurrenceId
      : legacyCourseKey(course);
  }

  function normalizeCourses(events, categories) {
    const unique = new Map();
    events.forEach(function (event) {
      if (!isObject(event)) return;
      const occurrenceId =
        typeof event.occurrence_id === "string" ? event.occurrence_id : "";
      const course = {
        start: typeof event.start === "string" ? event.start.slice(0, 16) : "",
        end: typeof event.end === "string" ? event.end.slice(0, 16) : "",
        title: typeof event.title === "string" ? event.title : "",
        module: typeof event.module === "string" ? event.module : "",
        category: typeof event.category === "string" ? event.category : "",
        categoryLabel:
          typeof categories[event.category] === "string"
            ? categories[event.category]
            : "",
        occurrenceId,
      };
      if (
        Number.isFinite(civilTime(course.start)) &&
        Number.isFinite(civilTime(course.end)) &&
        course.start < course.end &&
        course.title
      ) {
        course.key = courseKey(course);
        unique.set(course.key, course);
      }
    });
    return Array.from(unique.values()).sort(function (left, right) {
      return (
        left.start.localeCompare(right.start) ||
        left.end.localeCompare(right.end) ||
        left.title.localeCompare(right.title) ||
        left.key.localeCompare(right.key)
      );
    });
  }

  function halfDayStart(date, period, config) {
    return (
      date + "T" + (period === "morning" ? "00:00" : config.afternoon_start)
    );
  }

  function periodFor(value, config) {
    return value.slice(11) < config.afternoon_start ? "morning" : "afternoon";
  }

  function periodForEnd(value, config) {
    const date = value.slice(0, 10);
    const time = value.slice(11);
    if (time === "00:00") {
      return { date: previousDate(date), period: "afternoon" };
    }
    return {
      date,
      period: time <= config.afternoon_start ? "morning" : "afternoon",
    };
  }

  function rangeFor(selection, config) {
    if (!isObject(selection) || !MODES.has(selection.mode)) {
      throw new Error("mode");
    }
    let startDate;
    let startPeriod;
    let endDate;
    let endPeriod;
    if (selection.mode === "day") {
      startDate = selection.date;
      endDate = selection.date;
      startPeriod = "morning";
      endPeriod = "afternoon";
    } else if (selection.mode === "half_day") {
      startDate = selection.date;
      endDate = selection.date;
      startPeriod = selection.period;
      endPeriod = selection.period;
    } else if (selection.mode === "range") {
      startDate = selection.startDate;
      startPeriod = selection.startPeriod;
      endDate = selection.endDate;
      endPeriod = selection.endPeriod;
    } else {
      throw new Error("course");
    }
    if (
      !civilDate(startDate) ||
      !civilDate(endDate) ||
      !PERIODS.has(startPeriod) ||
      !PERIODS.has(endPeriod)
    ) {
      throw new Error("range");
    }
    const start = halfDayStart(startDate, startPeriod, config);
    const end =
      endPeriod === "morning"
        ? halfDayStart(endDate, "afternoon", config)
        : nextDate(endDate) + "T00:00";
    if (
      !Number.isFinite(civilTime(start)) ||
      !Number.isFinite(civilTime(end)) ||
      end <= start
    ) {
      throw new Error("range");
    }
    return { start, end, startDate, startPeriod, endDate, endPeriod };
  }

  function courseRecordRange(course, config) {
    if (
      !isObject(course) ||
      !Number.isFinite(civilTime(course.start)) ||
      !Number.isFinite(civilTime(course.end)) ||
      course.start >= course.end
    ) {
      throw new Error("course");
    }
    const ending = periodForEnd(course.end, config);
    return {
      start: course.start,
      end: course.end,
      startDate: course.start.slice(0, 10),
      startPeriod: periodFor(course.start, config),
      endDate: ending.date,
      endPeriod: ending.period,
    };
  }

  function rangeFromRecord(record) {
    return {
      start: record.start,
      end: record.end,
      startDate: record.startDate,
      startPeriod: record.startPeriod,
      endDate: record.endDate,
      endPeriod: record.endPeriod,
    };
  }

  function selectionFromLegacy(record, config) {
    const source = record.original;
    const ending = periodForEnd(source.end, config);
    return {
      mode: "range",
      startDate: source.start.slice(0, 10),
      startPeriod: periodFor(source.start, config),
      endDate: ending.date,
      endPeriod: ending.period,
    };
  }

  function withinYear(range, year) {
    return (
      range.start >= year.first_date + "T00:00" &&
      range.end <= nextDate(year.last_date) + "T00:00"
    );
  }

  function halfDaysForRange(range, config) {
    const result = [];
    let date = range.start.slice(0, 10);
    while (date && date + "T00:00" < range.end) {
      ["morning", "afternoon"].forEach(function (period) {
        const start = halfDayStart(date, period, config);
        const end =
          period === "morning"
            ? halfDayStart(date, "afternoon", config)
            : nextDate(date) + "T00:00";
        if (start < range.end && end > range.start) {
          result.push({ key: date + ":" + period, date, period, start, end });
        }
      });
      date = nextDate(date);
    }
    return result;
  }

  function findCourses(courses, range) {
    return courses
      .filter(function (course) {
        return course.start < range.end && course.end > range.start;
      })
      .map(function (course) {
        return {
          ...course,
          missedStart: course.start > range.start ? course.start : range.start,
          missedEnd: course.end < range.end ? course.end : range.end,
        };
      });
  }

  function selectedCourse(course) {
    return { ...course, missedStart: course.start, missedEnd: course.end };
  }

  function affectedHalfDays(courses, range, config) {
    return halfDaysForRange(range, config).filter(function (halfDay) {
      return courses.some(function (course) {
        return (
          course.missedStart < halfDay.end && course.missedEnd > halfDay.start
        );
      });
    });
  }

  function unionMinutes(courses) {
    const intervals = courses
      .map(function (course) {
        return [civilTime(course.missedStart), civilTime(course.missedEnd)];
      })
      .filter(function (interval) {
        return interval.every(Number.isFinite);
      })
      .sort(function (left, right) {
        return left[0] - right[0];
      });
    let total = 0;
    let end = -Infinity;
    intervals.forEach(function (interval) {
      total += Math.max(0, interval[1] - Math.max(end, interval[0]));
      end = Math.max(end, interval[1]);
    });
    return total / MINUTE_MS;
  }

  function summarize(record) {
    const courses = record.courses || [];
    const seen = new Set();
    const evaluations = [];
    courses.forEach(function (course) {
      if (course.category && !seen.has(course.key)) {
        seen.add(course.key);
        evaluations.push({
          title: course.title,
          start: course.start,
          end: course.end,
        });
      }
    });
    return {
      halfDays: record.halfDays || [],
      modules: Array.from(
        new Set(
          courses.map(function (course) {
            return course.module || course.title;
          }),
        ),
      ),
      evaluations,
      minutes: unionMinutes(courses),
    };
  }

  function sameCourseSnapshot(left, right) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    ) {
      return false;
    }
    const fields = [
      "start",
      "end",
      "title",
      "module",
      "category",
      "categoryLabel",
      "missedStart",
      "missedEnd",
    ];
    return left.every(function (course, index) {
      return (
        sameOccurrence(course, right[index]) &&
        fields.every(function (field) {
          return (course[field] || "") === (right[index][field] || "");
        })
      );
    });
  }

  function sameOccurrence(left, right) {
    if (left.occurrenceId && right.occurrenceId)
      return left.occurrenceId === right.occurrenceId;
    return legacyCourseKey(left) === legacyCourseKey(right);
  }

  function matchingCourses(saved, courses) {
    return courses.filter((course) => sameOccurrence(saved, course));
  }

  function coveredRecord(records, record, excludedId) {
    return (
      records.find(
        (existing) =>
          existing.id !== excludedId &&
          existing.kind === "absence" &&
          existing.courses.some((saved) =>
            record.courses.some((course) => sameOccurrence(saved, course)),
          ),
      ) || null
    );
  }

  function annualSummary(records, config) {
    const days = new Map();
    records.forEach(function (record) {
      const source =
        record.kind === "legacy"
          ? {
              courses: record.original.courses,
              range: record.original,
              status: null,
            }
          : {
              courses: record.courses,
              range: record,
              status: record.justificationAvailable,
            };
      affectedHalfDays(source.courses, source.range, config).forEach(
        function (halfDay) {
          const statuses = days.get(halfDay.key) || [];
          statuses.push(source.status);
          days.set(halfDay.key, statuses);
        },
      );
    });
    const result = {
      total: days.size,
      justified: 0,
      unjustified: 0,
      review: 0,
    };
    days.forEach(function (statuses) {
      if (statuses.includes(false)) result.unjustified += 1;
      else if (statuses.includes(null)) result.review += 1;
      else result.justified += 1;
    });
    return result;
  }

  const api = {
    legacyCourseKey,
    civilTime,
    civilDate,
    nextDate,
    courseKey,
    normalizeCourses,
    rangeFor,
    courseRecordRange,
    rangeFromRecord,
    selectionFromLegacy,
    withinYear,
    halfDaysForRange,
    findCourses,
    selectedCourse,
    affectedHalfDays,
    summarize,
    sameCourseSnapshot,
    coveredRecord,
    matchingCourses,
    sameOccurrence,
    annualSummary,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.AbsenceModel = api;
})(globalThis);

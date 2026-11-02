(function (global) {
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function parseCivilDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const parts = value.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (
      date.getFullYear() !== parts[0] ||
      date.getMonth() !== parts[1] - 1 ||
      date.getDate() !== parts[2]
    ) {
      return null;
    }
    return date;
  }

  function validInstant(value) {
    return (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) &&
      Number.isFinite(Date.parse(value)) &&
      parseCivilDate(value.slice(0, 10)) !== null
    );
  }

  function validSiteDateTime(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
    ) {
      return false;
    }
    const parts = value.split("T");
    if (!parseCivilDate(parts[0])) return false;
    const time = parts[1].split(":").map(Number);
    return (
      time[0] <= 23 && time[1] <= 59 && (time[2] === undefined || time[2] <= 59)
    );
  }

  function text(value) {
    return typeof value === "string" ? value : null;
  }

  function texts(value) {
    return Array.isArray(value) &&
      value.every(function (item) {
        return typeof item === "string";
      })
      ? value.slice()
      : null;
  }

  function normalizeEvent(event) {
    if (
      !isObject(event) ||
      !validInstant(event.start) ||
      !validInstant(event.end)
    ) {
      return null;
    }
    if (Date.parse(event.start) >= Date.parse(event.end)) return null;
    const title = text(event.title);
    const slug = text(event.slug);
    const module = text(event.module);
    const category = event.category === null ? null : text(event.category);
    const rooms = texts(event.rooms);
    const teachers = texts(event.teachers);
    const staffMarkers = texts(event.staff_markers);
    const groups = texts(event.groups);
    const flags = texts(event.flags);
    if (
      title === null ||
      slug === null ||
      module === null ||
      !(event.category === null || typeof event.category === "string") ||
      rooms === null ||
      teachers === null ||
      staffMarkers === null ||
      groups === null ||
      flags === null
    ) {
      return null;
    }
    return {
      occurrence_id: text(event.occurrence_id) || "",
      start: event.start,
      end: event.end,
      title,
      slug,
      module,
      category,
      rooms,
      teachers,
      staff_markers: staffMarkers,
      groups,
      flags,
    };
  }

  function normalizeEnvelope(data, classId) {
    if (
      !isObject(data) ||
      data.class !== classId ||
      !Array.isArray(data.events)
    ) {
      throw new Error("format");
    }
    const events = data.events.map(normalizeEvent);
    if (
      events.some(function (event) {
        return event === null;
      })
    ) {
      throw new Error("format");
    }
    return events;
  }

  function applyBreaks(events, breaks) {
    function remap(instant, isStart) {
      const time = instant.substring(11, 16);
      const match = breaks.find(function (entry) {
        return entry.boundary === time;
      });
      if (!match) return instant;
      return (
        instant.substring(0, 11) +
        (isStart ? match.after : match.before) +
        instant.substring(16)
      );
    }
    events.forEach(function (event) {
      event.start = remap(event.start, true);
      event.end = remap(event.end, false);
    });
  }

  function inSiteTimezone(date, timezone) {
    const values = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .forEach(function (part) {
        values[part.type] = part.value;
      });
    return new Date(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
  }

  const api = {
    applyBreaks,
    inSiteTimezone,
    normalizeEnvelope,
    parseCivilDate,
    validInstant,
    validSiteDateTime,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.CalendarModel = api;
})(globalThis);

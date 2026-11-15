(function (global) {
  const settings =
    (document.currentScript && document.currentScript.dataset) || {};

  const MS_PER_DAY = 86400000;
  const DAYS_PER_WEEK = 7;
  const MONTHS_PER_YEAR = 12;

  function dayNumber(iso) {
    const parts = iso.split("-").map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2]) / MS_PER_DAY;
  }

  function relativeDay(dateIso, todayIso, limits) {
    const days = dayNumber(dateIso) - dayNumber(todayIso);
    if (Math.abs(days) <= limits.daysMax) return { value: days, unit: "day" };
    const weeks = Math.round(days / DAYS_PER_WEEK);
    if (Math.abs(weeks) <= limits.weeksMax) {
      return { value: weeks, unit: "week" };
    }
    const date = dateIso.split("-").map(Number);
    const today = todayIso.split("-").map(Number);
    return {
      value: (date[0] - today[0]) * MONTHS_PER_YEAR + date[1] - today[1],
      unit: "month",
    };
  }

  function formatRelativeDay(relative, language) {
    return new Intl.RelativeTimeFormat(language, {
      numeric: relative.unit === "day" ? "auto" : "always",
    }).format(relative.value, relative.unit);
  }

  function todayIn(timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const byType = {};
    parts.forEach(function (part) {
      byType[part.type] = part.value;
    });
    return [byType.year, byType.month, byType.day].join("-");
  }

  function stripAccents(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeSearch(str) {
    return stripAccents(str).toLowerCase().split(/\s+/).join(" ").trim();
  }

  function slugify(str) {
    if (!str) return "";
    const cleaned = stripAccents(str).toLowerCase();
    return cleaned.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function parseHash(hashStr) {
    const result = Object.create(null);
    const params = new URLSearchParams((hashStr || "").replace(/^#/, ""));
    params.forEach(function (value, key) {
      result[key] = value;
    });
    return result;
  }

  function formatText(template, values) {
    return template.replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key)
        ? String(values[key])
        : match;
    });
  }

  function parseGrade(value, minimum, maximum) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const normalized = String(value).trim().replace(",", ".");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const number = Number(normalized);
    return Number.isFinite(number) && number >= minimum && number <= maximum
      ? number
      : null;
  }

  function buildHash(obj) {
    const parts = [];
    Object.keys(obj).forEach(function (key) {
      if (obj[key] !== null && obj[key] !== undefined && obj[key] !== "") {
        parts.push(
          encodeURIComponent(key) + "=" + encodeURIComponent(obj[key]),
        );
      }
    });
    return parts.length > 0 ? "#" + parts.join("&") : "";
  }

  function safeStorageGet(key, isSession) {
    try {
      const storage = isSession ? window.sessionStorage : window.localStorage;
      return storage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeStorageSet(key, val, isSession) {
    try {
      const storage = isSession ? window.sessionStorage : window.localStorage;
      storage.setItem(key, val);
    } catch (e) {}
  }

  function safeStorageRemove(key, isSession) {
    try {
      const storage = isSession ? window.sessionStorage : window.localStorage;
      storage.removeItem(key);
    } catch (e) {}
  }

  function onDOMReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function bindBlurKeys(elements, options) {
    const settings = options || {};
    Array.prototype.forEach.call(elements, function (element) {
      element.addEventListener("keydown", function (event) {
        if (event.isComposing) return;
        const isEscape = event.key === "Escape";
        const isEnter = event.key === "Enter";
        if (!isEscape && !isEnter) return;
        if (isEnter && settings.multiline && event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (isEnter && settings.submit) settings.submit();
        else element.blur();
      });
    });
  }

  function buildIcon(href, className) {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", className ? "icon " + className : "icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS(svgNs, "use");
    use.setAttribute("href", href);
    svg.appendChild(use);
    return svg;
  }

  global.AppUtils = {
    buildIcon: buildIcon,
    formatText: formatText,
    parseGrade: parseGrade,
    stripAccents: stripAccents,
    slugify: slugify,
    parseHash: parseHash,
    buildHash: buildHash,
    safeStorageGet: safeStorageGet,
    safeStorageSet: safeStorageSet,
    safeStorageRemove: safeStorageRemove,
    bindBlurKeys: bindBlurKeys,
    onDOMReady: onDOMReady,
    normalizeSearch: normalizeSearch,
    relativeDay: relativeDay,
    formatRelativeDay: formatRelativeDay,
  };

  onDOMReady(function () {
    document.body.classList.add("js-ready");

    const activeSection = document.querySelector(
      ".app-nav a[aria-current='page']",
    );
    if (activeSection) {
      const sectionMenu = activeSection.closest(".app-nav");
      const linkBox = activeSection.getBoundingClientRect();
      const menuBox = sectionMenu.getBoundingClientRect();
      sectionMenu.scrollLeft +=
        linkBox.left - menuBox.left - (menuBox.width - linkBox.width) / 2;
    }

    let pastTimer;
    function updatePastEvaluations() {
      clearTimeout(pastTimer);
      const now = Date.now();
      let nextEnd = Infinity;
      const todayIso = todayIn(settings.timezone);
      const limits = {
        daysMax: Number(settings.relativeDaysMax),
        weeksMax: Number(settings.relativeWeeksMax),
      };
      document.querySelectorAll("[data-end-timestamp]").forEach(function (row) {
        const end = Number(row.dataset.endTimestamp) * 1000;
        if (!Number.isFinite(end)) return;
        const past = end <= now;
        row.dataset.past = String(past);
        if (!past) nextEnd = Math.min(nextEnd, end);
        const delay = row.querySelector("[data-relative-date]");
        if (!delay) return;
        const relative = relativeDay(
          delay.dataset.relativeDate,
          todayIso,
          limits,
        );
        delay.textContent = formatRelativeDay(relative, settings.language);
        row.classList.toggle(
          "is-soon",
          !past &&
            relative.unit === "day" &&
            relative.value >= 0 &&
            relative.value <= Number(settings.soonDays),
        );
      });
      document.dispatchEvent(new Event("evaluations-time-change"));
      if (Number.isFinite(nextEnd))
        pastTimer = setTimeout(
          updatePastEvaluations,
          Math.min(nextEnd - now + 1, 2147483647),
        );
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) updatePastEvaluations();
    });
    updatePastEvaluations();

    const headingToggles = Array.prototype.slice.call(
      document.querySelectorAll(
        ".heading-toggle-btn:not(.semester-toggle-btn)",
      ),
    );
    headingToggles.forEach(function (btn) {
      const targetId = btn.getAttribute("aria-controls");
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      const storageKey = "heading_toggle_" + targetId;
      const savedState = safeStorageGet(storageKey);

      if (savedState === "collapsed") {
        btn.setAttribute("aria-expanded", "false");
        targetEl.hidden = true;
        const arrowInit = btn.querySelector(".toggle-arrow");
        if (arrowInit) {
          arrowInit.classList.add("is-collapsed");
        }
      } else if (savedState === "expanded") {
        btn.setAttribute("aria-expanded", "true");
        targetEl.hidden = false;
        const arrowInitExp = btn.querySelector(".toggle-arrow");
        if (arrowInitExp) {
          arrowInitExp.classList.remove("is-collapsed");
        }
      }

      btn.addEventListener("click", function () {
        const isExpanded = btn.getAttribute("aria-expanded") === "true";
        const nextExpanded = !isExpanded;
        btn.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
        targetEl.hidden = !nextExpanded;
        const arrow = btn.querySelector(".toggle-arrow");
        if (arrow) {
          arrow.classList.toggle("is-collapsed", !nextExpanded);
        }
        safeStorageSet(storageKey, nextExpanded ? "expanded" : "collapsed");
      });
    });
  });
})(this);

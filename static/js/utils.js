(function (global) {
  function stripAccents(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function slugify(str) {
    if (!str) return "";
    var cleaned = stripAccents(str).toLowerCase();
    return cleaned.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function parseHash(hashStr) {
    var result = Object.create(null);
    var params = new URLSearchParams((hashStr || "").replace(/^#/, ""));
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
    var normalized = String(value).trim().replace(",", ".");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    var number = Number(normalized);
    return Number.isFinite(number) && number >= minimum && number <= maximum
      ? number
      : null;
  }

  function buildHash(obj) {
    var parts = [];
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
      var storage = isSession ? window.sessionStorage : window.localStorage;
      return storage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeStorageSet(key, val, isSession) {
    try {
      var storage = isSession ? window.sessionStorage : window.localStorage;
      storage.setItem(key, val);
    } catch (e) {}
  }

  function safeStorageRemove(key, isSession) {
    try {
      var storage = isSession ? window.sessionStorage : window.localStorage;
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
    var settings = options || {};
    Array.prototype.forEach.call(elements, function (element) {
      element.addEventListener("keydown", function (event) {
        if (event.isComposing) return;
        var isEscape = event.key === "Escape";
        var isEnter = event.key === "Enter";
        if (!isEscape && !isEnter) return;
        if (isEnter && settings.multiline && event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (isEnter && settings.submit) settings.submit();
        else element.blur();
      });
    });
  }

  global.AppUtils = {
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
  };

  onDOMReady(function () {
    document.body.classList.add("js-ready");

    var activeSection = document.querySelector(
      ".section-nav a[aria-current='page']",
    );
    if (activeSection) {
      var sectionMenu = activeSection.closest(".nav-menu");
      var linkBox = activeSection.getBoundingClientRect();
      var menuBox = sectionMenu.getBoundingClientRect();
      sectionMenu.scrollLeft +=
        linkBox.left - menuBox.left - (menuBox.width - linkBox.width) / 2;
    }

    var pastTimer;
    function updatePastEvaluations() {
      clearTimeout(pastTimer);
      var now = Date.now();
      var nextEnd = Infinity;
      document.querySelectorAll(".eval-row").forEach(function (row) {
        var end = Number(row.dataset.endTimestamp) * 1000;
        if (!Number.isFinite(end)) return;
        var past = end <= now;
        row.dataset.past = String(past);
        var badge = row.querySelector(".badge-past");
        if (badge) badge.hidden = !past;
        if (!past) nextEnd = Math.min(nextEnd, end);
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

    var headingToggles = Array.prototype.slice.call(
      document.querySelectorAll(
        ".heading-toggle-btn:not(.semester-toggle-btn)",
      ),
    );
    headingToggles.forEach(function (btn) {
      var targetId = btn.getAttribute("aria-controls");
      var targetEl = document.getElementById(targetId);
      if (!targetEl) return;

      var storageKey = "heading_toggle_" + targetId;
      var savedState = safeStorageGet(storageKey);

      if (savedState === "collapsed") {
        btn.setAttribute("aria-expanded", "false");
        targetEl.hidden = true;
        var arrowInit = btn.querySelector(".toggle-arrow");
        if (arrowInit) {
          arrowInit.classList.add("is-collapsed");
        }
      } else if (savedState === "expanded") {
        btn.setAttribute("aria-expanded", "true");
        targetEl.hidden = false;
        var arrowInitExp = btn.querySelector(".toggle-arrow");
        if (arrowInitExp) {
          arrowInitExp.classList.remove("is-collapsed");
        }
      }

      btn.addEventListener("click", function () {
        var isExpanded = btn.getAttribute("aria-expanded") === "true";
        var nextExpanded = !isExpanded;
        btn.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
        targetEl.hidden = !nextExpanded;
        var arrow = btn.querySelector(".toggle-arrow");
        if (arrow) {
          arrow.classList.toggle("is-collapsed", !nextExpanded);
        }
        safeStorageSet(storageKey, nextExpanded ? "expanded" : "collapsed");
      });
    });
  });
})(this);

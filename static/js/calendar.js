(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var scriptEl = document.querySelector("script[data-class-id]");
    if (!scriptEl) return;

    var currentClassId = scriptEl.getAttribute("data-class-id");
    var firstDateStr = scriptEl.getAttribute("data-first-date");
    var lastDateStr = scriptEl.getAttribute("data-last-date");
    var schoolYearLabel = scriptEl.getAttribute("data-school-year-label");
    var calendarConfig = JSON.parse(
      scriptEl.getAttribute("data-calendar-config"),
    );
    var allowedDays = calendarConfig.days_of_week;
    var timezone = scriptEl.getAttribute("data-timezone");
    var displayMode = scriptEl.getAttribute("data-display-mode");

    var categoriesJson = JSON.parse(
      scriptEl.getAttribute("data-categories-json") || "[]",
    );
    var categoryMap = {};
    categoriesJson.forEach(function (c) {
      categoryMap[c.id] = c;
    });

    var labels = JSON.parse(scriptEl.getAttribute("data-labels-json") || "{}");
    var classLabels = JSON.parse(
      scriptEl.getAttribute("data-class-labels-json") || "{}",
    );

    var controlsEl = document.getElementById("calendar-controls");
    var navBarEl = document.getElementById("calendar-nav-bar");
    var savedControlsState = AppUtils.safeStorageGet(
      "heading_toggle_calendar-controls",
    );
    if (controlsEl && savedControlsState !== "collapsed")
      controlsEl.hidden = false;
    if (navBarEl) navBarEl.hidden = false;

    var initialEventsScript = document.getElementById("class-events-data");
    var currentClassEvents = [];
    if (initialEventsScript) {
      try {
        var rawEventsData = JSON.parse(initialEventsScript.textContent);
        currentClassEvents = CalendarModel.normalizeEnvelope(
          rawEventsData,
          currentClassId,
          calendarConfig.max_comparison_events,
        );
      } catch (error) {
        currentClassEvents = [];
      }
    }

    var comparisonCache = Object.create(null);
    var renderVersion = 0;

    var viewSelect = document.getElementById("cal-view-select");
    var dateInput = document.getElementById("cal-date-input");
    var dateGroup = document.getElementById("cal-date-input-group");

    var compareSelect = document.getElementById("cal-compare-select");
    var compCheckboxes = document.getElementById("cal-comp-checkboxes");
    var evalsOnlyCb = document.getElementById("cal-evals-only");
    var teacherlessCb = document.getElementById("cal-teacherless-only");
    var searchInput = document.getElementById("cal-search-input");
    var resetBtn = document.getElementById("cal-reset-btn");

    var prevBtn = document.getElementById("cal-prev-btn");
    var todayBtn = document.getElementById("cal-today-btn");
    var nextBtn = document.getElementById("cal-next-btn");
    var periodHeading = document.getElementById("cal-period-heading");
    var messageEl = document.getElementById("calendar-message");
    var viewContainer = document.getElementById("calendar-view-container");

    var searchTimeout = null;
    var timeMarkerTimer = null;
    var lastWrittenHash = "";

    function parseISODate(str) {
      return CalendarModel.parseCivilDate(str) || new Date(NaN);
    }

    function formatISODate(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, "0");
      var day = String(d.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    }

    function toWeekday(d, direction) {
      var date = new Date(d.getTime());
      var dir = direction >= 0 ? 1 : -1;
      while (
        allowedDays.indexOf(date.getDay() || 7) === -1 &&
        !isNaN(date.getTime())
      ) {
        date.setDate(date.getDate() + dir);
      }
      return date;
    }

    function getNextWeekday(d) {
      var next = new Date(d.getTime());
      next.setDate(next.getDate() + 1);
      return toWeekday(next, 1);
    }

    function getPrevWeekday(d) {
      var prev = new Date(d.getTime());
      prev.setDate(prev.getDate() - 1);
      return toWeekday(prev, -1);
    }

    var minDate = toWeekday(parseISODate(firstDateStr), 1);
    var maxDate = toWeekday(parseISODate(lastDateStr), -1);
    function normalizeDate(date) {
      if (isNaN(date.getTime())) return new Date(minDate.getTime());
      var normalized = toWeekday(date, 1);
      return new Date(
        Math.min(
          Math.max(normalized.getTime(), minDate.getTime()),
          maxDate.getTime(),
        ),
      );
    }

    var defaultDateStr = formatISODate(normalizeDate(getNowDate().date));

    var state = {
      view: calendarConfig.default_view,
      date: defaultDateStr,
      compare: "",
      sameOnly: false,
      showCompared: false,
      evals: false,
      teacherless: false,
      search: "",
    };

    var dayNames = labels.days;
    var monthNames = labels.months;

    function getWeekStart(d) {
      var date = new Date(d.getTime());
      var day = date.getDay();
      var diff = date.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(date.setDate(diff));
    }

    function getISOWeekNumber(d) {
      var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      var dayNum = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - dayNum);
      var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    }

    function stopTimeMarkerTimer() {
      if (timeMarkerTimer) {
        clearInterval(timeMarkerTimer);
        timeMarkerTimer = null;
      }
    }

    function inSiteTimezone(date) {
      var parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date);
      var values = {};
      parts.forEach(function (part) {
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

    function getNowDate() {
      var hashObj = AppUtils.parseHash(window.location.hash);
      if (
        hashObj.now &&
        (CalendarModel.validInstant(hashObj.now) ||
          CalendarModel.validSiteDateTime(hashObj.now))
      ) {
        var d = new Date(hashObj.now);
        if (!isNaN(d.getTime())) {
          return {
            date: /(?:Z|[+-]\d{2}:?\d{2})$/i.test(hashObj.now)
              ? inSiteTimezone(d)
              : d,
            isSimulated: true,
          };
        }
      }
      return { date: inSiteTimezone(new Date()), isSimulated: false };
    }

    function updateTimeMarker() {
      var existingMarker = document.getElementById("current-time-marker");
      if (existingMarker) existingMarker.remove();

      var ongoingBadges = document.querySelectorAll(".ongoing-badge");
      ongoingBadges.forEach(function (b) {
        b.remove();
      });

      document.querySelectorAll(".course-progress").forEach(function (el) {
        el.remove();
      });
      document
        .querySelectorAll(".calendar-event-item.is-ongoing")
        .forEach(function (el) {
          el.classList.remove("is-ongoing");
        });

      var nowInfo = getNowDate();
      var now = nowInfo.date;
      var todayIso = formatISODate(now);

      var todaySection = document.getElementById("day-section-" + todayIso);
      if (!todaySection) {
        stopTimeMarkerTimer();
        return;
      }

      var eventsList = todaySection.querySelector(".calendar-events-list");
      if (!eventsList) {
        stopTimeMarkerTimer();
        return;
      }

      var eventItems = Array.from(
        eventsList.querySelectorAll(".calendar-event-item"),
      );
      if (eventItems.length === 0) {
        stopTimeMarkerTimer();
        return;
      }

      var nowHours = String(now.getHours()).padStart(2, "0");
      var nowMins = String(now.getMinutes()).padStart(2, "0");
      var nowTimeStr = nowHours + ":" + nowMins;

      var markerEl = document.createElement("li");
      markerEl.id = "current-time-marker";
      markerEl.className = "current-time-marker";

      var timeSpan = document.createElement("span");
      timeSpan.className = "current-time-text";
      timeSpan.textContent = nowTimeStr;
      markerEl.appendChild(timeSpan);

      var lineEl = document.createElement("hr");
      lineEl.className = "current-time-line";
      markerEl.appendChild(lineEl);

      function toMinutes(timeStr) {
        var parts = timeStr.split(":");
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      }

      var inserted = false;

      for (var i = 0; i < eventItems.length; i++) {
        var item = eventItems[i];
        var startStr = item.getAttribute("data-start");
        var endStr = item.getAttribute("data-end");
        if (!startStr || !endStr) continue;

        if (nowTimeStr >= startStr && nowTimeStr < endStr) {
          item.classList.add("is-ongoing");

          var titleDiv = item.querySelector(".event-title");
          if (titleDiv) {
            var ongBadge = document.createElement("span");
            ongBadge.className = "ongoing-badge";
            ongBadge.textContent = " " + labels.status_ongoing;
            titleDiv.appendChild(ongBadge);
          }

          var span = toMinutes(endStr) - toMinutes(startStr);
          var elapsed =
            now.getHours() * 60 +
            now.getMinutes() +
            now.getSeconds() / 60 -
            toMinutes(startStr);
          var fraction = span > 0 ? elapsed / span : 0;
          fraction = Math.min(1, Math.max(0, fraction));

          var progress = document.createElement("div");
          progress.className = "course-progress";
          progress.style.setProperty("--course-progress", fraction.toFixed(4));

          var progressFill = document.createElement("span");
          progressFill.className = "course-progress-fill";
          progressFill.setAttribute("aria-hidden", "true");

          var progressDot = document.createElement("span");
          progressDot.className = "course-progress-dot";
          progressDot.setAttribute("aria-hidden", "true");

          var progressTime = document.createElement("span");
          progressTime.className = "current-time-text visually-hidden";
          progressTime.textContent = nowTimeStr;

          progress.appendChild(progressFill);
          progress.appendChild(progressDot);
          progress.appendChild(progressTime);
          item.appendChild(progress);

          inserted = true;
          break;
        } else if (nowTimeStr < startStr) {
          eventsList.insertBefore(markerEl, item);
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        eventsList.appendChild(markerEl);
      }

      if (nowInfo.isSimulated) {
        stopTimeMarkerTimer();
      } else if (!timeMarkerTimer) {
        timeMarkerTimer = setInterval(
          updateTimeMarker,
          calendarConfig.time_marker_interval_ms,
        );
      }
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        updateTimeMarker();
      }
    });

    function loadState() {
      var hashObj = AppUtils.parseHash(window.location.hash);
      var storedStr = AppUtils.safeStorageGet("calendar_settings", true);
      var storedObj = {};
      if (storedStr) {
        try {
          storedObj = JSON.parse(storedStr);
        } catch (e) {}
      }

      var merged = Object.assign({}, storedObj, hashObj);

      if (
        merged.view &&
        (merged.view === "week" ||
          merged.view === "day" ||
          merged.view === "year")
      ) {
        state.view = merged.view;
      }

      if (
        hashObj.now &&
        !hashObj.date &&
        (CalendarModel.validInstant(hashObj.now) ||
          CalendarModel.validSiteDateTime(hashObj.now))
      ) {
        var nowSim = new Date(hashObj.now);
        if (!isNaN(nowSim.getTime())) {
          state.date = formatISODate(normalizeDate(getNowDate().date));
        }
      } else if (merged.date && CalendarModel.parseCivilDate(merged.date)) {
        state.date = formatISODate(normalizeDate(parseISODate(merged.date)));
      } else {
        state.date = defaultDateStr;
      }

      if (merged.compare !== undefined)
        state.compare =
          typeof merged.compare === "string" &&
          merged.compare !== currentClassId &&
          Object.prototype.hasOwnProperty.call(classLabels, merged.compare)
            ? merged.compare
            : "";
      if (merged.sameOnly !== undefined)
        state.sameOnly = merged.sameOnly === "1" || merged.sameOnly === true;
      if (merged.showCompared !== undefined)
        state.showCompared =
          merged.showCompared === "1" || merged.showCompared === true;
      if (merged.evals !== undefined)
        state.evals = merged.evals === "1" || merged.evals === true;
      if (merged.teacherless !== undefined)
        state.teacherless =
          merged.teacherless === "1" || merged.teacherless === true;
      if (typeof merged.search === "string") state.search = merged.search;

      if (!state.compare) {
        state.sameOnly = false;
        state.showCompared = false;
      }

      if (calendarConfig.comparison_options.indexOf("same_only") === -1)
        state.sameOnly = false;
      if (calendarConfig.comparison_options.indexOf("show_compared") === -1)
        state.showCompared = false;
      updateControlsFromState();
    }

    function saveState() {
      if (!state.compare) {
        state.sameOnly = false;
        state.showCompared = false;
      }

      var hashObj = AppUtils.parseHash(window.location.hash);
      var saveObj = {
        view: state.view,
        date: state.date,
        compare: state.compare,
        sameOnly: state.compare && state.sameOnly ? "1" : "0",
        showCompared: state.compare && state.showCompared ? "1" : "0",
        evals: state.evals ? "1" : "0",
        teacherless: state.teacherless ? "1" : "0",
        search: state.search,
      };
      if (
        hashObj.now &&
        (CalendarModel.validInstant(hashObj.now) ||
          CalendarModel.validSiteDateTime(hashObj.now))
      ) {
        saveObj.now = hashObj.now;
      }

      AppUtils.safeStorageSet(
        "calendar_settings",
        JSON.stringify(saveObj),
        true,
      );

      var newHash = AppUtils.buildHash(saveObj);
      lastWrittenHash = newHash;
      if (window.location.hash !== newHash) {
        if (history.replaceState) {
          history.replaceState(null, "", newHash || window.location.pathname);
        } else {
          window.location.hash = newHash;
        }
      }
    }

    function updateControlsFromState() {
      if (viewSelect) viewSelect.value = state.view;
      if (dateInput) dateInput.value = state.date;
      if (compareSelect) compareSelect.value = state.compare;
      if (evalsOnlyCb) evalsOnlyCb.checked = state.evals;
      if (teacherlessCb) teacherlessCb.checked = state.teacherless;
      if (searchInput) searchInput.value = state.search;

      var isYear = state.view === "year";
      if (prevBtn) prevBtn.hidden = isYear;
      if (nextBtn) nextBtn.hidden = isYear;
      if (todayBtn) todayBtn.hidden = false;
      if (dateGroup) dateGroup.hidden = isYear;
      else if (dateInput) dateInput.hidden = isYear;
      var navBar = document.getElementById("calendar-nav-bar");
      if (navBar) navBar.hidden = false;

      if (compCheckboxes) {
        while (compCheckboxes.firstChild) {
          compCheckboxes.removeChild(compCheckboxes.firstChild);
        }
        if (state.compare) {
          var sameLabel = document.createElement("label");
          sameLabel.setAttribute("for", "cal-same-only");
          var sameCb = document.createElement("input");
          sameCb.type = "checkbox";
          sameCb.id = "cal-same-only";
          sameCb.checked = state.sameOnly;
          sameCb.addEventListener("change", function () {
            state.sameOnly = sameCb.checked;
            render();
          });
          sameLabel.appendChild(sameCb);
          sameLabel.appendChild(
            document.createTextNode(" " + labels.same_only),
          );

          var showLabel = document.createElement("label");
          showLabel.setAttribute("for", "cal-show-compared");
          var showCb = document.createElement("input");
          showCb.type = "checkbox";
          showCb.id = "cal-show-compared";
          showCb.checked = state.showCompared;
          showCb.addEventListener("change", function () {
            state.showCompared = showCb.checked;
            render();
          });
          showLabel.appendChild(showCb);
          showLabel.appendChild(
            document.createTextNode(" " + labels.show_compared),
          );

          if (calendarConfig.comparison_options.indexOf("same_only") !== -1)
            compCheckboxes.appendChild(sameLabel);
          if (calendarConfig.comparison_options.indexOf("show_compared") !== -1)
            compCheckboxes.appendChild(showLabel);
        }
      }
    }

    function fetchComparisonClass(classId) {
      if (!comparisonCache[classId]) {
        comparisonCache[classId] = fetch(
          "../../data/" + encodeURIComponent(classId) + ".json",
        )
          .then(function (response) {
            if (!response.ok)
              throw new Error("Comparison fetch failed: " + response.status);
            return response.json();
          })
          .then(function (data) {
            return CalendarModel.normalizeEnvelope(
              data,
              classId,
              calendarConfig.max_comparison_events,
            );
          })
          .catch(function (error) {
            delete comparisonCache[classId];
            throw error;
          });
      }
      return comparisonCache[classId];
    }

    function filterEvents(events, searchNorm) {
      return events.filter(function (ev) {
        if (state.evals && !ev.category) {
          return false;
        }

        if (state.teacherless) {
          var tList = ev.teachers || [];
          if (tList.length > 0) return false;
        }

        if (searchNorm) {
          var targetStr = AppUtils.stripAccents(
            [
              ev.title,
              ev.module,
              (ev.rooms || []).join(" "),
              (ev.teachers || []).join(" "),
              (ev.staff_markers || []).join(" "),
              (ev.groups || []).join(" "),
            ].join(" "),
          ).toLowerCase();

          if (targetStr.indexOf(searchNorm) === -1) {
            return false;
          }
        }

        return true;
      });
    }

    function render() {
      stopTimeMarkerTimer();
      saveState();
      var version = ++renderVersion;
      if (state.compare) {
        fetchComparisonClass(state.compare)
          .then(function (events) {
            if (version !== renderVersion) return;
            if (messageEl) messageEl.hidden = true;
            renderCalendarView(currentClassEvents, events);
            updateTimeMarker();
          })
          .catch(function (error) {
            if (version !== renderVersion) return;
            if (messageEl) {
              messageEl.dataset.error = error.message;
              messageEl.textContent = labels.load_error;
              messageEl.hidden = false;
            }
            renderCalendarView(currentClassEvents, []);
            updateTimeMarker();
          });
      } else {
        if (messageEl) messageEl.hidden = true;
        renderCalendarView(currentClassEvents, []);
        updateTimeMarker();
      }
    }

    const calendarView = CalendarView.create({
      currentClassId,
      firstDateStr,
      lastDateStr,
      schoolYearLabel,
      allowedDays,
      displayMode,
      categoryMap,
      labels,
      classLabels,
      prevBtn,
      nextBtn,
      periodHeading,
      viewContainer,
      parseISODate,
      formatISODate,
      getNextWeekday,
      getPrevWeekday,
      minDate,
      maxDate,
      state,
      dayNames,
      monthNames,
      getWeekStart,
      getISOWeekNumber,
      filterEvents,
    });
    function renderCalendarView(primaryEvents, comparedEvents) {
      calendarView.render(primaryEvents, comparedEvents);
    }

    if (viewSelect) {
      viewSelect.addEventListener("change", function () {
        state.view = viewSelect.value;
        updateControlsFromState();
        render();
      });
    }

    if (dateInput) {
      dateInput.addEventListener("change", function () {
        if (dateInput.value) {
          var picked = parseISODate(dateInput.value);
          if (isNaN(picked.getTime())) return;
          var normalized = normalizeDate(picked);
          state.date = formatISODate(normalized);
          dateInput.value = state.date;
          render();
        }
      });
    }

    if (compareSelect) {
      compareSelect.addEventListener("change", function () {
        state.compare = compareSelect.value;
        if (!state.compare) {
          state.sameOnly = false;
          state.showCompared = false;
        }
        updateControlsFromState();
        render();
      });
    }

    if (evalsOnlyCb) {
      evalsOnlyCb.addEventListener("change", function () {
        state.evals = evalsOnlyCb.checked;
        render();
      });
    }

    if (teacherlessCb) {
      teacherlessCb.addEventListener("change", function () {
        state.teacherless = teacherlessCb.checked;
        render();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", function () {
        state.search = searchInput.value;
        if (state.view === "year") {
          if (searchTimeout) clearTimeout(searchTimeout);
          searchTimeout = setTimeout(function () {
            render();
          }, calendarConfig.search_delay_ms);
        } else {
          render();
        }
      });
      AppUtils.bindBlurKeys([searchInput]);
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        state.view = calendarConfig.default_view;
        state.date = defaultDateStr;
        state.compare = "";
        state.sameOnly = false;
        state.showCompared = false;
        state.evals = false;
        state.teacherless = false;
        state.search = "";
        updateControlsFromState();
        render();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        if (state.view === "year") return;
        var d = parseISODate(state.date);
        var targetDate;
        if (state.view === "week") {
          targetDate = new Date(d.getTime());
          targetDate.setDate(targetDate.getDate() - 7);
        } else {
          targetDate = getPrevWeekday(d);
        }
        if (targetDate >= minDate) {
          state.date = formatISODate(targetDate);
          updateControlsFromState();
          render();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        if (state.view === "year") return;
        var d = parseISODate(state.date);
        var targetDate;
        if (state.view === "week") {
          targetDate = new Date(d.getTime());
          targetDate.setDate(targetDate.getDate() + 7);
        } else {
          targetDate = getNextWeekday(d);
        }
        if (targetDate <= maxDate) {
          state.date = formatISODate(targetDate);
          updateControlsFromState();
          render();
        }
      });
    }

    if (todayBtn) {
      todayBtn.addEventListener("click", function () {
        var nowObj = getNowDate();
        var today = toWeekday(nowObj.date, 1);
        var todayIso = formatISODate(today);

        if (state.view === "year") {
          var todayEl = document.getElementById("day-section-" + todayIso);
          if (todayEl) {
            todayEl.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            var firstDayEl = viewContainer.querySelector(".day-section");
            if (firstDayEl)
              firstDayEl.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          return;
        }

        if (today >= minDate && today <= maxDate) {
          state.date = todayIso;
        } else {
          state.date = defaultDateStr;
        }
        updateControlsFromState();
        render();
        if (window.matchMedia("(max-width: 59.99em)").matches) {
          var marker = document.getElementById("current-time-marker");
          if (marker)
            marker.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var tag =
        e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
      if (
        tag === "input" ||
        tag === "select" ||
        tag === "textarea" ||
        (e.target && e.target.isContentEditable)
      )
        return;

      if (e.key === "ArrowLeft" || e.keyCode === 37) {
        if (prevBtn && !prevBtn.disabled && !prevBtn.hidden) {
          prevBtn.click();
        }
      } else if (e.key === "ArrowRight" || e.keyCode === 39) {
        if (nextBtn && !nextBtn.disabled && !nextBtn.hidden) {
          nextBtn.click();
        }
      }
    });

    window.addEventListener("hashchange", function () {
      if (window.location.hash !== lastWrittenHash) {
        loadState();
        render();
      }
    });

    loadState();
    render();
  });
})();

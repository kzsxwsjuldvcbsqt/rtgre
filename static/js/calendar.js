(function () {
  AppUtils.onDOMReady(function () {
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
    var moduleStyles = JSON.parse(
      scriptEl.getAttribute("data-module-styles-json") || "{}",
    );

    var navBarEl = document.getElementById("calendar-nav-bar");
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

    var breaks = Array.isArray(calendarConfig.breaks)
      ? calendarConfig.breaks
      : [];

    function applyBreaks(events) {
      if (breaks.length === 0) return;
      function remap(instant, isStart) {
        var time = instant.substring(11, 16);
        for (var i = 0; i < breaks.length; i++) {
          if (breaks[i].boundary === time) {
            return (
              instant.substring(0, 11) +
              (isStart ? breaks[i].after : breaks[i].before) +
              instant.substring(16)
            );
          }
        }
        return instant;
      }
      events.forEach(function (ev) {
        ev.start = remap(ev.start, true);
        ev.end = remap(ev.end, false);
      });
    }

    function assignSeriesCounts(events) {
      var groups = Object.create(null);
      events.forEach(function (ev) {
        (groups[ev.title] || (groups[ev.title] = [])).push(ev);
      });
      Object.keys(groups).forEach(function (title) {
        var series = groups[title];
        series.sort(function (a, b) {
          return Date.parse(a.start) - Date.parse(b.start);
        });
        series.forEach(function (ev, index) {
          ev.seriesIndex = index + 1;
          ev.seriesTotal = series.length;
        });
      });
    }
    function toClockMinutes(instant) {
      return (
        parseInt(instant.substring(11, 13), 10) * 60 +
        parseInt(instant.substring(14, 16), 10)
      );
    }

    function computeGridRange(events) {
      if (events.length === 0) return null;
      var first = Infinity;
      var last = -Infinity;
      events.forEach(function (ev) {
        first = Math.min(first, toClockMinutes(ev.start));
        last = Math.max(last, toClockMinutes(ev.end));
      });
      return {
        start: Math.floor(first / 60) * 60,
        end: Math.ceil(last / 60) * 60,
      };
    }

    applyBreaks(currentClassEvents);
    assignSeriesCounts(currentClassEvents);
    var gridRange = computeGridRange(currentClassEvents);

    var comparisonCache = Object.create(null);
    var renderVersion = 0;

    var viewSelect = document.getElementById("cal-view-select");
    var layoutSelect = document.getElementById("cal-layout-select");
    var layoutGroup = document.getElementById("cal-layout-select-group");
    var mobileQuery = window.matchMedia(calendarConfig.mobile_media_query);
    var dateInput = document.getElementById("cal-date-input");
    var dateGroup = document.getElementById("cal-date-input-group");
    var calendarControls = document.getElementById("calendar-controls");
    var filtersScroll = document.getElementById("cal-filters-scroll");
    var compareGroup = document.getElementById("cal-compare-select-group");
    var controlsToggle = document.querySelector(
      '[aria-controls="calendar-controls"]',
    );

    function syncDateControlPlacement() {
      if (!dateGroup || !navBarEl || !filtersScroll || !calendarControls)
        return;
      var sidebarActive =
        controlsToggle && controlsToggle.getClientRects().length === 0;
      if (sidebarActive && dateGroup.parentElement !== filtersScroll) {
        filtersScroll.insertBefore(dateGroup, compareGroup);
      } else if (!sidebarActive && dateGroup.parentElement !== navBarEl) {
        navBarEl.insertBefore(dateGroup, navBarEl.firstChild);
      }
    }

    syncDateControlPlacement();
    window.addEventListener("resize", syncDateControlPlacement);

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
    var spotlightPending = false;
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

    function resolveDefaultView() {
      if (
        calendarConfig.phone_media_query &&
        window.matchMedia(calendarConfig.phone_media_query).matches
      )
        return calendarConfig.phone_default_view;
      return calendarConfig.default_view;
    }

    var state = {
      view: resolveDefaultView(),
      layout: calendarConfig.default_week_layout,
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

    function scheduleTimeMarker(isSimulated) {
      if (isSimulated) {
        stopTimeMarkerTimer();
      } else if (!timeMarkerTimer) {
        timeMarkerTimer = setInterval(
          updateTimeMarker,
          calendarConfig.time_marker_interval_ms,
        );
      }
    }

    function buildTimeMarker(tagName, text) {
      var markerEl = document.createElement(tagName);
      markerEl.id = "current-time-marker";
      markerEl.className = "current-time-marker";

      var timeSpan = document.createElement("span");
      timeSpan.className = "current-time-text";
      timeSpan.textContent = text;
      markerEl.appendChild(timeSpan);

      var lineEl = document.createElement("hr");
      lineEl.className = "current-time-line";
      markerEl.appendChild(lineEl);
      return markerEl;
    }

    function placeOffViewMarker(now, todayIso, nowTimeStr) {
      var rangeStart = viewContainer.getAttribute("data-range-start");
      var rangeEnd = viewContainer.getAttribute("data-range-end");
      if (!rangeStart || !rangeEnd) return false;

      var lowerBound = getPrevWeekday(parseISODate(rangeStart));
      lowerBound.setDate(lowerBound.getDate() + 1);
      var upperBound = getNextWeekday(parseISODate(rangeEnd));
      upperBound.setDate(upperBound.getDate() - 1);
      if (
        todayIso < formatISODate(lowerBound) ||
        todayIso > formatISODate(upperBound)
      )
        return false;

      var markerEl = buildTimeMarker(
        "div",
        AppUtils.formatText(labels.now_marker, {
          day_name: dayNames[(now.getDay() + 6) % 7],
          day_num: now.getDate(),
          month_name: monthNames[now.getMonth()],
          time: nowTimeStr,
        }),
      );
      markerEl.classList.add("is-off-view");

      var nextBlock = Array.from(viewContainer.children).find(function (el) {
        var date = el.getAttribute("data-date");
        return date && date > todayIso;
      });
      viewContainer.insertBefore(markerEl, nextBlock || null);
      return true;
    }

    function updateTimeMarker() {
      var existingMarker = document.getElementById("current-time-marker");
      if (existingMarker) existingMarker.remove();

      viewContainer
        .querySelectorAll(".day-section.is-today")
        .forEach(function (section) {
          section.classList.remove("is-today");
        });

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

      var nowHours = String(now.getHours()).padStart(2, "0");
      var nowMins = String(now.getMinutes()).padStart(2, "0");
      var nowTimeStr = nowHours + ":" + nowMins;

      var todaySection = document.getElementById("day-section-" + todayIso);
      if (todaySection && (state.view === "week" || state.view === "year")) {
        todaySection.classList.add("is-today");
      }
      if (!todaySection) {
        if (placeOffViewMarker(now, todayIso, nowTimeStr)) {
          scheduleTimeMarker(nowInfo.isSimulated);
        } else {
          stopTimeMarkerTimer();
        }
        return;
      }

      if (viewContainer.classList.contains("is-grid")) {
        var gridList = todaySection.querySelector(".calendar-events-list");
        var gridMarker = buildTimeMarker("li", nowTimeStr);
        gridMarker.style.setProperty(
          "--calendar-offset",
          Math.min(
            Math.max(
              now.getHours() * 60 + now.getMinutes() - gridRange.start,
              0,
            ),
            gridRange.end - gridRange.start,
          ),
        );
        gridList.appendChild(gridMarker);
        gridList
          .querySelectorAll(".calendar-event-item")
          .forEach(function (item) {
            if (
              nowTimeStr >= item.dataset.start &&
              nowTimeStr < item.dataset.end
            )
              item.classList.add("is-ongoing");
          });
        scheduleTimeMarker(nowInfo.isSimulated);
        return;
      }

      var eventsList = todaySection.querySelector(".calendar-events-list");
      var eventItems = eventsList
        ? Array.from(eventsList.querySelectorAll(".calendar-event-item"))
        : [];
      if (eventItems.length === 0) {
        var dayHeading = todaySection.querySelector(":scope > h3");
        todaySection.insertBefore(
          buildTimeMarker("div", nowTimeStr),
          dayHeading ? dayHeading.nextSibling : todaySection.firstChild,
        );
        scheduleTimeMarker(nowInfo.isSimulated);
        return;
      }

      var markerEl = buildTimeMarker("li", nowTimeStr);

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

      scheduleTimeMarker(nowInfo.isSimulated);
    }

    function spotlightNow() {
      if (!spotlightPending) return;
      spotlightPending = false;
      var target =
        document.getElementById("current-time-marker") ||
        viewContainer.querySelector(".course-progress");
      if (!target) return;
      target.classList.add("is-spotlit");
      target.addEventListener(
        "animationend",
        function () {
          target.classList.remove("is-spotlit");
        },
        { once: true },
      );
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

      if (merged.layout === "grid" || merged.layout === "list") {
        state.layout = merged.layout;
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
        layout: state.layout,
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
      if (layoutSelect) layoutSelect.value = state.layout;
      if (layoutGroup)
        layoutGroup.hidden = state.view !== "week" || mobileQuery.matches;
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
            spotlightNow();
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
            spotlightNow();
          });
      } else {
        if (messageEl) messageEl.hidden = true;
        renderCalendarView(currentClassEvents, []);
        updateTimeMarker();
        spotlightNow();
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
      moduleStyles,
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
      isWeekGrid,
      gridRange,
    });
    function renderCalendarView(primaryEvents, comparedEvents) {
      calendarView.render(primaryEvents, comparedEvents);
    }

    function isWeekGrid() {
      return state.layout === "grid" && !mobileQuery.matches;
    }

    if (layoutSelect) {
      layoutSelect.addEventListener("change", function () {
        state.layout = layoutSelect.value;
        render();
      });
    }

    mobileQuery.addEventListener("change", function () {
      updateControlsFromState();
      render();
    });

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
        state.view = resolveDefaultView();
        state.layout = calendarConfig.default_week_layout;
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
        spotlightPending = true;

        if (state.view === "year") {
          var siteHeader = document.querySelector(".site-header");
          document.documentElement.style.setProperty(
            "--site-header-height",
            (siteHeader ? siteHeader.getBoundingClientRect().height : 0) + "px",
          );
          var todayEl =
            document.getElementById(
              "day-section-" + formatISODate(nowObj.date),
            ) || document.getElementById("current-time-marker");
          if (todayEl) {
            todayEl.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            var firstDayEl = viewContainer.querySelector(".day-section");
            if (firstDayEl)
              firstDayEl.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          spotlightNow();
          return;
        }

        if (today >= minDate && today <= maxDate) {
          state.date = todayIso;
        } else {
          state.date = defaultDateStr;
        }
        updateControlsFromState();
        render();
        if (window.matchMedia(calendarConfig.mobile_media_query).matches) {
          var marker =
            document.getElementById("current-time-marker") ||
            document.querySelector(".course-progress-dot") ||
            document.querySelector(".calendar-event-item.is-ongoing");
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

    function anchorToSchedule() {
      if (
        !todayBtn ||
        !window.matchMedia(calendarConfig.mobile_media_query).matches
      )
        return;
      var header = document.querySelector(".site-header");
      var headerOffset = header ? header.getBoundingClientRect().height : 0;
      var target =
        todayBtn.getBoundingClientRect().bottom + window.scrollY - headerOffset;
      var maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;
      if (target > 0 && maxScroll >= target)
        window.scrollTo({ top: target, behavior: "instant" });
    }

    loadState();
    render();
    requestAnimationFrame(function () {
      anchorToSchedule();
      var layout = document.querySelector(".has-filter-sidebar");
      if (layout) layout.classList.add("is-layout-ready");
    });
  });
})();

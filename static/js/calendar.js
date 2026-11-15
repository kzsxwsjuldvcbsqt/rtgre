(function () {
  AppUtils.onDOMReady(function () {
    const scriptEl = document.querySelector("script[data-class-id]");
    if (!scriptEl) return;

    const currentClassId = scriptEl.getAttribute("data-class-id");
    const firstDateStr = scriptEl.getAttribute("data-first-date");
    const lastDateStr = scriptEl.getAttribute("data-last-date");
    const schoolYearLabel = scriptEl.getAttribute("data-school-year-label");
    const calendarConfig = JSON.parse(
      scriptEl.getAttribute("data-calendar-config"),
    );
    const allowedDays = calendarConfig.days_of_week;
    const timezone = scriptEl.getAttribute("data-timezone");
    const displayMode = scriptEl.getAttribute("data-display-mode");

    const categoriesJson = JSON.parse(
      scriptEl.getAttribute("data-categories-json") || "[]",
    );
    const categoryMap = {};
    categoriesJson.forEach(function (c) {
      categoryMap[c.id] = c;
    });

    const sessionMarks = {};
    JSON.parse(
      scriptEl.getAttribute("data-session-marks-json") || "[]",
    ).forEach(function (mark) {
      sessionMarks[mark.id] = mark.label;
    });

    const labels = JSON.parse(
      scriptEl.getAttribute("data-labels-json") || "{}",
    );
    const classLabel = scriptEl.getAttribute("data-class-label");
    const moduleInfo = JSON.parse(
      scriptEl.getAttribute("data-module-info-json") || "{}",
    );

    const navBarEl = document.getElementById("calendar-nav-bar");
    if (navBarEl) navBarEl.hidden = false;

    const initialEventsScript = document.getElementById("class-events-data");
    let currentClassEvents = [];
    if (initialEventsScript) {
      try {
        const rawEventsData = JSON.parse(initialEventsScript.textContent);
        currentClassEvents = CalendarModel.normalizeEnvelope(
          rawEventsData,
          currentClassId,
        );
      } catch (error) {
        currentClassEvents = [];
      }
    }

    const breaks = Array.isArray(calendarConfig.breaks)
      ? calendarConfig.breaks
      : [];

    function assignSeriesCounts(events) {
      const groups = Object.create(null);
      events.forEach(function (ev) {
        (groups[ev.title] || (groups[ev.title] = [])).push(ev);
      });
      Object.keys(groups).forEach(function (title) {
        const series = groups[title];
        series.sort(function (a, b) {
          return Date.parse(a.start) - Date.parse(b.start);
        });
        series.forEach(function (ev, index) {
          ev.seriesIndex = index + 1;
          ev.seriesTotal = series.length;
        });
      });
    }
    function timeToMinutes(time) {
      return (
        parseInt(time.substring(0, 2), 10) * 60 +
        parseInt(time.substring(3, 5), 10)
      );
    }

    function toClockMinutes(instant) {
      return timeToMinutes(instant.substring(11, 16));
    }

    function computeGridRange(events) {
      if (events.length === 0) return null;
      let first = Infinity;
      let last = -Infinity;
      events.forEach(function (ev) {
        first = Math.min(first, toClockMinutes(ev.start));
        last = Math.max(last, toClockMinutes(ev.end));
      });
      return {
        start: Math.floor(first / 60) * 60,
        end: Math.ceil(last / 60) * 60,
      };
    }

    CalendarModel.applyBreaks(currentClassEvents, breaks);
    assignSeriesCounts(currentClassEvents);
    const gridRange = computeGridRange(currentClassEvents);

    const viewSelect = document.getElementById("cal-view-select");
    const layoutSelect = document.getElementById("cal-layout-select");
    const layoutGroup = document.getElementById("cal-layout-select-group");
    const mobileQuery = window.matchMedia(calendarConfig.mobile_media_query);
    const dateInput = document.getElementById("cal-date-input");
    const dateGroup = document.getElementById("cal-date-input-group");

    const evalsOnlyCb = document.getElementById("cal-evals-only");
    const teacherCb = document.getElementById("cal-teacher-only");
    const searchInput = document.getElementById("cal-search-input");
    const resetBtn = document.getElementById("cal-reset-btn");

    const prevBtn = document.getElementById("cal-prev-btn");
    const todayBtn = document.getElementById("cal-today-btn");
    const nextBtn = document.getElementById("cal-next-btn");
    const periodHeading = document.getElementById("cal-period-heading");
    const viewContainer = document.getElementById("calendar-view-container");

    let searchTimeout = null;
    let timeMarkerTimer = null;
    let spotlightPending = false;
    let lastWrittenHash = "";

    function parseISODate(str) {
      return CalendarModel.parseCivilDate(str) || new Date(NaN);
    }

    function formatISODate(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    }

    function toWeekday(d, direction) {
      const date = new Date(d.getTime());
      const dir = direction >= 0 ? 1 : -1;
      while (
        allowedDays.indexOf(date.getDay() || 7) === -1 &&
        !isNaN(date.getTime())
      ) {
        date.setDate(date.getDate() + dir);
      }
      return date;
    }

    function getNextWeekday(d) {
      const next = new Date(d.getTime());
      next.setDate(next.getDate() + 1);
      return toWeekday(next, 1);
    }

    function getPrevWeekday(d) {
      const prev = new Date(d.getTime());
      prev.setDate(prev.getDate() - 1);
      return toWeekday(prev, -1);
    }

    const minDate = toWeekday(parseISODate(firstDateStr), 1);
    const maxDate = toWeekday(parseISODate(lastDateStr), -1);
    function normalizeDate(date) {
      if (isNaN(date.getTime())) return new Date(minDate.getTime());
      const normalized = toWeekday(date, 1);
      return new Date(
        Math.min(
          Math.max(normalized.getTime(), minDate.getTime()),
          maxDate.getTime(),
        ),
      );
    }

    const defaultDateStr = formatISODate(normalizeDate(getNowDate().date));

    function resolveDefaultView() {
      if (
        calendarConfig.phone_media_query &&
        window.matchMedia(calendarConfig.phone_media_query).matches
      )
        return calendarConfig.phone_default_view;
      return calendarConfig.default_view;
    }

    const state = {
      view: resolveDefaultView(),
      layout: calendarConfig.default_layout,
      date: defaultDateStr,
      evals: false,
      withTeacher: false,
      search: "",
    };

    const dayNames = labels.days;
    const monthNames = labels.months;

    function getWeekStart(d) {
      const date = new Date(d.getTime());
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(date.setDate(diff));
    }

    function getISOWeekNumber(d) {
      const date = new Date(
        Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
      );
      const dayNum = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    }

    function stopTimeMarkerTimer() {
      if (timeMarkerTimer) {
        clearInterval(timeMarkerTimer);
        timeMarkerTimer = null;
      }
    }

    function inSiteTimezone(date) {
      return CalendarModel.inSiteTimezone(date, timezone);
    }

    function getNowDate() {
      const hashObj = AppUtils.parseHash(window.location.hash);
      if (
        hashObj.now &&
        (CalendarModel.validInstant(hashObj.now) ||
          CalendarModel.validSiteDateTime(hashObj.now))
      ) {
        const d = new Date(hashObj.now);
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
      const markerEl = document.createElement(tagName);
      markerEl.id = "current-time-marker";
      markerEl.className = "current-time-marker";

      const timeSpan = document.createElement("span");
      timeSpan.className = "current-time-text";
      timeSpan.textContent = text;
      markerEl.appendChild(timeSpan);

      const lineEl = document.createElement("hr");
      lineEl.className = "current-time-line";
      markerEl.appendChild(lineEl);
      return markerEl;
    }

    function placeOffViewMarker(now, todayIso, nowTimeStr) {
      const rangeStart = viewContainer.getAttribute("data-range-start");
      const rangeEnd = viewContainer.getAttribute("data-range-end");
      if (!rangeStart || !rangeEnd) return false;

      const lowerBound = getPrevWeekday(parseISODate(rangeStart));
      lowerBound.setDate(lowerBound.getDate() + 1);
      const upperBound = getNextWeekday(parseISODate(rangeEnd));
      upperBound.setDate(upperBound.getDate() - 1);
      if (
        todayIso < formatISODate(lowerBound) ||
        todayIso > formatISODate(upperBound)
      )
        return false;

      const markerEl = buildTimeMarker(
        "div",
        AppUtils.formatText(labels.now_marker, {
          day_name: dayNames[(now.getDay() + 6) % 7],
          day_num: now.getDate(),
          month_name: monthNames[now.getMonth()],
          time: nowTimeStr,
        }),
      );
      markerEl.classList.add("is-off-view");

      const nextBlock = Array.from(viewContainer.children).find(function (el) {
        const date = el.getAttribute("data-date");
        return date && date > todayIso;
      });
      viewContainer.insertBefore(markerEl, nextBlock || null);
      return true;
    }

    function updateTimeMarker() {
      const existingMarker = document.getElementById("current-time-marker");
      if (existingMarker) existingMarker.remove();

      viewContainer
        .querySelectorAll(".day-section.is-today")
        .forEach(function (section) {
          section.classList.remove("is-today");
        });

      viewContainer
        .querySelectorAll(
          ".calendar-event-item.is-ongoing, .calendar-event-item.is-past",
        )
        .forEach(function (el) {
          el.classList.remove("is-ongoing", "is-past");
          el.style.removeProperty("--course-progress");
        });

      const nowInfo = getNowDate();
      const now = nowInfo.date;
      const todayIso = formatISODate(now);

      const nowHours = String(now.getHours()).padStart(2, "0");
      const nowMins = String(now.getMinutes()).padStart(2, "0");
      const nowTimeStr = nowHours + ":" + nowMins;

      viewContainer
        .querySelectorAll(".day-section")
        .forEach(function (section) {
          if (section.dataset.date >= todayIso) return;
          section
            .querySelectorAll(".calendar-event-item")
            .forEach(function (item) {
              item.classList.add("is-past");
            });
        });

      const todaySection = document.getElementById("day-section-" + todayIso);
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

      const eventsList = todaySection.querySelector(".calendar-events-list");
      const eventItems = eventsList
        ? Array.from(eventsList.querySelectorAll(".calendar-event-item"))
        : [];
      const nowMinutes =
        now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
      let ongoingItem = null;
      let nextItem = null;
      eventItems.forEach(function (item) {
        const start = timeToMinutes(item.dataset.start);
        const end = timeToMinutes(item.dataset.end);
        if (end <= nowMinutes) {
          item.classList.add("is-past");
        } else if (start <= nowMinutes) {
          item.classList.add("is-ongoing");
          item.style.setProperty(
            "--course-progress",
            ((nowMinutes - start) / (end - start)).toFixed(4),
          );
          ongoingItem = ongoingItem || item;
        } else if (!nextItem) {
          nextItem = item;
        }
      });

      if (ongoingItem) {
        const courseMarker = buildTimeMarker("div", nowTimeStr);
        courseMarker.classList.add("is-line");
        ongoingItem.appendChild(courseMarker);
      } else if (viewContainer.classList.contains("is-grid")) {
        const gridMarker = buildTimeMarker("li", nowTimeStr);
        gridMarker.classList.add("is-line");
        gridMarker.style.setProperty(
          "--calendar-offset",
          Math.min(
            Math.max(Math.floor(nowMinutes) - gridRange.start, 0),
            gridRange.end - gridRange.start,
          ),
        );
        eventsList.appendChild(gridMarker);
      } else if (eventsList) {
        eventsList.insertBefore(buildTimeMarker("li", nowTimeStr), nextItem);
      } else {
        const dayHeading = todaySection.querySelector(":scope > h3");
        todaySection.insertBefore(
          buildTimeMarker("div", nowTimeStr),
          dayHeading ? dayHeading.nextSibling : todaySection.firstChild,
        );
      }

      scheduleTimeMarker(nowInfo.isSimulated);
    }

    function stickyBarHeight() {
      const bar = document.querySelector(".app-topbar-main");
      return bar ? bar.getBoundingClientRect().height : 0;
    }

    function spotlightNow() {
      if (!spotlightPending) return;
      spotlightPending = false;
      const target = document.getElementById("current-time-marker");
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
      const hashObj = AppUtils.parseHash(window.location.hash);
      const storedStr = AppUtils.safeStorageGet("calendar_settings", true);
      let storedObj = {};
      if (storedStr) {
        try {
          storedObj = JSON.parse(storedStr);
        } catch (e) {}
      }

      const merged = Object.assign({}, storedObj, hashObj);

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
        const nowSim = new Date(hashObj.now);
        if (!isNaN(nowSim.getTime())) {
          state.date = formatISODate(normalizeDate(getNowDate().date));
        }
      } else if (merged.date && CalendarModel.parseCivilDate(merged.date)) {
        state.date = formatISODate(normalizeDate(parseISODate(merged.date)));
      } else {
        state.date = defaultDateStr;
      }

      if (merged.evals !== undefined)
        state.evals = merged.evals === "1" || merged.evals === true;
      if (merged.teacher !== undefined)
        state.withTeacher = merged.teacher === "1" || merged.teacher === true;
      if (typeof merged.search === "string") state.search = merged.search;
      updateControlsFromState();
    }

    function saveState() {
      const hashObj = AppUtils.parseHash(window.location.hash);
      const saveObj = {
        view: state.view,
        layout: state.layout,
        date: state.date,
        evals: state.evals ? "1" : "0",
        teacher: state.withTeacher ? "1" : "0",
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

      const newHash = AppUtils.buildHash(saveObj);
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
        layoutGroup.hidden = state.view === "year" || mobileQuery.matches;
      if (dateInput) dateInput.value = state.date;
      if (evalsOnlyCb) evalsOnlyCb.checked = state.evals;
      if (teacherCb) teacherCb.checked = state.withTeacher;
      if (searchInput) searchInput.value = state.search;

      const isYear = state.view === "year";
      if (prevBtn) prevBtn.hidden = isYear;
      if (nextBtn) nextBtn.hidden = isYear;
      if (todayBtn) todayBtn.hidden = false;
      if (dateGroup) dateGroup.hidden = isYear;
      else if (dateInput) dateInput.hidden = isYear;
      const navBar = document.getElementById("calendar-nav-bar");
      if (navBar) navBar.hidden = false;
    }

    function filterEvents(events, searchNorm) {
      return events.filter(function (ev) {
        if (state.evals && !ev.category) {
          return false;
        }

        if (state.withTeacher) {
          const tList = ev.teachers || [];
          if (tList.length === 0) return false;
        }

        if (searchNorm) {
          const known = Object.prototype.hasOwnProperty.call(
            moduleInfo,
            ev.module,
          );
          const targetStr = AppUtils.normalizeSearch(
            CalendarModel.searchText(
              ev,
              known ? moduleInfo[ev.module].label : "",
            ),
          );

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
      if (resetBtn) {
        resetBtn.hidden =
          state.view === resolveDefaultView() &&
          state.layout === calendarConfig.default_layout &&
          !state.evals &&
          !state.withTeacher &&
          !state.search;
      }
      renderCalendarView(currentClassEvents);
      updateTimeMarker();
      spotlightNow();
    }

    const calendarView = CalendarView.create({
      currentClassId,
      firstDateStr,
      lastDateStr,
      schoolYearLabel,
      allowedDays,
      displayMode,
      categoryMap,
      moduleInfo,
      sessionMarks,
      labels,
      classLabel,
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
      isTimeGrid,
      gridRange,
    });
    function renderCalendarView(events) {
      calendarView.render(events);
    }

    function isTimeGrid() {
      return (
        state.layout === "grid" && state.view !== "year" && !mobileQuery.matches
      );
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

    window.addEventListener("resize", calendarView.fitTimeGrid);
    if (document.fonts) document.fonts.ready.then(calendarView.fitTimeGrid);

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
          const picked = parseISODate(dateInput.value);
          if (isNaN(picked.getTime())) return;
          const normalized = normalizeDate(picked);
          state.date = formatISODate(normalized);
          dateInput.value = state.date;
          render();
        }
      });
    }

    if (evalsOnlyCb) {
      evalsOnlyCb.addEventListener("change", function () {
        state.evals = evalsOnlyCb.checked;
        render();
      });
    }

    if (teacherCb) {
      teacherCb.addEventListener("change", function () {
        state.withTeacher = teacherCb.checked;
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
        state.layout = calendarConfig.default_layout;
        state.date = defaultDateStr;
        state.evals = false;
        state.withTeacher = false;
        state.search = "";
        updateControlsFromState();
        render();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        if (state.view === "year") return;
        const d = parseISODate(state.date);
        let targetDate;
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
        const d = parseISODate(state.date);
        let targetDate;
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
        const nowObj = getNowDate();
        const today = toWeekday(nowObj.date, 1);
        const todayIso = formatISODate(today);
        spotlightPending = true;

        if (state.view === "year") {
          document.documentElement.style.setProperty(
            "--site-header-height",
            stickyBarHeight() + "px",
          );
          const todayEl =
            document.getElementById(
              "day-section-" + formatISODate(nowObj.date),
            ) || document.getElementById("current-time-marker");
          if (todayEl) {
            todayEl.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            const firstDayEl = viewContainer.querySelector(".day-section");
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
          const marker = document.getElementById("current-time-marker");
          if (marker)
            marker.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const tag =
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
    requestAnimationFrame(function () {
      const layout = document.querySelector(".has-filter-bar");
      if (layout) layout.classList.add("is-layout-ready");
    });
  });
})();

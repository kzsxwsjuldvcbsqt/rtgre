(function (global) {
  function create({
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
    externalIcon,
    evaluationHref,
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
    todayIso,
    yearLoadHours,
  }) {
    const eventByItem = new WeakMap();

    function indexByDate(events) {
      const result = Object.create(null);
      events.forEach(function (event) {
        const date = event.start.substring(0, 10);
        if (!result[date]) result[date] = [];
        result[date].push(event);
      });
      return result;
    }

    function prepareDay(date, eventsByDate, search) {
      const iso = formatISODate(date);
      const dayEvents = eventsByDate[iso] || [];
      const events = filterEvents(dayEvents, search).sort(function (a, b) {
        return a.start.localeCompare(b.start);
      });
      return {
        dDate: date,
        dIso: iso,
        events: events,
        bounds: getDayBounds(dayEvents),
        dayCount: events.length,
      };
    }

    function renderCalendarView(events) {
      pinCard(null);
      const currDate = parseISODate(state.date);

      if (state.view !== "year") {
        if (prevBtn) {
          let prevTest;
          if (state.view === "week") {
            prevTest = new Date(currDate.getTime());
            prevTest.setDate(prevTest.getDate() - 7);
          } else {
            prevTest = getPrevWeekday(currDate);
          }
          prevBtn.disabled = prevTest < minDate;
        }

        if (nextBtn) {
          let nextTest;
          if (state.view === "week") {
            nextTest = new Date(currDate.getTime());
            nextTest.setDate(nextTest.getDate() + 7);
          } else {
            nextTest = getNextWeekday(currDate);
          }
          nextBtn.disabled = nextTest > maxDate;
        }
      }

      function setHeading(title, eyebrow) {
        if (!periodHeading) return;
        const parts = [document.createTextNode(title)];
        if (eyebrow) {
          const eyebrowEl = document.createElement("span");
          eyebrowEl.className = "heading-eyebrow";
          eyebrowEl.textContent = eyebrow;
          parts.unshift(eyebrowEl);
        }
        periodHeading.replaceChildren.apply(periodHeading, parts);
      }

      if (state.view === "year") {
        setHeading(schoolYearLabel);
      } else if (state.view === "week") {
        const wStart = getWeekStart(currDate);
        const wEnd = new Date(wStart.getTime());
        wEnd.setDate(wEnd.getDate() + allowedDays[allowedDays.length - 1] - 1);
        wStart.setDate(wStart.getDate() + allowedDays[0] - 1);
        const wNum = getISOWeekNumber(wStart);

        setHeading(
          AppUtils.formatText(
            wStart.getMonth() === wEnd.getMonth()
              ? labels.week_title_short
              : labels.week_title_short_split,
            {
              start_day: wStart.getDate(),
              start_month: labels.months_short[wStart.getMonth()],
              end_day: wEnd.getDate(),
              end_month: labels.months_short[wEnd.getMonth()],
            },
          ),
          AppUtils.formatText(labels.week_title_eyebrow, {
            prefix: labels.week_prefix,
            week: wNum,
          }),
        );
      } else {
        const dayIdx = (currDate.getDay() + 6) % 7;
        setHeading(
          AppUtils.formatText(labels.day_title_short, {
            day_name: labels.days_short[dayIdx],
            day_num: currDate.getDate(),
            month_name: labels.months_short[currDate.getMonth()],
          }),
        );
      }

      while (viewContainer.firstChild) {
        viewContainer.removeChild(viewContainer.firstChild);
      }

      const isFiltered = Boolean(
        state.evals ||
        state.withTeacher ||
        (state.search && state.search.trim().length > 0),
      );

      viewContainer.removeAttribute("data-range-start");
      viewContainer.removeAttribute("data-range-end");

      function setRange(startIso, endIso) {
        viewContainer.setAttribute("data-range-start", startIso);
        viewContainer.setAttribute("data-range-end", endIso);
      }

      viewContainer.className =
        "calendar-view-container calendar-view-" +
        state.view +
        (isFiltered ? " is-filtered" : "");

      function updateResultsCount(count) {
        const resultsCountEl = document.getElementById("cal-results-count");
        if (resultsCountEl) {
          const countSingular = labels.results_count_singular;
          const countPlural = labels.results_count_plural;
          const countLabel = count < 2 ? countSingular : countPlural;
          resultsCountEl.textContent = count + " " + countLabel;
        }
      }

      const searchNorm = AppUtils.normalizeSearch(state.search);
      if (state.view === "year") {
        setRange(firstDateStr, lastDateStr);
        const yearCount = renderYearView(
          events,
          searchNorm,
          dayNames,
          monthNames,
        );
        updateResultsCount(yearCount);
        return;
      }

      const daysToRender = [];
      if (state.view === "week") {
        const start = getWeekStart(currDate);
        for (let i = 0; i < allowedDays.length; i++) {
          const d = new Date(start.getTime());
          d.setDate(d.getDate() + allowedDays[i] - 1);
          if (d >= minDate && d <= maxDate) daysToRender.push(d);
        }
      } else {
        daysToRender.push(currDate);
      }

      if (daysToRender.length > 0) {
        setRange(
          formatISODate(daysToRender[0]),
          formatISODate(daysToRender[daysToRender.length - 1]),
        );
      }

      const dayRenderData = [];
      let totalWeekItems = 0;

      viewContainer.style.setProperty(
        "--calendar-day-count",
        daysToRender.length,
      );
      const eventsByDate = indexByDate(events);
      daysToRender.forEach(function (date) {
        const data = prepareDay(date, eventsByDate, searchNorm);
        totalWeekItems += data.dayCount;
        dayRenderData.push(data);
      });

      if (state.view === "week" && totalWeekItems === 0) {
        const emptyWeekP = document.createElement("p");
        emptyWeekP.className = "empty-state-message";
        emptyWeekP.textContent = labels.no_courses_week;
        emptyWeekP.setAttribute("data-date", formatISODate(daysToRender[0]));
        viewContainer.appendChild(emptyWeekP);
        updateResultsCount(0);
        return;
      }

      dayRenderData.forEach(function (dayData) {
        const daySection = buildDaySection(
          dayData,
          dayNames,
          monthNames,
          state.view === "week",
        );
        viewContainer.appendChild(daySection);
      });

      if (totalWeekItems > 0 && gridRange && isTimeGrid()) layoutTimeGrid();

      updateResultsCount(totalWeekItems);
    }

    function toMinutes(time) {
      const parts = time.split(":");
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }

    function formatMinutes(minutes) {
      return (
        String(Math.floor(minutes / 60)).padStart(2, "0") +
        ":" +
        String(minutes % 60).padStart(2, "0")
      );
    }

    function assignLanes(items) {
      const placements = [];
      let cluster = [];
      let laneEnds = [];
      let clusterEnd = "";
      function closeCluster() {
        cluster.forEach(function (placement) {
          placement.lanes = laneEnds.length;
        });
        cluster = [];
        laneEnds = [];
      }
      items.forEach(function (item) {
        const start = item.dataset.start;
        const end = item.dataset.end;
        if (cluster.length > 0 && start >= clusterEnd) closeCluster();
        let lane = laneEnds.findIndex(function (laneEnd) {
          return laneEnd <= start;
        });
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = end;
        clusterEnd = cluster.length > 0 && clusterEnd > end ? clusterEnd : end;
        const placement = { item: item, lane: lane, lanes: 1 };
        cluster.push(placement);
        placements.push(placement);
      });
      closeCluster();
      return placements;
    }

    function addFact(list, term, value) {
      if (!value) return;
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      list.appendChild(dt);
      list.appendChild(dd);
    }

    function eventLinks(ev) {
      const links = document.createElement("div");
      links.className = "event-links";
      if (ev.category && categoryMap[ev.category]) {
        const detail = document.createElement("a");
        detail.href = AppUtils.formatText(evaluationHref, {
          id: encodeURIComponent(ev.occurrence_id),
        });
        detail.textContent = labels.card_evaluation_link;
        links.appendChild(detail);
      }
      const known = Object.prototype.hasOwnProperty.call(moduleInfo, ev.module);
      if (known && moduleInfo[ev.module].url) {
        const course = document.createElement("a");
        course.href = moduleInfo[ev.module].url;
        course.target = "_blank";
        course.rel = "noopener noreferrer";
        course.appendChild(document.createTextNode(labels.card_course_link));
        course.appendChild(AppUtils.buildIcon(externalIcon, "icon-sm"));
        links.appendChild(course);
      }
      return links.childElementCount > 0 ? links : null;
    }

    function pinCard(item) {
      const current = viewContainer.querySelector(
        ".calendar-event-item.is-pinned",
      );
      const next = item && item !== current ? item : null;
      if (current) current.classList.remove("is-pinned");
      if (next) next.classList.add("is-pinned");
      viewContainer.classList.toggle("has-pinned", next !== null);
    }

    viewContainer.addEventListener("click", function (event) {
      if (event.target.closest(".event-card")) return;
      const item = event.target.closest(".calendar-event-item");
      pinCard(viewContainer.classList.contains("is-grid") ? item : null);
    });
    viewContainer.addEventListener("focusin", function (event) {
      const item = event.target.closest(".calendar-event-item");
      if (!item || !item.classList.contains("is-pinned")) pinCard(null);
    });
    document.addEventListener("click", function (event) {
      if (!viewContainer.contains(event.target)) pinCard(null);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") pinCard(null);
    });

    function buildCardContent(ev) {
      const card = document.createElement("div");
      card.className = "event-card";
      const known = Object.prototype.hasOwnProperty.call(moduleInfo, ev.module);

      const title = document.createElement("div");
      title.className = "event-card-title";
      const strong = document.createElement("strong");
      strong.textContent = ev.code || ev.title;
      title.appendChild(strong);
      if (ev.code && known) {
        title.appendChild(
          document.createTextNode(" " + moduleInfo[ev.module].label),
        );
      }
      card.appendChild(title);

      const day = parseISODate(ev.start.substring(0, 10));
      const when = document.createElement("div");
      when.className = "event-card-when";
      when.textContent = AppUtils.formatText(labels.card_when, {
        date: AppUtils.formatText(labels.day_title_short, {
          day_name: labels.days_short[(day.getDay() + 6) % 7],
          day_num: day.getDate(),
          month_name: labels.months_short[day.getMonth()],
        }),
        start: ev.start.substring(11, 16),
        end: ev.end.substring(11, 16),
      });
      card.appendChild(when);

      const session = [];
      if (ev.code && ev.session) session.push(ev.session);
      if (ev.seriesTotal) {
        session.push(
          AppUtils.formatText(labels.card_session_count, {
            index: ev.seriesIndex,
            total: ev.seriesTotal,
          }),
        );
      }
      if (ev.category && categoryMap[ev.category]) {
        session.push(categoryMap[ev.category].label);
      }
      (ev.flags || []).forEach(function (flag) {
        if (Object.prototype.hasOwnProperty.call(sessionMarks, flag)) {
          session.push(sessionMarks[flag]);
        }
      });

      const facts = document.createElement("dl");
      facts.className = "event-card-facts";
      addFact(facts, labels.card_session, session.join(labels.card_separator));
      addFact(facts, labels.card_rooms, ev.rooms.join(labels.list_separator));
      addFact(
        facts,
        labels.card_teachers,
        eventStaff(ev).join(labels.list_separator),
      );
      addFact(
        facts,
        labels.card_groups,
        otherGroups(ev).join(labels.list_separator),
      );
      card.appendChild(facts);
      const links = eventLinks(ev);
      if (links) card.appendChild(links);
      return card;
    }

    function buildEventCard(item) {
      const summary = document.createElement("div");
      summary.className = "event-summary";
      summary.setAttribute("aria-hidden", "true");
      Array.from(item.childNodes).forEach(function (node) {
        summary.appendChild(node);
      });
      const summaryCategory = summary.querySelector(".category-badge");
      if (summaryCategory) {
        const summaryTitle = summary.querySelector(".event-title");
        summaryTitle.parentNode.insertBefore(
          summaryCategory,
          summaryTitle.nextSibling,
        );
      }
      item.appendChild(summary);
      item.appendChild(buildCardContent(eventByItem.get(item)));
      item.tabIndex = 0;
    }

    function layoutTimeGrid() {
      viewContainer.classList.add("is-grid");
      viewContainer.style.setProperty(
        "--calendar-grid-minutes",
        gridRange.end - gridRange.start,
      );

      const hours = document.createElement("div");
      hours.className = "calendar-hours";
      hours.setAttribute("aria-hidden", "true");
      for (
        let minute = gridRange.start;
        minute <= gridRange.end;
        minute += 60
      ) {
        const hour = document.createElement("span");
        hour.className = "calendar-hour";
        hour.textContent = formatMinutes(minute);
        hour.style.setProperty("--calendar-offset", minute - gridRange.start);
        hours.appendChild(hour);
      }
      viewContainer.insertBefore(hours, viewContainer.firstChild);
      fitTimeGrid();

      viewContainer
        .querySelectorAll(".day-section")
        .forEach(function (section) {
          let list = section.querySelector(".calendar-events-list");
          if (!list) {
            const empty = section.querySelector(".empty-state-message");
            if (empty) empty.remove();
            list = document.createElement("ul");
            list.className = "calendar-events-list";
            section.appendChild(list);
          }
          assignLanes(
            Array.from(list.querySelectorAll(".calendar-event-item")),
          ).forEach(function (placement) {
            const item = placement.item;
            const start = toMinutes(item.dataset.start);
            item.style.setProperty(
              "--calendar-offset",
              start - gridRange.start,
            );
            item.style.setProperty(
              "--event-span",
              toMinutes(item.dataset.end) - start,
            );
            item.style.setProperty("--event-lane", placement.lane);
            item.style.setProperty("--event-lanes", placement.lanes);
            buildEventCard(item);
          });
        });
    }

    function buildDaySection(dayData, dayNames, monthNames, includeHeading) {
      const dDate = dayData.dDate;
      const dIso = dayData.dIso;

      const daySection = document.createElement("section");
      daySection.className = "day-section";
      daySection.setAttribute("id", "day-section-" + dIso);
      daySection.setAttribute("data-date", dIso);
      const isoDay = dDate.getDay() === 0 ? 7 : dDate.getDay();
      daySection.setAttribute("data-day", String(isoDay));

      if (includeHeading) {
        const dayIdx = (dDate.getDay() + 6) % 7;
        const heading = document.createElement("h3");
        const headingName = document.createElement("span");
        headingName.className = "day-heading-name";
        headingName.textContent = dayNames[dayIdx];
        const headingDate = document.createElement("span");
        headingDate.className = "day-heading-date";
        headingDate.textContent = AppUtils.formatText(labels.week_day_date, {
          day_num: dDate.getDate(),
          month_name: monthNames[dDate.getMonth()],
        });
        heading.appendChild(headingName);
        heading.appendChild(document.createTextNode(" "));
        heading.appendChild(headingDate);
        daySection.appendChild(heading);
      }

      if (dayData.events.length === 0) {
        const noCoursesP = document.createElement("p");
        noCoursesP.className = "empty-state-message";
        noCoursesP.textContent = labels.no_courses;
        daySection.appendChild(noCoursesP);
      } else {
        const ul = document.createElement("ul");
        ul.className = "calendar-events-list";
        dayData.events.forEach(function (event) {
          ul.appendChild(renderEventItem(event, dayData.bounds));
        });
        daySection.appendChild(ul);
      }

      return daySection;
    }

    function element(tagName, className, text) {
      const node = document.createElement(tagName);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function countLabel(count) {
      return (
        count +
        " " +
        (count < 2
          ? labels.results_count_singular
          : labels.results_count_plural)
      );
    }

    function yearDay(dayData, today, dayNames, monthNames) {
      const date = dayData.dDate;
      const taught = dayData.dayCount > 0;
      const cell = element(taught ? "a" : "span", "year-day", date.getDate());
      if (dayData.dIso === today) cell.classList.add("is-today");
      if (!taught) return cell;

      const assessed = dayData.events.some(function (event) {
        return event.category && categoryMap[event.category];
      });
      const summary = AppUtils.formatText(labels.year_day, {
        date: AppUtils.formatText(labels.day_title, {
          day_name: dayNames[(date.getDay() + 6) % 7],
          day_num: date.getDate(),
          month_name: monthNames[date.getMonth()],
          year: date.getFullYear(),
        }),
        count: countLabel(dayData.dayCount),
      });
      const label = assessed
        ? AppUtils.formatText(labels.year_day_evaluation, { summary: summary })
        : summary;
      cell.classList.add(
        "load-" +
          CalendarModel.loadLevel(
            CalendarModel.occupiedMinutes(dayData.events),
            yearLoadHours,
          ),
      );
      if (assessed) cell.classList.add("has-evaluation");
      cell.href = AppUtils.buildHash({ view: "day", date: dayData.dIso });
      cell.title = label;
      cell.setAttribute("aria-label", label);
      return cell;
    }

    function yearLegend() {
      const legend = element("p", "year-legend");
      function item(marks, text) {
        const entry = element("span", "year-legend-item");
        marks.forEach(function (mark) {
          const sample = element("span", "year-day " + mark);
          sample.setAttribute("aria-hidden", "true");
          entry.appendChild(sample);
        });
        entry.appendChild(document.createTextNode(text));
        legend.appendChild(entry);
      }
      item(["is-sample"], labels.year_legend_none);
      item(
        yearLoadHours
          .map(function (hours, index) {
            return "is-sample load-" + (index + 1);
          })
          .concat("is-sample load-" + (yearLoadHours.length + 1)),
        labels.year_legend_load,
      );
      item(["is-sample load-1 has-evaluation"], labels.year_legend_evaluation);
      item(["is-sample is-today"], labels.year_legend_today);
      item([], labels.year_legend_week);
      return legend;
    }

    function resultsTitle(searchNorm) {
      const query = state.search.trim();
      if (!query) return labels.year_results;
      const code = Object.keys(moduleInfo).find(function (key) {
        return AppUtils.normalizeSearch(key) === searchNorm;
      });
      return code
        ? AppUtils.formatText(labels.year_results_module, {
            code: code,
            label: moduleInfo[code].label,
          })
        : AppUtils.formatText(labels.year_results_query, { query: query });
    }

    function yearResults(title, count, sections) {
      const results = element("section", "year-results");
      const head = element("header", "data-box-head");
      head.appendChild(element("h2", "", title));
      head.appendChild(element("span", "data-box-meta", count));
      const days = element("div", "year-days");
      sections.forEach(function (section) {
        days.appendChild(section);
      });
      results.appendChild(head);
      results.appendChild(days);
      return results;
    }

    function renderYearView(events, searchNorm, dayNames, monthNames) {
      const hasFilter = Boolean(
        state.evals ||
        state.withTeacher ||
        (searchNorm && searchNorm.length > 0),
      );
      const eventsByDate = indexByDate(events);
      const today = todayIso();
      const months = element("div", "year-months");
      months.style.setProperty("--year-day-count", allowedDays.length);
      const sections = [];
      let total = 0;

      const cursor = parseISODate(firstDateStr);
      cursor.setDate(1);
      const lastDate = parseISODate(lastDateStr);
      while (cursor <= lastDate) {
        const mYear = cursor.getFullYear();
        const mMonth = cursor.getMonth();
        const month = element("section", "year-month");
        month.appendChild(
          element(
            "h3",
            "",
            AppUtils.formatText(labels.year_month, {
              month_name:
                monthNames[mMonth].charAt(0).toUpperCase() +
                monthNames[mMonth].slice(1),
              year: mYear,
            }),
          ),
        );
        const grid = element("div", "year-month-grid");
        grid.appendChild(element("span", "year-weekday"));
        allowedDays.forEach(function (isoDay) {
          grid.appendChild(
            element(
              "span",
              "year-weekday",
              dayNames[isoDay - 1].charAt(0).toUpperCase(),
            ),
          );
        });

        const weekStart = getWeekStart(new Date(mYear, mMonth, 1));
        const monthEnd = new Date(mYear, mMonth + 1, 0);
        let filled = false;
        while (weekStart <= monthEnd) {
          const days = allowedDays
            .map(function (isoDay) {
              const date = new Date(weekStart.getTime());
              date.setDate(date.getDate() + isoDay - 1);
              return date;
            })
            .map(function (date) {
              const iso = formatISODate(date);
              return date.getMonth() === mMonth &&
                iso >= firstDateStr &&
                iso <= lastDateStr
                ? prepareDay(date, eventsByDate, searchNorm)
                : null;
            });
          if (days.some(Boolean)) {
            filled = true;
            const week = element("a", "year-week", getISOWeekNumber(weekStart));
            week.href = AppUtils.buildHash({
              view: "week",
              date: formatISODate(weekStart),
            });
            week.setAttribute(
              "aria-label",
              labels.week_prefix + " " + getISOWeekNumber(weekStart),
            );
            grid.appendChild(week);
            days.forEach(function (dayData) {
              if (!dayData) {
                grid.appendChild(element("span", "year-day is-outside"));
                return;
              }
              grid.appendChild(yearDay(dayData, today, dayNames, monthNames));
              total += dayData.dayCount;
              if (hasFilter && dayData.dayCount > 0) {
                sections.push(
                  buildDaySection(dayData, dayNames, monthNames, true),
                );
              }
            });
          }
          weekStart.setDate(weekStart.getDate() + 7);
        }

        if (filled) {
          month.appendChild(grid);
          months.appendChild(month);
        }
        cursor.setMonth(mMonth + 1);
      }

      if (hasFilter && total === 0) {
        viewContainer.appendChild(
          element("p", "empty-state-message", labels.year_no_results),
        );
      } else if (hasFilter) {
        viewContainer.appendChild(
          yearResults(resultsTitle(searchNorm), total, sections),
        );
      }
      const overview = element("div", "year-overview");
      overview.appendChild(months);
      overview.appendChild(yearLegend());
      viewContainer.appendChild(overview);
      return total;
    }

    function getDayBounds(events) {
      if (events.length === 0) return { minStart: null, maxEnd: null };
      let minStart = events[0].start.substring(11, 16);
      let maxEnd = events[0].end.substring(11, 16);
      for (let i = 1; i < events.length; i++) {
        const s = events[i].start.substring(11, 16);
        const e = events[i].end.substring(11, 16);
        if (s < minStart) minStart = s;
        if (e > maxEnd) maxEnd = e;
      }
      return { minStart: minStart, maxEnd: maxEnd };
    }

    function eventStaff(ev) {
      if (displayMode !== "hidden" && ev.teachers.length > 0)
        return ev.teachers;
      return ev.staff_markers;
    }

    function otherGroups(ev) {
      const ownGroups = [
        classLabel.toLowerCase(),
        currentClassId.toLowerCase(),
      ];
      return ev.groups.filter(function (group) {
        return ownGroups.indexOf(group.toLowerCase()) === -1;
      });
    }

    function appendTags(parent, className, values) {
      if (values.length === 0) return;
      const block = document.createElement("div");
      block.className = className;
      values.forEach(function (value, index) {
        const tag = document.createElement("span");
        tag.className = "room-tag";
        tag.textContent = value;
        block.appendChild(tag);
        if (index < values.length - 1) {
          block.appendChild(document.createTextNode(labels.list_separator));
        }
      });
      parent.appendChild(block);
    }

    function renderEventItem(ev, bounds) {
      const li = document.createElement("li");
      li.className = "calendar-event-item";
      eventByItem.set(li, ev);
      const isEvaluation = Boolean(ev.category && categoryMap[ev.category]);
      if (isEvaluation) li.classList.add("is-evaluation");
      if (Object.prototype.hasOwnProperty.call(moduleInfo, ev.module)) {
        const info = moduleInfo[ev.module];
        li.classList.add("kind-" + info.kind, "tone-" + info.tone);
      } else {
        li.classList.add("is-special");
      }

      const startTime = ev.start.substring(11, 16);
      const endTime = ev.end.substring(11, 16);

      li.setAttribute("data-start", startTime);
      li.setAttribute("data-end", endTime);

      const isDayStart = Boolean(
        bounds && bounds.minStart && startTime === bounds.minStart,
      );
      const isDayEnd = Boolean(
        bounds && bounds.maxEnd && endTime === bounds.maxEnd,
      );

      const timeDiv = document.createElement("div");
      timeDiv.className = "event-time";
      const startSpan = document.createElement("span");
      startSpan.className =
        "event-time-start" + (isDayStart ? " is-day-start" : "");
      startSpan.textContent = startTime;
      const endSpan = document.createElement("span");
      endSpan.className = "event-time-end" + (isDayEnd ? " is-day-end" : "");
      endSpan.textContent = endTime;
      timeDiv.appendChild(startSpan);
      timeDiv.appendChild(document.createTextNode(" - "));
      timeDiv.appendChild(endSpan);
      li.appendChild(timeDiv);

      const infoDiv = document.createElement("div");
      infoDiv.className = "event-info";

      const titleDiv = document.createElement("div");
      titleDiv.className = "event-title";
      const nameSpan = document.createElement("span");
      nameSpan.className = "event-name";
      const nameStrong = document.createElement("strong");
      nameStrong.textContent = ev.code || ev.title;
      nameSpan.appendChild(nameStrong);
      if (ev.code)
        nameSpan.appendChild(document.createTextNode(" " + ev.session));
      titleDiv.appendChild(nameSpan);
      titleDiv.appendChild(document.createTextNode(" "));

      if (ev.seriesTotal) {
        const seriesSpan = document.createElement("span");
        seriesSpan.className = "event-series";
        seriesSpan.textContent = ev.seriesIndex + "/" + ev.seriesTotal;
        titleDiv.appendChild(seriesSpan);
        titleDiv.appendChild(document.createTextNode(" "));
      }

      if (isEvaluation) {
        const cat = categoryMap[ev.category];
        const catSpan = document.createElement("span");
        catSpan.className = cat.tone
          ? "category-badge label-" + cat.tone
          : "category-badge";
        catSpan.textContent = cat.label;
        titleDiv.appendChild(catSpan);
        titleDiv.appendChild(document.createTextNode(" "));
      } else {
        (ev.flags || []).forEach(function (flag) {
          if (!Object.prototype.hasOwnProperty.call(sessionMarks, flag)) return;
          const markSpan = document.createElement("span");
          markSpan.className = "category-badge session-mark";
          markSpan.textContent = sessionMarks[flag];
          titleDiv.appendChild(markSpan);
          titleDiv.appendChild(document.createTextNode(" "));
        });
      }

      infoDiv.appendChild(titleDiv);

      appendTags(infoDiv, "event-teachers", eventStaff(ev));
      appendTags(infoDiv, "event-rooms", ev.rooms);
      appendTags(infoDiv, "event-groups", otherGroups(ev));
      const links = eventLinks(ev);
      if (links) infoDiv.appendChild(links);

      li.appendChild(infoDiv);

      return li;
    }

    function fitTimeGrid() {
      const hours = viewContainer.querySelector(".calendar-hours");
      if (!hours) return;
      viewContainer.style.setProperty(
        "--calendar-grid-top",
        hours.getBoundingClientRect().top + window.scrollY + "px",
      );
    }

    return { render: renderCalendarView, fitTimeGrid: fitTimeGrid };
  }
  global.CalendarView = { create };
})(globalThis);

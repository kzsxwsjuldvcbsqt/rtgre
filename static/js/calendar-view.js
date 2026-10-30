(function (global) {
  function create({
    currentClassId,
    firstDateStr,
    lastDateStr,
    schoolYearLabel,
    allowedDays,
    displayMode,
    categoryMap,
    moduleStyles,
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
    isWeekGrid,
    gridRange,
  }) {
    function indexByDate(events) {
      var result = Object.create(null);
      events.forEach(function (event) {
        var date = event.start.substring(0, 10);
        if (!result[date]) result[date] = [];
        result[date].push(event);
      });
      return result;
    }

    function prepareDay(date, eventsByDate, search) {
      var iso = formatISODate(date);
      var dayEvents = eventsByDate[iso] || [];
      var events = filterEvents(dayEvents, search).sort(function (a, b) {
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
      var currDate = parseISODate(state.date);

      if (state.view !== "year") {
        if (prevBtn) {
          var prevTest;
          if (state.view === "week") {
            prevTest = new Date(currDate.getTime());
            prevTest.setDate(prevTest.getDate() - 7);
          } else {
            prevTest = getPrevWeekday(currDate);
          }
          prevBtn.disabled = prevTest < minDate;
        }

        if (nextBtn) {
          var nextTest;
          if (state.view === "week") {
            nextTest = new Date(currDate.getTime());
            nextTest.setDate(nextTest.getDate() + 7);
          } else {
            nextTest = getNextWeekday(currDate);
          }
          nextBtn.disabled = nextTest > maxDate;
        }
      }

      if (state.view === "year") {
        if (periodHeading) {
          periodHeading.textContent = schoolYearLabel;
        }
      } else if (state.view === "week") {
        var wStart = getWeekStart(currDate);
        var wEnd = new Date(wStart.getTime());
        wEnd.setDate(wEnd.getDate() + allowedDays[allowedDays.length - 1] - 1);
        wStart.setDate(wStart.getDate() + allowedDays[0] - 1);
        var wNum = getISOWeekNumber(wStart);

        if (periodHeading) {
          periodHeading.textContent = AppUtils.formatText(labels.week_title, {
            prefix: labels.week_prefix,
            week: wNum,
            start_day: wStart.getDate(),
            start_month: monthNames[wStart.getMonth()],
            end_day: wEnd.getDate(),
            end_month: monthNames[wEnd.getMonth()],
            year: wEnd.getFullYear(),
          });
        }
      } else {
        if (periodHeading) {
          var dayIdx = (currDate.getDay() + 6) % 7;
          periodHeading.textContent = AppUtils.formatText(labels.day_title, {
            day_name: dayNames[dayIdx],
            day_num: currDate.getDate(),
            month_name: monthNames[currDate.getMonth()],
            year: currDate.getFullYear(),
          });
        }
      }

      while (viewContainer.firstChild) {
        viewContainer.removeChild(viewContainer.firstChild);
      }

      var isFiltered = Boolean(
        state.evals ||
        state.teacherless ||
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
        var resultsCountEl = document.getElementById("cal-results-count");
        if (resultsCountEl) {
          var countSingular = labels.results_count_singular;
          var countPlural = labels.results_count_plural;
          var countLabel = count < 2 ? countSingular : countPlural;
          resultsCountEl.textContent = count + " " + countLabel;
        }
      }

      var searchNorm = AppUtils.stripAccents(state.search).toLowerCase();
      if (state.view === "year") {
        setRange(firstDateStr, lastDateStr);
        var yearCount = renderYearView(
          events,
          searchNorm,
          dayNames,
          monthNames,
        );
        updateResultsCount(yearCount);
        return;
      }

      var daysToRender = [];
      if (state.view === "week") {
        var start = getWeekStart(currDate);
        for (var i = 0; i < allowedDays.length; i++) {
          var d = new Date(start.getTime());
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

      var dayRenderData = [];
      var totalWeekItems = 0;

      viewContainer.style.setProperty(
        "--calendar-day-count",
        daysToRender.length,
      );
      var eventsByDate = indexByDate(events);
      daysToRender.forEach(function (date) {
        var data = prepareDay(date, eventsByDate, searchNorm);
        totalWeekItems += data.dayCount;
        dayRenderData.push(data);
      });

      if (state.view === "week" && totalWeekItems === 0) {
        var emptyWeekP = document.createElement("p");
        emptyWeekP.className = "empty-state-message";
        emptyWeekP.textContent = labels.no_courses_week;
        emptyWeekP.setAttribute("data-date", formatISODate(daysToRender[0]));
        viewContainer.appendChild(emptyWeekP);
        updateResultsCount(0);
        return;
      }

      dayRenderData.forEach(function (dayData) {
        var daySection = buildDaySection(
          dayData,
          dayNames,
          monthNames,
          state.view === "week",
        );
        viewContainer.appendChild(daySection);
      });

      if (state.view === "week" && gridRange && isWeekGrid()) layoutWeekGrid();

      updateResultsCount(totalWeekItems);
    }

    function toMinutes(time) {
      var parts = time.split(":");
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
      var placements = [];
      var cluster = [];
      var laneEnds = [];
      var clusterEnd = "";
      function closeCluster() {
        cluster.forEach(function (placement) {
          placement.lanes = laneEnds.length;
        });
        cluster = [];
        laneEnds = [];
      }
      items.forEach(function (item) {
        var start = item.dataset.start;
        var end = item.dataset.end;
        if (cluster.length > 0 && start >= clusterEnd) closeCluster();
        var lane = laneEnds.findIndex(function (laneEnd) {
          return laneEnd <= start;
        });
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = end;
        clusterEnd = cluster.length > 0 && clusterEnd > end ? clusterEnd : end;
        var placement = { item: item, lane: lane, lanes: 1 };
        cluster.push(placement);
        placements.push(placement);
      });
      closeCluster();
      return placements;
    }

    function buildEventCard(item) {
      var summary = document.createElement("div");
      summary.className = "event-summary";
      summary.setAttribute("aria-hidden", "true");
      var card = document.createElement("div");
      card.className = "event-card";
      Array.from(item.childNodes).forEach(function (node) {
        card.appendChild(node.cloneNode(true));
        summary.appendChild(node);
      });
      var summaryCategory = summary.querySelector(".category-badge");
      if (summaryCategory) {
        var summaryTitle = summary.querySelector(".event-title");
        summaryTitle.parentNode.insertBefore(
          summaryCategory,
          summaryTitle.nextSibling,
        );
      }
      item.appendChild(summary);
      item.appendChild(card);
      item.tabIndex = 0;
    }

    function layoutWeekGrid() {
      viewContainer.classList.add("is-grid");
      viewContainer.style.setProperty(
        "--calendar-grid-minutes",
        gridRange.end - gridRange.start,
      );

      var hours = document.createElement("div");
      hours.className = "calendar-hours";
      hours.setAttribute("aria-hidden", "true");
      for (
        var minute = gridRange.start;
        minute <= gridRange.end;
        minute += 60
      ) {
        var hour = document.createElement("span");
        hour.className = "calendar-hour";
        hour.textContent = formatMinutes(minute);
        hour.style.setProperty("--calendar-offset", minute - gridRange.start);
        hours.appendChild(hour);
      }
      viewContainer.insertBefore(hours, viewContainer.firstChild);

      viewContainer
        .querySelectorAll(".day-section")
        .forEach(function (section) {
          var list = section.querySelector(".calendar-events-list");
          if (!list) {
            var empty = section.querySelector(".empty-state-message");
            if (empty) empty.remove();
            list = document.createElement("ul");
            list.className = "calendar-events-list";
            section.appendChild(list);
          }
          assignLanes(
            Array.from(list.querySelectorAll(".calendar-event-item")),
          ).forEach(function (placement) {
            var item = placement.item;
            var start = toMinutes(item.dataset.start);
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
      var dDate = dayData.dDate;
      var dIso = dayData.dIso;

      var daySection = document.createElement("section");
      daySection.className = "day-section";
      daySection.setAttribute("id", "day-section-" + dIso);
      daySection.setAttribute("data-date", dIso);
      var isoDay = dDate.getDay() === 0 ? 7 : dDate.getDay();
      daySection.setAttribute("data-day", String(isoDay));

      if (includeHeading) {
        var dayIdx = (dDate.getDay() + 6) % 7;
        var heading = document.createElement("h3");
        if (state.view === "week") {
          var headingName = document.createElement("span");
          headingName.className = "day-heading-name";
          headingName.textContent = dayNames[dayIdx];
          var headingDate = document.createElement("span");
          headingDate.className = "day-heading-date";
          headingDate.textContent = AppUtils.formatText(labels.week_day_date, {
            day_num: dDate.getDate(),
            month_name: monthNames[dDate.getMonth()],
          });
          heading.appendChild(headingName);
          heading.appendChild(document.createTextNode(" "));
          heading.appendChild(headingDate);
        } else {
          heading.textContent = AppUtils.formatText(labels.day_title, {
            day_name: dayNames[dayIdx],
            day_num: dDate.getDate(),
            month_name: monthNames[dDate.getMonth()],
            year: dDate.getFullYear(),
          });
        }
        daySection.appendChild(heading);
      }

      if (dayData.events.length === 0) {
        var noCoursesP = document.createElement("p");
        noCoursesP.className = "empty-state-message";
        noCoursesP.textContent = labels.no_courses;
        daySection.appendChild(noCoursesP);
      } else {
        var ul = document.createElement("ul");
        ul.className = "calendar-events-list";
        dayData.events.forEach(function (event) {
          ul.appendChild(renderEventItem(event, dayData.bounds));
        });
        daySection.appendChild(ul);
      }

      return daySection;
    }

    function renderYearView(events, searchNorm, dayNames, monthNames) {
      var frag = document.createDocumentFragment();
      var totalYearItems = 0;
      var hasFilter = Boolean(
        state.evals ||
        state.teacherless ||
        (searchNorm && searchNorm.length > 0),
      );

      var eventsByDate = indexByDate(events);

      var startY = parseISODate(firstDateStr).getFullYear();
      var startM = parseISODate(firstDateStr).getMonth();
      var endY = parseISODate(lastDateStr).getFullYear();
      var endM = parseISODate(lastDateStr).getMonth();

      var monthsList = [];
      var curY = startY;
      var curM = startM;
      while (curY < endY || (curY === endY && curM <= endM)) {
        monthsList.push({ year: curY, month: curM });
        curM++;
        if (curM > 11) {
          curM = 0;
          curY++;
        }
      }

      monthsList.forEach(function (mObj) {
        var mYear = mObj.year;
        var mMonth = mObj.month;
        var daysInMonth = new Date(mYear, mMonth + 1, 0).getDate();

        var monthNameCap = monthNames[mMonth];
        monthNameCap =
          monthNameCap.charAt(0).toUpperCase() + monthNameCap.slice(1);
        var monthHeadingText = monthNameCap + " " + mYear;

        var monthFrag = document.createDocumentFragment();

        var weeksInMonth = {};
        var weekOrder = [];
        for (var day = 1; day <= daysInMonth; day++) {
          var d = new Date(mYear, mMonth, day);
          var dayOfWeek = d.getDay();
          if (allowedDays.indexOf(dayOfWeek || 7) === -1) continue;
          var iso = formatISODate(d);
          if (iso < firstDateStr || iso > lastDateStr) continue;

          var wStart = getWeekStart(d);
          var wKey = formatISODate(wStart);
          if (!weeksInMonth[wKey]) {
            weeksInMonth[wKey] = [];
            weekOrder.push(wKey);
          }
          weeksInMonth[wKey].push(d);
        }

        weekOrder.forEach(function (wKey) {
          var weekDays = weeksInMonth[wKey];
          var weekDataList = [];
          var weekItemCount = 0;

          weekDays.forEach(function (date) {
            var data = prepareDay(date, eventsByDate, searchNorm);
            weekItemCount += data.dayCount;
            weekDataList.push(data);
          });

          totalYearItems += weekItemCount;

          if (hasFilter) {
            weekDataList.forEach(function (dayData) {
              if (dayData.dayCount === 0) return;
              var daySection = buildDaySection(
                dayData,
                dayNames,
                monthNames,
                true,
              );
              monthFrag.appendChild(daySection);
            });
          } else {
            if (weekItemCount === 0) {
              var wNum = getISOWeekNumber(weekDays[0]);
              var emptyWeekP = document.createElement("p");
              emptyWeekP.className = "empty-state-message";
              emptyWeekP.textContent =
                labels.week_prefix +
                " " +
                wNum +
                " : " +
                labels.no_courses_week;
              emptyWeekP.setAttribute("data-date", formatISODate(weekDays[0]));
              monthFrag.appendChild(emptyWeekP);
            } else {
              weekDataList.forEach(function (dayData) {
                var daySection = buildDaySection(
                  dayData,
                  dayNames,
                  monthNames,
                  true,
                );
                monthFrag.appendChild(daySection);
              });
            }
          }
        });

        if (monthFrag.hasChildNodes()) {
          var mTitle = document.createElement("h2");
          mTitle.className = "year-month-title";
          mTitle.textContent = monthHeadingText;
          mTitle.setAttribute(
            "data-date",
            formatISODate(new Date(mYear, mMonth, 1)),
          );
          frag.appendChild(mTitle);
          frag.appendChild(monthFrag);
        }
      });

      if (hasFilter && totalYearItems === 0) {
        var emptyP = document.createElement("p");
        emptyP.className = "empty-state-message";
        emptyP.textContent = labels.no_courses;
        frag.appendChild(emptyP);
      }

      viewContainer.appendChild(frag);
      return totalYearItems;
    }

    function getDayBounds(events) {
      if (events.length === 0) return { minStart: null, maxEnd: null };
      var minStart = events[0].start.substring(11, 16);
      var maxEnd = events[0].end.substring(11, 16);
      for (var i = 1; i < events.length; i++) {
        var s = events[i].start.substring(11, 16);
        var e = events[i].end.substring(11, 16);
        if (s < minStart) minStart = s;
        if (e > maxEnd) maxEnd = e;
      }
      return { minStart: minStart, maxEnd: maxEnd };
    }

    function renderEventItem(ev, bounds) {
      var li = document.createElement("li");
      li.className = "calendar-event-item";
      var isEvaluation = Boolean(ev.category && categoryMap[ev.category]);
      if (isEvaluation) li.classList.add("is-evaluation");
      if (Object.prototype.hasOwnProperty.call(moduleStyles, ev.module)) {
        var moduleStyle = moduleStyles[ev.module];
        li.classList.add(
          "kind-" + moduleStyle.kind,
          "tone-" + moduleStyle.tone,
        );
      } else {
        li.classList.add("is-special");
      }

      var startTime = ev.start.substring(11, 16);
      var endTime = ev.end.substring(11, 16);
      var sep = labels.list_separator;

      li.setAttribute("data-start", startTime);
      li.setAttribute("data-end", endTime);

      var isDayStart = Boolean(
        bounds && bounds.minStart && startTime === bounds.minStart,
      );
      var isDayEnd = Boolean(
        bounds && bounds.maxEnd && endTime === bounds.maxEnd,
      );

      var timeDiv = document.createElement("div");
      timeDiv.className = "event-time";
      var startSpan = document.createElement("span");
      startSpan.className =
        "event-time-start" + (isDayStart ? " is-day-start" : "");
      startSpan.textContent = startTime;
      var endSpan = document.createElement("span");
      endSpan.className = "event-time-end" + (isDayEnd ? " is-day-end" : "");
      endSpan.textContent = endTime;
      timeDiv.appendChild(startSpan);
      timeDiv.appendChild(document.createTextNode(" - "));
      timeDiv.appendChild(endSpan);
      li.appendChild(timeDiv);

      var infoDiv = document.createElement("div");
      infoDiv.className = "event-info";

      var titleDiv = document.createElement("div");
      titleDiv.className = "event-title";
      titleDiv.appendChild(document.createTextNode(ev.title + " "));

      if (ev.seriesTotal) {
        var seriesSpan = document.createElement("span");
        seriesSpan.className = "event-series";
        seriesSpan.textContent = ev.seriesIndex + "/" + ev.seriesTotal;
        titleDiv.appendChild(seriesSpan);
        titleDiv.appendChild(document.createTextNode(" "));
      }

      if (isEvaluation) {
        var cat = categoryMap[ev.category];
        var catSpan = document.createElement("span");
        catSpan.className = "category-badge cat-" + cat.id;
        catSpan.textContent = cat.label;
        titleDiv.appendChild(catSpan);
        titleDiv.appendChild(document.createTextNode(" "));
      } else {
        (ev.flags || []).forEach(function (flag) {
          if (!Object.prototype.hasOwnProperty.call(sessionMarks, flag)) return;
          var markSpan = document.createElement("span");
          markSpan.className = "category-badge session-mark";
          markSpan.textContent = sessionMarks[flag];
          titleDiv.appendChild(markSpan);
          titleDiv.appendChild(document.createTextNode(" "));
        });
      }

      infoDiv.appendChild(titleDiv);

      var teachersToDisplay = [];
      if (displayMode !== "hidden" && ev.teachers && ev.teachers.length > 0) {
        teachersToDisplay = ev.teachers;
      } else if (ev.staff_markers && ev.staff_markers.length > 0) {
        teachersToDisplay = ev.staff_markers;
      }

      if (teachersToDisplay.length > 0) {
        var teachersDiv = document.createElement("div");
        teachersDiv.className = "event-teachers";
        teachersToDisplay.forEach(function (t, idx) {
          var tagSpan = document.createElement("span");
          tagSpan.className = "room-tag";
          tagSpan.textContent = t;
          teachersDiv.appendChild(tagSpan);
          if (idx < teachersToDisplay.length - 1) {
            teachersDiv.appendChild(document.createTextNode(sep));
          }
        });
        infoDiv.appendChild(teachersDiv);
      }

      if (ev.rooms && ev.rooms.length > 0) {
        var roomsDiv = document.createElement("div");
        roomsDiv.className = "event-rooms";
        ev.rooms.forEach(function (r, idx) {
          var tagSpan = document.createElement("span");
          tagSpan.className = "room-tag";
          tagSpan.textContent = r;
          roomsDiv.appendChild(tagSpan);
          if (idx < ev.rooms.length - 1) {
            roomsDiv.appendChild(document.createTextNode(sep));
          }
        });
        infoDiv.appendChild(roomsDiv);
      }

      var ownGroups = [classLabel.toLowerCase(), currentClassId.toLowerCase()];
      var otherGroups = (ev.groups || []).filter(function (g) {
        return ownGroups.indexOf(g.toLowerCase()) === -1;
      });

      if (otherGroups.length > 0) {
        var groupsDiv = document.createElement("div");
        groupsDiv.className = "event-groups";
        otherGroups.forEach(function (g, idx) {
          var tagSpan = document.createElement("span");
          tagSpan.className = "room-tag";
          tagSpan.textContent = g;
          groupsDiv.appendChild(tagSpan);
          if (idx < otherGroups.length - 1) {
            groupsDiv.appendChild(document.createTextNode(sep));
          }
        });
        infoDiv.appendChild(groupsDiv);
      }

      li.appendChild(infoDiv);

      return li;
    }

    return { render: renderCalendarView };
  }
  global.CalendarView = { create };
})(globalThis);

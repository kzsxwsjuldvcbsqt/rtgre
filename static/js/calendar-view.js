(function (global) {
  function create({
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

    function prepareDay(
      date,
      primaryByDate,
      comparedByDate,
      search,
      sameOnly,
      showCompared,
    ) {
      var iso = formatISODate(date);
      var primary = filterEvents(primaryByDate[iso] || [], search);
      var compared = state.compare
        ? filterEvents(comparedByDate[iso] || [], search)
        : [];
      function slotKey(event) {
        return JSON.stringify([event.slug, event.start, event.end]);
      }
      var sharedSlots = new Set(compared.map(slotKey));
      var primaryItems = primary
        .map(function (event) {
          return {
            event: event,
            isPrimary: true,
            isShared: sharedSlots.has(slotKey(event)),
          };
        })
        .filter(function (item) {
          return !sameOnly || item.isShared;
        });
      var comparedItems =
        state.compare && showCompared
          ? compared.map(function (event) {
              return { event: event, isPrimary: false, isShared: false };
            })
          : [];
      [primaryItems, comparedItems].forEach(function (items) {
        items.sort(function (a, b) {
          return a.event.start.localeCompare(b.event.start);
        });
      });
      var pBounds = getDayBounds(
        (primaryByDate[iso] || []).map(function (event) {
          return { event: event };
        }),
      );
      return {
        dDate: date,
        dIso: iso,
        pEvents: primary,
        cEvents: compared,
        pItems: primaryItems,
        cItems: comparedItems,
        pBounds: pBounds,
        dayCount: primaryItems.length + comparedItems.length,
      };
    }

    function renderCalendarView(primaryEvents, compareEvents) {
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
        state.sameOnly ||
        state.showCompared ||
        state.evals ||
        state.teacherless ||
        (state.search && state.search.trim().length > 0),
      );

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
      var pLabel = classLabels[currentClassId] || currentClassId.toUpperCase();
      var cLabel =
        classLabels[state.compare] ||
        (state.compare ? state.compare.toUpperCase() : "");

      var effSameOnly = state.compare ? state.sameOnly : false;
      var effShowCompared = state.compare ? state.showCompared : false;

      if (state.view === "year") {
        var yearCount = renderYearView(
          primaryEvents,
          compareEvents,
          searchNorm,
          dayNames,
          monthNames,
          pLabel,
          cLabel,
          effSameOnly,
          effShowCompared,
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

      var dayRenderData = [];
      var totalWeekItems = 0;

      viewContainer.style.setProperty(
        "--calendar-day-count",
        daysToRender.length,
      );
      var primaryByDate = indexByDate(primaryEvents);
      var comparedByDate = indexByDate(compareEvents);
      daysToRender.forEach(function (date) {
        var data = prepareDay(
          date,
          primaryByDate,
          comparedByDate,
          searchNorm,
          effSameOnly,
          effShowCompared,
        );
        totalWeekItems += data.dayCount;
        dayRenderData.push(data);
      });

      if (state.view === "week" && totalWeekItems === 0) {
        var emptyWeekP = document.createElement("p");
        emptyWeekP.className = "empty-state-message";
        emptyWeekP.textContent = labels.no_courses_week;
        viewContainer.appendChild(emptyWeekP);
        updateResultsCount(0);
        return;
      }

      dayRenderData.forEach(function (dayData) {
        var daySection = buildDaySection(
          dayData,
          dayNames,
          monthNames,
          pLabel,
          cLabel,
          effShowCompared,
          state.view === "week",
        );
        viewContainer.appendChild(daySection);
      });

      updateResultsCount(totalWeekItems);
    }

    function buildDaySection(
      dayData,
      dayNames,
      monthNames,
      pLabel,
      cLabel,
      effShowCompared,
      includeHeading,
    ) {
      var dDate = dayData.dDate;
      var dIso = dayData.dIso;
      var pEvents = dayData.pEvents;
      var cEvents = dayData.cEvents;
      var pItems = dayData.pItems;
      var cItems = dayData.cItems;

      var daySection = document.createElement("section");
      daySection.className = "day-section";
      daySection.setAttribute("id", "day-section-" + dIso);
      var isoDay = dDate.getDay() === 0 ? 7 : dDate.getDay();
      daySection.setAttribute("data-day", String(isoDay));

      if (includeHeading) {
        var dayIdx = (dDate.getDay() + 6) % 7;
        var heading = document.createElement("h3");
        heading.textContent = AppUtils.formatText(labels.day_title, {
          day_name: dayNames[dayIdx],
          day_num: dDate.getDate(),
          month_name: monthNames[dDate.getMonth()],
          year: dDate.getFullYear(),
        });
        daySection.appendChild(heading);
      }

      if (state.compare) {
        var noCoursesStr = labels.no_courses_compared;

        var pSummary = "";
        var pMinStartStr = null,
          pMaxEndStr = null;
        if (pEvents.length > 0) {
          pMinStartStr = pEvents[0].start.substring(11, 16);
          pMaxEndStr = pEvents[0].end.substring(11, 16);
          pEvents.forEach(function (ev) {
            var s = ev.start.substring(11, 16);
            var e = ev.end.substring(11, 16);
            if (s < pMinStartStr) pMinStartStr = s;
            if (e > pMaxEndStr) pMaxEndStr = e;
          });
          pSummary = pLabel + " : " + pMinStartStr + " - " + pMaxEndStr;
        } else {
          pSummary = pLabel + " : " + noCoursesStr;
        }

        var cSummary = "";
        var cMinStartStr = null,
          cMaxEndStr = null;
        if (cEvents.length > 0) {
          cMinStartStr = cEvents[0].start.substring(11, 16);
          cMaxEndStr = cEvents[0].end.substring(11, 16);
          cEvents.forEach(function (ev) {
            var s = ev.start.substring(11, 16);
            var e = ev.end.substring(11, 16);
            if (s < cMinStartStr) cMinStartStr = s;
            if (e > cMaxEndStr) cMaxEndStr = e;
          });
          cSummary = cLabel + " : " + cMinStartStr + " - " + cMaxEndStr;
        } else {
          cSummary = cLabel + " : " + noCoursesStr;
        }

        var summaryDiv = document.createElement("div");
        summaryDiv.className = "cal-day-summary";

        var line1 = document.createElement("div");
        line1.className = "cal-summary-primary";
        line1.textContent = pSummary;
        summaryDiv.appendChild(line1);

        var line2 = document.createElement("div");
        line2.className = "cal-summary-compared";
        line2.textContent = cSummary;
        summaryDiv.appendChild(line2);
        daySection.appendChild(summaryDiv);
      }

      var pBounds = dayData.pBounds;

      if (state.compare && effShowCompared) {
        var pHeading = document.createElement("h4");
        pHeading.className = "cal-class-subheading";
        pHeading.textContent = pLabel;
        daySection.appendChild(pHeading);

        if (pItems.length > 0) {
          var ulP = document.createElement("ul");
          ulP.className = "calendar-events-list";
          pItems.forEach(function (item) {
            var li = renderEventItem(item, cLabel, pBounds);
            ulP.appendChild(li);
          });
          daySection.appendChild(ulP);
        } else {
          var noCoursesP = document.createElement("p");
          noCoursesP.className = "empty-state-message";
          noCoursesP.textContent = labels.no_courses;
          daySection.appendChild(noCoursesP);
        }

        var cHeading = document.createElement("h4");
        cHeading.className = "cal-class-subheading";
        cHeading.textContent = cLabel;
        daySection.appendChild(cHeading);

        if (cItems.length > 0) {
          var ulC = document.createElement("ul");
          ulC.className = "calendar-events-list";
          cItems.forEach(function (item) {
            var li = renderEventItem(item, cLabel, null);
            ulC.appendChild(li);
          });
          daySection.appendChild(ulC);
        } else {
          var noCoursesC = document.createElement("p");
          noCoursesC.className = "empty-state-message";
          noCoursesC.textContent = labels.no_courses;
          daySection.appendChild(noCoursesC);
        }
      } else {
        if (pItems.length === 0) {
          if (!state.compare) {
            var noCoursesP = document.createElement("p");
            noCoursesP.className = "empty-state-message";
            noCoursesP.textContent = labels.no_courses;
            daySection.appendChild(noCoursesP);
          }
        } else {
          var ul = document.createElement("ul");
          ul.className = "calendar-events-list";
          pItems.forEach(function (item) {
            var li = renderEventItem(item, cLabel, pBounds);
            ul.appendChild(li);
          });
          daySection.appendChild(ul);
        }
      }

      return daySection;
    }

    function renderYearView(
      primaryEvents,
      compareEvents,
      searchNorm,
      dayNames,
      monthNames,
      pLabel,
      cLabel,
      effSameOnly,
      effShowCompared,
    ) {
      var frag = document.createDocumentFragment();
      var totalYearItems = 0;
      var hasFilter = Boolean(
        effSameOnly ||
        state.evals ||
        state.teacherless ||
        (searchNorm && searchNorm.length > 0),
      );

      var eventsByDateP = indexByDate(primaryEvents);
      var eventsByDateC = indexByDate(compareEvents);

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
            var data = prepareDay(
              date,
              eventsByDateP,
              eventsByDateC,
              searchNorm,
              effSameOnly,
              effShowCompared,
            );
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
                pLabel,
                cLabel,
                effShowCompared,
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
              monthFrag.appendChild(emptyWeekP);
            } else {
              weekDataList.forEach(function (dayData) {
                var daySection = buildDaySection(
                  dayData,
                  dayNames,
                  monthNames,
                  pLabel,
                  cLabel,
                  effShowCompared,
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

    function getDayBounds(items) {
      if (!items || items.length === 0) return { minStart: null, maxEnd: null };
      var minStart = items[0].event.start.substring(11, 16);
      var maxEnd = items[0].event.end.substring(11, 16);
      for (var i = 1; i < items.length; i++) {
        var s = items[i].event.start.substring(11, 16);
        var e = items[i].event.end.substring(11, 16);
        if (s < minStart) minStart = s;
        if (e > maxEnd) maxEnd = e;
      }
      return { minStart: minStart, maxEnd: maxEnd };
    }

    function renderEventItem(item, cLabel, bounds) {
      var ev = item.event;
      var li = document.createElement("li");
      li.className = "calendar-event-item";

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

      if (ev.category && categoryMap[ev.category]) {
        var cat = categoryMap[ev.category];
        var catSpan = document.createElement("span");
        catSpan.className = "category-badge cat-" + cat.id;
        catSpan.textContent = cat.label;
        titleDiv.appendChild(catSpan);
        titleDiv.appendChild(document.createTextNode(" "));
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

      var referenceLabel = item.isPrimary
        ? classLabels[currentClassId] || currentClassId
        : cLabel;
      var referenceId = item.isPrimary ? currentClassId : "";
      var otherGroups = [];
      if (ev.groups && ev.groups.length > 0) {
        var refLabelLower = (referenceLabel || "").toLowerCase();
        var refIdLower = (referenceId || "").toLowerCase();
        otherGroups = ev.groups.filter(function (g) {
          var gLower = g.toLowerCase();
          return (
            gLower !== refLabelLower && (!refIdLower || gLower !== refIdLower)
          );
        });
      }

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

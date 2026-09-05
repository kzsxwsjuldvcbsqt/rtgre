(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var scriptEl = document.querySelector('script[data-class-id]');
    if (!scriptEl) return;

    var currentClassId = scriptEl.getAttribute('data-class-id');
    var firstDateStr = scriptEl.getAttribute('data-first-date');
    var lastDateStr = scriptEl.getAttribute('data-last-date');
    var schoolYearLabel = (scriptEl.getAttribute('data-school-year-label') || '').replace(/^IUT1\s+Grenoble\s*/i, '');
    var displayMode = scriptEl.getAttribute('data-display-mode') || 'short';

    var categoriesJson = JSON.parse(scriptEl.getAttribute('data-categories-json') || '[]');
    var categoryMap = {};
    categoriesJson.forEach(function (c) {
      categoryMap[c.id] = c;
    });

    var labels = JSON.parse(scriptEl.getAttribute('data-labels-json') || '{}');
    var classLabels = JSON.parse(scriptEl.getAttribute('data-class-labels-json') || '{}');

    var configuredClassCodes = Object.keys(classLabels);
    var allClassesLabel = labels.groups_all || "Toutes les classes";

    function formatDisplayGroups(groupsList) {
      if (!groupsList || groupsList.length === 0) return [];
      var groupsSet = {};
      groupsList.forEach(function (g) { groupsSet[g] = true; });

      var allPresent = configuredClassCodes.length > 0 && configuredClassCodes.every(function (code) {
        return groupsSet[code];
      });

      if (allPresent) {
        var remaining = groupsList.filter(function (g) {
          return configuredClassCodes.indexOf(g) === -1;
        });
        return [allClassesLabel].concat(remaining);
      }
      return groupsList;
    }

    var controlsEl = document.getElementById('calendar-controls');
    var navBarEl = document.getElementById('calendar-nav-bar');
    var savedControlsState = AppUtils.safeStorageGet('heading_toggle_calendar-controls');
    if (controlsEl && savedControlsState !== 'collapsed') controlsEl.hidden = false;
    if (navBarEl) navBarEl.hidden = false;

    var initialEventsScript = document.getElementById('class-events-data');
    var currentClassEvents = [];
    if (initialEventsScript) {
      try {
        var rawEventsData = JSON.parse(initialEventsScript.textContent);
        currentClassEvents = rawEventsData.events || [];
      } catch (e) { }
    }

    var comparisonCache = {};

    var viewSelect = document.getElementById('cal-view-select');
    var dateInput = document.getElementById('cal-date-input');
    var dateGroup = document.getElementById('cal-date-input-group');

    var compareSelect = document.getElementById('cal-compare-select');
    var compCheckboxes = document.getElementById('cal-comp-checkboxes');
    var evalsOnlyCb = document.getElementById('cal-evals-only');
    var teacherlessCb = document.getElementById('cal-teacherless-only');
    var searchInput = document.getElementById('cal-search-input');
    var resetBtn = document.getElementById('cal-reset-btn');

    var prevBtn = document.getElementById('cal-prev-btn');
    var todayBtn = document.getElementById('cal-today-btn');
    var nextBtn = document.getElementById('cal-next-btn');
    var periodHeading = document.getElementById('cal-period-heading');
    var messageEl = document.getElementById('calendar-message');
    var viewContainer = document.getElementById('calendar-view-container');

    var searchTimeout = null;
    var timeMarkerTimer = null;
    var lastWrittenHash = '';

    function parseISODate(str) {
      var parts = str.split('-');
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }

    function formatISODate(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }

    function toWeekday(d, direction) {
      var date = new Date(d.getTime());
      var dir = direction >= 0 ? 1 : -1;
      while (date.getDay() === 0 || date.getDay() === 6) {
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
    var defaultDateStr = formatISODate(minDate);

    var state = {
      view: 'week',
      date: defaultDateStr,
      compare: '',
      sameOnly: false,
      showCompared: false,
      evals: false,
      teacherless: false,
      search: ''
    };

    var dayNames = labels.days || ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    var monthNames = labels.months || ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

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
      return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    }

    function stopTimeMarkerTimer() {
      if (timeMarkerTimer) {
        clearInterval(timeMarkerTimer);
        timeMarkerTimer = null;
      }
    }

    function getNowDate() {
      var hashObj = AppUtils.parseHash(window.location.hash);
      if (hashObj.now) {
        var d = new Date(hashObj.now);
        if (!isNaN(d.getTime())) {
          return { date: d, isSimulated: true };
        }
      }
      return { date: new Date(), isSimulated: false };
    }

    function updateTimeMarker() {
      var existingMarker = document.getElementById('current-time-marker');
      if (existingMarker) existingMarker.remove();

      var ongoingBadges = document.querySelectorAll('.ongoing-badge');
      ongoingBadges.forEach(function (b) { b.remove(); });

      var nowInfo = getNowDate();
      var now = nowInfo.date;
      var todayIso = formatISODate(now);

      var todaySection = document.getElementById('day-section-' + todayIso);
      if (!todaySection) {
        stopTimeMarkerTimer();
        return;
      }

      var eventsList = todaySection.querySelector('.calendar-events-list');
      if (!eventsList) {
        stopTimeMarkerTimer();
        return;
      }

      var eventItems = Array.from(eventsList.querySelectorAll('.calendar-event-item'));
      if (eventItems.length === 0) {
        stopTimeMarkerTimer();
        return;
      }

      var nowHours = String(now.getHours()).padStart(2, '0');
      var nowMins = String(now.getMinutes()).padStart(2, '0');
      var nowTimeStr = nowHours + ':' + nowMins;

      var markerEl = document.createElement('li');
      markerEl.id = 'current-time-marker';
      markerEl.className = 'current-time-marker';

      var timeSpan = document.createElement('span');
      timeSpan.className = 'current-time-text';
      timeSpan.textContent = nowTimeStr;
      markerEl.appendChild(timeSpan);

      var lineEl = document.createElement('hr');
      lineEl.className = 'current-time-line';
      markerEl.appendChild(lineEl);

      var inserted = false;

      for (var i = 0; i < eventItems.length; i++) {
        var item = eventItems[i];
        var startStr = item.getAttribute('data-start');
        var endStr = item.getAttribute('data-end');
        if (!startStr || !endStr) continue;

        if (nowTimeStr >= startStr && nowTimeStr < endStr) {
          var titleDiv = item.querySelector('.event-title');
          if (titleDiv) {
            var ongBadge = document.createElement('span');
            ongBadge.className = 'ongoing-badge';
            var ongoingLabel = labels.status_ongoing || '[En cours]';
            ongBadge.textContent = ' ' + ongoingLabel;
            titleDiv.appendChild(ongBadge);
          }
          eventsList.insertBefore(markerEl, item);
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
        timeMarkerTimer = setInterval(updateTimeMarker, 60000);
      }
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        updateTimeMarker();
      }
    });

    function loadState() {
      var hashObj = AppUtils.parseHash(window.location.hash);
      var storedStr = AppUtils.safeStorageGet('calendar_settings', true);
      var storedObj = {};
      if (storedStr) {
        try { storedObj = JSON.parse(storedStr); } catch (e) { }
      }

      var merged = Object.assign({}, storedObj, hashObj);

      if (merged.view && (merged.view === 'week' || merged.view === 'day' || merged.view === 'year')) {
        state.view = merged.view;
      }

      if (hashObj.now && !hashObj.date) {
        var nowSim = new Date(hashObj.now);
        if (!isNaN(nowSim.getTime())) {
          state.date = formatISODate(toWeekday(nowSim, 1));
        }
      } else if (merged.date && /^\d{4}-\d{2}-\d{2}$/.test(merged.date)) {
        state.date = formatISODate(toWeekday(parseISODate(merged.date), 1));
      } else {
        state.date = defaultDateStr;
      }

      if (merged.compare !== undefined) state.compare = merged.compare;
      if (merged.sameOnly !== undefined) state.sameOnly = merged.sameOnly === '1' || merged.sameOnly === true;
      if (merged.showCompared !== undefined) state.showCompared = merged.showCompared === '1' || merged.showCompared === true;
      if (merged.evals !== undefined) state.evals = merged.evals === '1' || merged.evals === true;
      if (merged.teacherless !== undefined) state.teacherless = merged.teacherless === '1' || merged.teacherless === true;
      if (merged.search !== undefined) state.search = merged.search;

      if (!state.compare) {
        state.sameOnly = false;
        state.showCompared = false;
      }

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
        sameOnly: (state.compare && state.sameOnly) ? '1' : '0',
        showCompared: (state.compare && state.showCompared) ? '1' : '0',
        evals: state.evals ? '1' : '0',
        teacherless: state.teacherless ? '1' : '0',
        search: state.search
      };
      if (hashObj.now) {
        saveObj.now = hashObj.now;
      }

      AppUtils.safeStorageSet('calendar_settings', JSON.stringify(saveObj), true);

      var newHash = AppUtils.buildHash(saveObj);
      lastWrittenHash = newHash;
      if (window.location.hash !== newHash) {
        if (history.replaceState) {
          history.replaceState(null, '', newHash || window.location.pathname);
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

      var isYear = state.view === 'year';
      if (prevBtn) prevBtn.hidden = isYear;
      if (nextBtn) nextBtn.hidden = isYear;
      if (todayBtn) todayBtn.hidden = false;
      if (dateGroup) dateGroup.hidden = isYear;
      else if (dateInput) dateInput.hidden = isYear;
      var navBar = document.getElementById('calendar-nav-bar');
      if (navBar) navBar.hidden = false;

      if (compCheckboxes) {
        while (compCheckboxes.firstChild) {
          compCheckboxes.removeChild(compCheckboxes.firstChild);
        }
        if (state.compare) {
          var sameLabel = document.createElement('label');
          sameLabel.setAttribute('for', 'cal-same-only');
          var sameCb = document.createElement('input');
          sameCb.type = 'checkbox';
          sameCb.id = 'cal-same-only';
          sameCb.checked = state.sameOnly;
          sameCb.addEventListener('change', function () {
            state.sameOnly = sameCb.checked;
            render();
          });
          sameLabel.appendChild(sameCb);
          sameLabel.appendChild(document.createTextNode(' ' + (labels.same_only || 'Cours communs uniquement')));

          var showLabel = document.createElement('label');
          showLabel.setAttribute('for', 'cal-show-compared');
          var showCb = document.createElement('input');
          showCb.type = 'checkbox';
          showCb.id = 'cal-show-compared';
          showCb.checked = state.showCompared;
          showCb.addEventListener('change', function () {
            state.showCompared = showCb.checked;
            render();
          });
          showLabel.appendChild(showCb);
          showLabel.appendChild(document.createTextNode(' ' + (labels.show_compared || 'Afficher aussi les cours de l\'autre classe')));

          compCheckboxes.appendChild(sameLabel);
          compCheckboxes.appendChild(showLabel);
        }
      }
    }

    function fetchComparisonClass(classId, callback) {
      if (!classId) {
        callback(null, []);
        return;
      }
      if (comparisonCache[classId]) {
        callback(null, comparisonCache[classId]);
        return;
      }

      fetch('../../data/' + classId + '.json')
        .then(function (res) {
          if (!res.ok) throw new Error('Fetch error');
          return res.json();
        })
        .then(function (data) {
          var evs = data.events || [];
          comparisonCache[classId] = evs;
          callback(null, evs);
        })
        .catch(function (err) {
          callback(err, []);
        });
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
          var targetStr = AppUtils.stripAccents([
            ev.title,
            ev.module,
            (ev.rooms || []).join(' '),
            (ev.teachers || []).join(' '),
            (ev.staff_markers || []).join(' '),
            (ev.groups || []).join(' ')
          ].join(' ')).toLowerCase();

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

      if (state.compare) {
        fetchComparisonClass(state.compare, function (err, compareEvents) {
          if (err) {
            if (messageEl) {
              messageEl.textContent = labels.load_error;
              messageEl.hidden = false;
            }
          } else {
            if (messageEl) messageEl.hidden = true;
          }
          renderCalendarView(currentClassEvents, compareEvents);
          updateTimeMarker();
        });
      } else {
        if (messageEl) messageEl.hidden = true;
        renderCalendarView(currentClassEvents, []);
        updateTimeMarker();
      }
    }

    function renderCalendarView(primaryEvents, compareEvents) {
      var currDate = parseISODate(state.date);

      if (state.view !== 'year') {
        if (prevBtn) {
          var prevTest;
          if (state.view === 'week') {
            prevTest = new Date(currDate.getTime());
            prevTest.setDate(prevTest.getDate() - 7);
          } else {
            prevTest = getPrevWeekday(currDate);
          }
          prevBtn.disabled = prevTest < minDate;
        }

        if (nextBtn) {
          var nextTest;
          if (state.view === 'week') {
            nextTest = new Date(currDate.getTime());
            nextTest.setDate(nextTest.getDate() + 7);
          } else {
            nextTest = getNextWeekday(currDate);
          }
          nextBtn.disabled = nextTest > maxDate;
        }
      }

      if (state.view === 'year') {
        if (periodHeading) {
          periodHeading.textContent = schoolYearLabel || ("Année " + minDate.getFullYear() + "-" + maxDate.getFullYear());
        }
      } else if (state.view === 'week') {
        var wStart = getWeekStart(currDate);
        var wEnd = new Date(wStart.getTime());
        wEnd.setDate(wEnd.getDate() + 4);
        var wNum = getISOWeekNumber(wStart);

        if (periodHeading) {
          periodHeading.textContent = (labels.week_prefix || "Semaine") + " " + wNum + " : " +
            wStart.getDate() + " " + monthNames[wStart.getMonth()] + " - " +
            wEnd.getDate() + " " + monthNames[wEnd.getMonth()] + " " + wEnd.getFullYear();
        }
      } else {
        if (periodHeading) {
          var dayIdx = (currDate.getDay() + 6) % 7;
          periodHeading.textContent = dayNames[dayIdx] + " " + currDate.getDate() + " " + monthNames[currDate.getMonth()] + " " + currDate.getFullYear();
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
        (state.search && state.search.trim().length > 0)
      );

      viewContainer.className = 'calendar-view-container calendar-view-' + state.view + (isFiltered ? ' is-filtered' : '');

      function updateResultsCount(count) {
        var resultsCountEl = document.getElementById('cal-results-count');
        if (resultsCountEl) {
          var countSingular = labels.results_count_singular || 'cours';
          var countPlural = labels.results_count_plural || 'cours';
          var countLabel = count < 2 ? countSingular : countPlural;
          resultsCountEl.textContent = count + ' ' + countLabel;
        }
      }

      var searchNorm = AppUtils.stripAccents(state.search).toLowerCase();
      var pLabel = classLabels[currentClassId] || currentClassId.toUpperCase();
      var cLabel = classLabels[state.compare] || (state.compare ? state.compare.toUpperCase() : '');

      var effSameOnly = state.compare ? state.sameOnly : false;
      var effShowCompared = state.compare ? state.showCompared : false;

      if (state.view === 'year') {
        var yearCount = renderYearView(primaryEvents, compareEvents, searchNorm, dayNames, monthNames, pLabel, cLabel, effSameOnly, effShowCompared);
        updateResultsCount(yearCount);
        return;
      }

      var daysToRender = [];
      if (state.view === 'week') {
        var start = getWeekStart(currDate);
        for (var i = 0; i < 5; i++) {
          var d = new Date(start.getTime());
          d.setDate(d.getDate() + i);
          daysToRender.push(d);
        }
      } else {
        daysToRender.push(currDate);
      }

      var dayRenderData = [];
      var totalWeekItems = 0;

      daysToRender.forEach(function (dDate) {
        var dIso = formatISODate(dDate);

        var rawPEvents = primaryEvents.filter(function (ev) {
          return ev.start.substring(0, 10) === dIso;
        });

        var rawCEvents = compareEvents.filter(function (ev) {
          return ev.start.substring(0, 10) === dIso;
        });

        var pEvents = filterEvents(rawPEvents, searchNorm);
        var cEvents = state.compare ? filterEvents(rawCEvents, searchNorm) : [];

        var sharedMap = {};
        if (state.compare) {
          pEvents.forEach(function (pEv, pIdx) {
            for (var ci = 0; ci < cEvents.length; ci++) {
              var cEv = cEvents[ci];
              if (pEv.slug === cEv.slug && pEv.start === cEv.start && pEv.end === cEv.end) {
                sharedMap[pIdx] = true;
                break;
              }
            }
          });
        }

        var pItems = [];
        pEvents.forEach(function (pEv, pIdx) {
          var isShared = !!sharedMap[pIdx];
          if (effSameOnly && !isShared) {
            return;
          }
          pItems.push({
            event: pEv,
            isPrimary: true,
            isShared: isShared
          });
        });
        pItems.sort(function (a, b) {
          return a.event.start.localeCompare(b.event.start);
        });

        var cItems = [];
        if (state.compare && effShowCompared) {
          cEvents.forEach(function (cEv) {
            cItems.push({
              event: cEv,
              isPrimary: false,
              isShared: false
            });
          });
          cItems.sort(function (a, b) {
            return a.event.start.localeCompare(b.event.start);
          });
        }

        totalWeekItems += pItems.length + cItems.length;

        dayRenderData.push({
          dDate: dDate,
          dIso: dIso,
          pEvents: pEvents,
          cEvents: cEvents,
          pItems: pItems,
          cItems: cItems
        });
      });

      if (state.view === 'week' && totalWeekItems === 0) {
        var emptyWeekP = document.createElement('p');
        emptyWeekP.className = 'empty-state-message';
        emptyWeekP.textContent = labels.no_courses_week || 'Aucun cours cette semaine.';
        viewContainer.appendChild(emptyWeekP);
        updateResultsCount(0);
        return;
      }

      dayRenderData.forEach(function (dayData) {
        var daySection = buildDaySection(dayData, dayNames, monthNames, pLabel, cLabel, effShowCompared, state.view === 'week');
        viewContainer.appendChild(daySection);
      });

      updateResultsCount(totalWeekItems);
    }

    function buildDaySection(dayData, dayNames, monthNames, pLabel, cLabel, effShowCompared, includeHeading) {
      var dDate = dayData.dDate;
      var dIso = dayData.dIso;
      var pEvents = dayData.pEvents;
      var cEvents = dayData.cEvents;
      var pItems = dayData.pItems;
      var cItems = dayData.cItems;

      var daySection = document.createElement('section');
      daySection.className = 'day-section';
      daySection.setAttribute('id', 'day-section-' + dIso);
      var isoDay = dDate.getDay() === 0 ? 7 : dDate.getDay();
      daySection.setAttribute('data-day', String(isoDay));

      if (includeHeading) {
        var dayIdx = (dDate.getDay() + 6) % 7;
        var heading = document.createElement('h3');
        heading.textContent = dayNames[dayIdx] + ' ' + dDate.getDate() + ' ' + monthNames[dDate.getMonth()] + ' ' + dDate.getFullYear();
        daySection.appendChild(heading);
      }

      if (state.compare) {
        var noCoursesStr = labels.no_courses_compared || 'Aucun cours ce jour-là';

        var pSummary = '';
        var pMinStartStr = null, pMaxEndStr = null;
        if (pEvents.length > 0) {
          pMinStartStr = pEvents[0].start.substring(11, 16);
          pMaxEndStr = pEvents[0].end.substring(11, 16);
          pEvents.forEach(function (ev) {
            var s = ev.start.substring(11, 16);
            var e = ev.end.substring(11, 16);
            if (s < pMinStartStr) pMinStartStr = s;
            if (e > pMaxEndStr) pMaxEndStr = e;
          });
          pSummary = pLabel + ' : ' + pMinStartStr + ' - ' + pMaxEndStr;
        } else {
          pSummary = pLabel + ' : ' + noCoursesStr;
        }

        var cSummary = '';
        var cMinStartStr = null, cMaxEndStr = null;
        if (cEvents.length > 0) {
          cMinStartStr = cEvents[0].start.substring(11, 16);
          cMaxEndStr = cEvents[0].end.substring(11, 16);
          cEvents.forEach(function (ev) {
            var s = ev.start.substring(11, 16);
            var e = ev.end.substring(11, 16);
            if (s < cMinStartStr) cMinStartStr = s;
            if (e > cMaxEndStr) cMaxEndStr = e;
          });
          cSummary = cLabel + ' : ' + cMinStartStr + ' - ' + cMaxEndStr;
        } else {
          cSummary = cLabel + ' : ' + noCoursesStr;
        }

        var summaryDiv = document.createElement('div');
        summaryDiv.className = 'cal-day-summary';

        var line1 = document.createElement('div');
        line1.className = 'cal-summary-primary';
        line1.textContent = pSummary;
        summaryDiv.appendChild(line1);

        var line2 = document.createElement('div');
        line2.className = 'cal-summary-compared';
        line2.textContent = cSummary;
        summaryDiv.appendChild(line2);
        daySection.appendChild(summaryDiv);
      }

      var pBounds = getDayBounds(pItems);

      if (state.compare && effShowCompared) {
        var pHeading = document.createElement('h4');
        pHeading.className = 'cal-class-subheading';
        pHeading.textContent = pLabel;
        daySection.appendChild(pHeading);

        if (pItems.length > 0) {
          var ulP = document.createElement('ul');
          ulP.className = 'calendar-events-list';
          pItems.forEach(function (item) {
            var li = renderEventItem(item, cLabel, pBounds);
            ulP.appendChild(li);
          });
          daySection.appendChild(ulP);
        } else {
          var noCoursesP = document.createElement('p');
          noCoursesP.className = 'empty-state-message';
          noCoursesP.textContent = labels.no_courses;
          daySection.appendChild(noCoursesP);
        }

        var cHeading = document.createElement('h4');
        cHeading.className = 'cal-class-subheading';
        cHeading.textContent = cLabel;
        daySection.appendChild(cHeading);

        if (cItems.length > 0) {
          var ulC = document.createElement('ul');
          ulC.className = 'calendar-events-list';
          cItems.forEach(function (item) {
            var li = renderEventItem(item, cLabel, null);
            ulC.appendChild(li);
          });
          daySection.appendChild(ulC);
        } else {
          var noCoursesC = document.createElement('p');
          noCoursesC.className = 'empty-state-message';
          noCoursesC.textContent = labels.no_courses;
          daySection.appendChild(noCoursesC);
        }
      } else {
        if (pItems.length === 0) {
          if (!state.compare) {
            var noCoursesP = document.createElement('p');
            noCoursesP.className = 'empty-state-message';
            noCoursesP.textContent = labels.no_courses;
            daySection.appendChild(noCoursesP);
          }
        } else {
          var ul = document.createElement('ul');
          ul.className = 'calendar-events-list';
          pItems.forEach(function (item) {
            var li = renderEventItem(item, cLabel, pBounds);
            ul.appendChild(li);
          });
          daySection.appendChild(ul);
        }
      }

      return daySection;
    }

    function renderYearView(primaryEvents, compareEvents, searchNorm, dayNames, monthNames, pLabel, cLabel, effSameOnly, effShowCompared) {
      var frag = document.createDocumentFragment();
      var totalYearItems = 0;
      var hasFilter = Boolean(effSameOnly || state.evals || state.teacherless || (searchNorm && searchNorm.length > 0));

      var eventsByDateP = {};
      primaryEvents.forEach(function (ev) {
        var iso = ev.start.substring(0, 10);
        if (!eventsByDateP[iso]) eventsByDateP[iso] = [];
        eventsByDateP[iso].push(ev);
      });

      var eventsByDateC = {};
      compareEvents.forEach(function (ev) {
        var iso = ev.start.substring(0, 10);
        if (!eventsByDateC[iso]) eventsByDateC[iso] = [];
        eventsByDateC[iso].push(ev);
      });

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
        monthNameCap = monthNameCap.charAt(0).toUpperCase() + monthNameCap.slice(1);
        var monthHeadingText = monthNameCap + ' ' + mYear;

        var monthFrag = document.createDocumentFragment();

        var weeksInMonth = {};
        var weekOrder = [];
        for (var day = 1; day <= daysInMonth; day++) {
          var d = new Date(mYear, mMonth, day);
          var dayOfWeek = d.getDay();
          if (dayOfWeek === 0 || dayOfWeek === 6) continue;
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

          weekDays.forEach(function (dDate) {
            var dIso = formatISODate(dDate);
            var rawPEvents = eventsByDateP[dIso] || [];
            var rawCEvents = eventsByDateC[dIso] || [];

            var pEvents = filterEvents(rawPEvents, searchNorm);
            var cEvents = state.compare ? filterEvents(rawCEvents, searchNorm) : [];

            var sharedMap = {};
            if (state.compare) {
              pEvents.forEach(function (pEv, pIdx) {
                for (var ci = 0; ci < cEvents.length; ci++) {
                  var cEv = cEvents[ci];
                  if (pEv.slug === cEv.slug && pEv.start === cEv.start && pEv.end === cEv.end) {
                    sharedMap[pIdx] = true;
                    break;
                  }
                }
              });
            }

            var pItems = [];
            pEvents.forEach(function (pEv, pIdx) {
              var isShared = !!sharedMap[pIdx];
              if (effSameOnly && !isShared) return;
              pItems.push({
                event: pEv,
                isPrimary: true,
                isShared: isShared
              });
            });
            pItems.sort(function (a, b) {
              return a.event.start.localeCompare(b.event.start);
            });

            var cItems = [];
            if (state.compare && effShowCompared) {
              cEvents.forEach(function (cEv) {
                cItems.push({
                  event: cEv,
                  isPrimary: false,
                  isShared: false
                });
              });
              cItems.sort(function (a, b) {
                return a.event.start.localeCompare(b.event.start);
              });
            }

            var dayCount = pItems.length + cItems.length;
            weekItemCount += dayCount;

            weekDataList.push({
              dDate: dDate,
              dIso: dIso,
              pEvents: pEvents,
              cEvents: cEvents,
              pItems: pItems,
              cItems: cItems,
              dayCount: dayCount
            });
          });

          totalYearItems += weekItemCount;

          if (hasFilter) {
            weekDataList.forEach(function (dayData) {
              if (dayData.dayCount === 0) return;
              var daySection = buildDaySection(dayData, dayNames, monthNames, pLabel, cLabel, effShowCompared, true);
              monthFrag.appendChild(daySection);
            });
          } else {
            if (weekItemCount === 0) {
              var wNum = getISOWeekNumber(weekDays[0]);
              var emptyWeekP = document.createElement('p');
              emptyWeekP.className = 'empty-state-message';
              emptyWeekP.textContent = (labels.week_prefix || 'Semaine') + ' ' + wNum + ' : ' + (labels.no_courses_week || 'Aucun cours cette semaine.');
              monthFrag.appendChild(emptyWeekP);
            } else {
              weekDataList.forEach(function (dayData) {
                var daySection = buildDaySection(dayData, dayNames, monthNames, pLabel, cLabel, effShowCompared, true);
                monthFrag.appendChild(daySection);
              });
            }
          }
        });

        if (monthFrag.hasChildNodes()) {
          var mTitle = document.createElement('h2');
          mTitle.className = 'year-month-title';
          mTitle.textContent = monthHeadingText;
          frag.appendChild(mTitle);
          frag.appendChild(monthFrag);
        }
      });

      if (hasFilter && totalYearItems === 0) {
        var emptyP = document.createElement('p');
        emptyP.className = 'empty-state-message';
        emptyP.textContent = labels.no_courses || 'Aucun cours ce jour-là.';
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
      var li = document.createElement('li');
      li.className = 'calendar-event-item';

      var startTime = ev.start.substring(11, 16);
      var endTime = ev.end.substring(11, 16);
      var sep = labels.list_separator || ', ';

      li.setAttribute('data-start', startTime);
      li.setAttribute('data-end', endTime);

      var isDayStart = Boolean(bounds && bounds.minStart && startTime === bounds.minStart);
      var isDayEnd = Boolean(bounds && bounds.maxEnd && endTime === bounds.maxEnd);

      var timeDiv = document.createElement('div');
      timeDiv.className = 'event-time';
      var startSpan = document.createElement('span');
      startSpan.className = 'event-time-start' + (isDayStart ? ' is-day-start' : '');
      startSpan.textContent = startTime;
      var endSpan = document.createElement('span');
      endSpan.className = 'event-time-end' + (isDayEnd ? ' is-day-end' : '');
      endSpan.textContent = endTime;
      timeDiv.appendChild(startSpan);
      timeDiv.appendChild(document.createTextNode(' - '));
      timeDiv.appendChild(endSpan);
      li.appendChild(timeDiv);

      var infoDiv = document.createElement('div');
      infoDiv.className = 'event-info';

      var titleDiv = document.createElement('div');
      titleDiv.className = 'event-title';
      titleDiv.appendChild(document.createTextNode(ev.title + ' '));

      if (ev.category && categoryMap[ev.category]) {
        var cat = categoryMap[ev.category];
        var catSpan = document.createElement('span');
        catSpan.className = 'category-badge cat-' + cat.id;
        catSpan.textContent = cat.label;
        titleDiv.appendChild(catSpan);
        titleDiv.appendChild(document.createTextNode(' '));
      }

      infoDiv.appendChild(titleDiv);

      var teachersToDisplay = [];
      if (displayMode !== 'hidden' && ev.teachers && ev.teachers.length > 0) {
        teachersToDisplay = ev.teachers;
      } else if (ev.staff_markers && ev.staff_markers.length > 0) {
        teachersToDisplay = ev.staff_markers;
      }

      if (teachersToDisplay.length > 0) {
        var teachersDiv = document.createElement('div');
        teachersDiv.className = 'event-teachers';
        teachersToDisplay.forEach(function (t, idx) {
          var tagSpan = document.createElement('span');
          tagSpan.className = 'room-tag';
          tagSpan.textContent = t;
          teachersDiv.appendChild(tagSpan);
          if (idx < teachersToDisplay.length - 1) {
            teachersDiv.appendChild(document.createTextNode(sep));
          }
        });
        infoDiv.appendChild(teachersDiv);
      }

      if (ev.rooms && ev.rooms.length > 0) {
        var roomsDiv = document.createElement('div');
        roomsDiv.className = 'event-rooms';
        ev.rooms.forEach(function (r, idx) {
          var tagSpan = document.createElement('span');
          tagSpan.className = 'room-tag';
          tagSpan.textContent = r;
          roomsDiv.appendChild(tagSpan);
          if (idx < ev.rooms.length - 1) {
            roomsDiv.appendChild(document.createTextNode(sep));
          }
        });
        infoDiv.appendChild(roomsDiv);
      }

      var referenceLabel = item.isPrimary ? (classLabels[currentClassId] || currentClassId) : cLabel;
      var referenceId = item.isPrimary ? currentClassId : '';
      var otherGroups = [];
      if (ev.groups && ev.groups.length > 0) {
        var refLabelLower = (referenceLabel || '').toLowerCase();
        var refIdLower = (referenceId || '').toLowerCase();
        otherGroups = ev.groups.filter(function (g) {
          var gLower = g.toLowerCase();
          return gLower !== refLabelLower && (!refIdLower || gLower !== refIdLower);
        });
      }

      if (otherGroups.length > 0) {
        var groupsDiv = document.createElement('div');
        groupsDiv.className = 'event-groups';
        otherGroups.forEach(function (g, idx) {
          var tagSpan = document.createElement('span');
          tagSpan.className = 'room-tag';
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

    if (viewSelect) {
      viewSelect.addEventListener('change', function () {
        state.view = viewSelect.value;
        updateControlsFromState();
        render();
      });
    }

    if (dateInput) {
      dateInput.addEventListener('click', function () {
        if (typeof dateInput.showPicker === 'function') {
          try {
            dateInput.showPicker();
          } catch (e) {}
        }
      });
      dateInput.addEventListener('change', function () {
        if (dateInput.value) {
          var picked = parseISODate(dateInput.value);
          var normalized = toWeekday(picked, 1);
          state.date = formatISODate(normalized);
          dateInput.value = state.date;
          render();
        }
      });
    }

    if (compareSelect) {
      compareSelect.addEventListener('change', function () {
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
      evalsOnlyCb.addEventListener('change', function () {
        state.evals = evalsOnlyCb.checked;
        render();
      });
    }

    if (teacherlessCb) {
      teacherlessCb.addEventListener('change', function () {
        state.teacherless = teacherlessCb.checked;
        render();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.search = searchInput.value;
        if (state.view === 'year') {
          if (searchTimeout) clearTimeout(searchTimeout);
          searchTimeout = setTimeout(function () {
            render();
          }, 250);
        } else {
          render();
        }
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.keyCode === 27 || e.keyCode === 13) {
          if (e.key === 'Enter' || e.keyCode === 13) {
            e.preventDefault();
          }
          searchInput.blur();
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        state.view = 'week';
        state.date = defaultDateStr;
        state.compare = '';
        state.sameOnly = false;
        state.showCompared = false;
        state.evals = false;
        state.teacherless = false;
        state.search = '';
        updateControlsFromState();
        render();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (state.view === 'year') return;
        var d = parseISODate(state.date);
        var targetDate;
        if (state.view === 'week') {
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
      nextBtn.addEventListener('click', function () {
        if (state.view === 'year') return;
        var d = parseISODate(state.date);
        var targetDate;
        if (state.view === 'week') {
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
      todayBtn.addEventListener('click', function () {
        var nowObj = getNowDate();
        var today = toWeekday(nowObj.date, 1);
        var todayIso = formatISODate(today);

        if (state.view === 'year') {
          var todayEl = document.getElementById('day-section-' + todayIso);
          if (todayEl) {
            todayEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            var firstDayEl = viewContainer.querySelector('.day-section');
            if (firstDayEl) firstDayEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;

      if (e.key === 'ArrowLeft' || e.keyCode === 37) {
        if (prevBtn && !prevBtn.disabled && !prevBtn.hidden) {
          prevBtn.click();
        }
      } else if (e.key === 'ArrowRight' || e.keyCode === 39) {
        if (nextBtn && !nextBtn.disabled && !nextBtn.hidden) {
          nextBtn.click();
        }
      }
    });

    window.addEventListener('hashchange', function () {
      if (window.location.hash !== lastWrittenHash) {
        loadState();
        render();
      }
    });

    loadState();
    render();
  });
})();

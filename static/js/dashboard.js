(function () {
  AppUtils.onDOMReady(function () {
    var dataEl = document.getElementById("dashboard-data");
    if (!dataEl) return;
    var data = JSON.parse(dataEl.textContent);
    var labels = data.labels;

    function element(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function showEmpty(container, text) {
      container.appendChild(element("p", "dashboard-empty", text));
    }

    function pad(value) {
      return String(value).padStart(2, "0");
    }

    function localKey(instant) {
      return instant.substring(0, 16);
    }

    function timeRange(event) {
      return (
        event.start.substring(11, 16) + " - " + event.end.substring(11, 16)
      );
    }

    function dayLabel(iso) {
      var date = CalendarModel.parseCivilDate(iso);
      return AppUtils.formatText(data.dayTitle, {
        day_name: data.days[(date.getDay() + 6) % 7],
        day_num: date.getDate(),
        month_name: data.months[date.getMonth()],
        year: date.getFullYear(),
      });
    }

    var events = [];
    try {
      events = CalendarModel.normalizeEnvelope(data.events, data.events.class);
    } catch (error) {
      events = [];
    }
    CalendarModel.applyBreaks(events, data.breaks);
    events.sort(function (a, b) {
      return a.start.localeCompare(b.start);
    });

    var now = CalendarModel.inSiteTimezone(new Date(), data.timezone);
    var nowKey =
      now.getFullYear() +
      "-" +
      pad(now.getMonth() + 1) +
      "-" +
      pad(now.getDate()) +
      "T" +
      pad(now.getHours()) +
      ":" +
      pad(now.getMinutes());
    var upcoming = events.filter(function (event) {
      return localKey(event.end) > nowKey;
    });

    function renderCourses() {
      var container = document.getElementById("dashboard-courses");
      if (upcoming.length === 0) {
        showEmpty(container, labels.no_courses);
        return;
      }
      var dayIso = upcoming[0].start.substring(0, 10);
      if (dayIso !== nowKey.substring(0, 10)) {
        document.getElementById("dashboard-courses-title").textContent =
          labels.upcoming;
      }
      container.appendChild(element("p", "dashboard-day", dayLabel(dayIso)));
      var list = element("ul", "dashboard-list");
      events
        .filter(function (event) {
          return event.start.substring(0, 10) === dayIso;
        })
        .forEach(function (event) {
          var item = element("li", "dashboard-item");
          if (localKey(event.end) <= nowKey) item.classList.add("is-past");
          else if (localKey(event.start) <= nowKey)
            item.classList.add("is-ongoing");
          item.appendChild(element("span", "dashboard-time", timeRange(event)));
          var info = element("span", "dashboard-info");
          info.appendChild(element("span", "dashboard-title", event.title));
          if (event.rooms.length > 0) {
            info.appendChild(
              element("span", "dashboard-meta", event.rooms.join(", ")),
            );
          }
          item.appendChild(info);
          list.appendChild(item);
        });
      container.appendChild(list);
    }

    function renderEvaluation() {
      var container = document.getElementById("dashboard-evaluation");
      var next = upcoming.find(function (event) {
        return event.category;
      });
      if (!next) {
        showEmpty(container, labels.no_evaluation);
        return;
      }
      var link = element("a", "dashboard-evaluation");
      link.href =
        container.dataset.detailBase + "/" + next.occurrence_id + ".html";
      link.appendChild(
        element(
          "span",
          "category-badge",
          data.categories[next.category] || next.category,
        ),
      );
      link.appendChild(element("span", "dashboard-title", next.title));
      link.appendChild(
        element(
          "span",
          "dashboard-meta",
          dayLabel(next.start.substring(0, 10)),
        ),
      );
      link.appendChild(element("span", "dashboard-time", timeRange(next)));
      container.appendChild(link);
    }

    function renderGrades() {
      var container = document.getElementById("dashboard-grades");
      var limits = data.gradeLimits;
      var grades = {};
      try {
        var raw = localStorage.getItem(limits.storageKey);
        if (raw) {
          var codes = [];
          data.grades.semesters.forEach(function (semester) {
            semester.subjects.forEach(function (subject) {
              codes.push(subject.code);
            });
          });
          grades = GradesModel.normalizeGrades(
            JSON.parse(raw),
            codes,
            limits,
          ).grades;
        }
      } catch (error) {
        grades = {};
      }
      var averages = GradesModel.calculate(grades, data.grades);
      var hasAverage = data.grades.semesters.some(function (semester) {
        return averages.semesters[semester.id] !== null;
      });
      if (!hasAverage) {
        showEmpty(container, labels.no_grades);
        return;
      }
      var list = element("dl", "dashboard-averages");
      data.grades.semesters.forEach(function (semester) {
        var value = averages.semesters[semester.id];
        var row = element("div");
        row.appendChild(element("dt", null, semester.label));
        row.appendChild(
          element(
            "dd",
            null,
            value === null ? "" : value.toFixed(limits.decimals),
          ),
        );
        list.appendChild(row);
      });
      container.appendChild(list);
    }

    renderCourses();
    renderEvaluation();
    renderGrades();
  });
})();

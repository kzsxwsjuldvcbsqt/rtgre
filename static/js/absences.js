(function () {
  AppUtils.onDOMReady(async function () {
    const data = document.getElementById("absence-data");
    if (!data) return;
    const context = JSON.parse(data.textContent),
      labels = context.labels,
      model = AbsenceModel,
      validation = AbsenceRecords,
      courses = model.normalizeCourses(context.events, context.categories),
      writeAccess = await WriteAccess.acquire(
        [
          context.config.storage_key_prefix,
          context.classId,
          context.year.label,
        ].join("_"),
      ),
      store = AbsenceStore.create(
        context,
        () => localStorage,
        validation.validatePayload,
        validation.migratePayload,
        () => writeAccess.assertWritable(),
      );
    const byId = (id) => document.getElementById("absence-" + id),
      format = AppUtils.formatText,
      dateFormatter = new Intl.DateTimeFormat(context.locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      boundaryDateFormatter = new Intl.DateTimeFormat(context.locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      timeFormatter = new Intl.DateTimeFormat(context.locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      });
    let records = [],
      draft = null,
      editingId = null,
      convertingLegacy = false,
      restoreFailed = false,
      editingStatusBaseline = null;
    const dialog = document.getElementById("absence-dialog");
    function openEditor() {
      if (dialog && typeof dialog.showModal === "function" && !dialog.open)
        dialog.showModal();
    }
    function closeEditor() {
      if (dialog && dialog.open) dialog.close();
    }
    function node(tag, text, className) {
      const item = document.createElement(tag);
      if (text !== undefined) item.textContent = text;
      if (className) item.className = className;
      return item;
    }
    function dateLabel(date) {
      return dateFormatter.format(new Date(date + "T00:00:00Z"));
    }
    function boundaryDateLabel(date) {
      return boundaryDateFormatter.format(new Date(date + "T00:00:00Z"));
    }
    function timeLabel(value) {
      return timeFormatter.format(new Date("1970-01-01T" + value + ":00Z"));
    }
    function dateTimeLabel(value) {
      return dateLabel(value.slice(0, 10)) + " " + timeLabel(value.slice(11));
    }
    function duration(minutes) {
      return format(labels.duration, {
        hours: Math.floor(minutes / 60),
        minutes: String(minutes % 60).padStart(2, "0"),
      });
    }
    function today() {
      const parts = new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          timeZone: context.timezone,
        }).formatToParts(new Date()),
        values = Object.fromEntries(
          parts.map((part) => [part.type, part.value]),
        );
      return values.year + "-" + values.month + "-" + values.day;
    }
    function message(text, error) {
      const item = byId("message");
      item.textContent = text;
      item.hidden = !text;
      item.setAttribute("role", error ? "alert" : "status");
    }
    function dateRange(record) {
      return format(labels.date_range, {
        start: dateLabel(record.startDate),
        end: dateLabel(record.endDate),
      });
    }
    function recordRangeLabel(record) {
      return format(labels.absence_line, {
        start: dateLabel(record.startDate),
        end: dateLabel(record.endDate),
      });
    }
    function rangeLabel(record) {
      if (record.selectionMode === "course")
        return format(labels.course_time, {
          start: dateTimeLabel(record.courses[0].start),
          end: dateTimeLabel(record.courses[0].end),
        });
      if (record.selectionMode === "range")
        return format(labels.continuous_range, {
          start_date: boundaryDateLabel(record.startDate),
          start_period: labels.range_start_summary[record.startPeriod],
          end_date: boundaryDateLabel(record.endDate),
          end_period: labels.range_end_summary[record.endPeriod],
        });
      if (
        record.startDate === record.endDate &&
        record.startPeriod === "morning" &&
        record.endPeriod === "afternoon"
      )
        return labels.periods.day;
      return labels.periods[record.startPeriod];
    }
    function practical(record, includeRange) {
      const summary = model.summarize(record),
        wrap = node("div", undefined, "absence-practical-content");
      if (includeRange) wrap.append(node("p", recordRangeLabel(record)));
      wrap.append(
        node("p", format(labels.range_line, { range: rangeLabel(record) })),
        node(
          "p",
          format(labels.duration_line, { duration: duration(summary.minutes) }),
        ),
        node(
          "p",
          labels.modules + " : " + (summary.modules.join(", ") || labels.none),
        ),
        node(
          "p",
          labels.evaluation +
            " : " +
            (summary.evaluations.length
              ? summary.evaluations
                  .map(
                    (item) =>
                      item.title +
                      " (" +
                      dateTimeLabel(item.start) +
                      " – " +
                      dateTimeLabel(item.end) +
                      ")",
                  )
                  .join(", ")
              : labels.none_feminine),
        ),
      );
      return wrap;
    }
    function modeFields() {
      const mode = byId("mode").value;
      [
        ["day", "day"],
        ["half-day", "half_day"],
        ["course", "course"],
        ["range", "range"],
      ].forEach(([name, value]) => {
        byId(name + "-fields").hidden = value !== mode;
      });
    }
    function coursesForDate() {
      const select = byId("course-select"),
        date = byId("course-date").value,
        matching = courses.filter(
          (course) => course.start.slice(0, 10) === date,
        ),
        group = document.createElement("optgroup");
      group.label = labels.course;
      matching.forEach((course) =>
        group.append(
          new Option(
            course.title +
              " — " +
              timeLabel(course.start.slice(11)) +
              "–" +
              timeLabel(course.end.slice(11)),
            course.key,
          ),
        ),
      );
      if (!matching.length) group.append(new Option(labels.no_course, ""));
      select.replaceChildren(group);
    }
    function selection() {
      const mode = byId("mode").value;
      if (mode === "day") return { mode, date: byId("date").value };
      if (mode === "half_day")
        return {
          mode,
          date: byId("half-date").value,
          period: byId("period").value,
        };
      if (mode === "course")
        return { mode, courseKey: byId("course-select").value };
      return {
        mode,
        startDate: byId("start-date").value,
        startPeriod: byId("start-period").value,
        endDate: byId("end-date").value,
        endPeriod: byId("end-period").value,
      };
    }
    function updateDraft() {
      try {
        const selected = selection();
        let range,
          picked,
          selectionMode = selected.mode,
          selectedCourseKey = "";
        if (selected.mode === "course") {
          picked = courses.find((course) => course.key === selected.courseKey);
          if (!picked) throw new Error("course");
          range = model.courseRecordRange(picked, context.config);
          picked = [model.selectedCourse(picked)];
          selectedCourseKey = picked[0].key;
        } else {
          range = model.rangeFor(selected, context.config);
          picked = model.findCourses(courses, range);
        }
        if (!model.withinYear(range, context.year)) throw new Error("bounds");
        draft = {
          ...range,
          kind: "absence",
          selectionMode,
          selectedCourseKey,
          courses: picked,
          halfDays: model
            .affectedHalfDays(picked, range, context.config)
            .map(({ date, period }) => ({ date, period })),
          justificationAvailable: byId("justification").checked,
          submitted: byId("submitted").checked,
        };
        byId("practical").replaceChildren(practical(draft, true));
        byId("form-error").hidden = true;
        byId("save").disabled = restoreFailed;
      } catch (error) {
        draft = null;
        byId("practical").replaceChildren();
        byId("form-error").textContent =
          labels.errors[error.message] || labels.errors.range;
        byId("form-error").hidden = false;
        byId("save").disabled = true;
      }
    }
    function renderSummary() {
      const summary = model.annualSummary(records, context.config),
        wrap = byId("summary");
      wrap.replaceChildren(
        node("p", format(labels.annual_summary, summary), "absence-primary"),
      );
      if (summary.review)
        wrap.append(
          node("p", format(labels.review_summary, summary), "absence-hint"),
        );
    }
    function action(label, callback) {
      const button = node("button", label);
      button.type = "button";
      button.addEventListener("click", callback);
      return button;
    }
    function updateStatus(recordId, field, control) {
      const index = records.findIndex(
        (item) => item.id === recordId && item.kind === "absence",
      );
      if (index < 0) return;
      const current = records[index],
        next = {
          ...current,
          [field]: control.checked,
          updatedAt: new Date().toISOString(),
        },
        updated = records.slice();
      updated[index] = next;
      try {
        records = store.save(updated);
        message(labels.status_updated, false);
        if (field === "justificationAvailable") renderSummary();
      } catch (error) {
        control.checked = current[field];
        message(labels.errors[error.message] || labels.errors.storage, true);
      }
    }
    function statusControls(record) {
      const fieldset = node("fieldset", undefined, "absence-record-status"),
        justification = document.createElement("input"),
        submitted = document.createElement("input");
      justification.type = submitted.type = "checkbox";
      justification.checked = record.justificationAvailable;
      submitted.checked = record.submitted;
      justification.addEventListener("change", () =>
        updateStatus(record.id, "justificationAvailable", justification),
      );
      submitted.addEventListener("change", () =>
        updateStatus(record.id, "submitted", submitted),
      );
      const a = node("label", " " + labels.justification, "absence-toggle"),
        b = node("label", " " + labels.submitted, "absence-toggle");
      a.prepend(justification);
      b.prepend(submitted);
      fieldset.append(a, b);
      return fieldset;
    }
    function recordTitle(record) {
      return recordRangeLabel(record);
    }
    function renderRecords() {
      const wrap = byId("records");
      wrap.replaceChildren();
      byId("export").disabled = restoreFailed || !records.length;
      byId("clear").disabled = !records.length && !restoreFailed;
      if (!records.length)
        wrap.append(node("p", labels.empty_saved, "empty-state-message"));
      [...records]
        .sort((a, b) =>
          (b.start || b.original.start).localeCompare(
            a.start || a.original.start,
          ),
        )
        .forEach((record) => {
          const card = node("div", undefined, "absence-record-card"),
            details = node("details", undefined, "absence-record");
          details.name = "saved-absences";
          details.dataset.recordId = record.id;
          if (record.kind === "legacy")
            details.append(
              node("summary", labels.legacy_review),
              node("p", labels.legacy_description, "absence-hint"),
              action(labels.convert_legacy, () => editLegacy(record)),
            );
          else {
            details.append(
              node("summary", recordTitle(record)),
              practical(record, false),
              statusControls(record),
            );
            const editButton = action(labels.edit_dates, () =>
                editRecord(record),
              ),
              sheetButton = action(labels.prepare_sheet, (event) =>
                prepareSheet(record, event.currentTarget),
              ),
              deleteButton = action(labels.delete, () => {
                if (!confirm(labels.delete_confirm)) return;
                const nextRecords = records.filter(
                  (item) => item.id !== record.id,
                );
                if (!persist(nextRecords, labels.deleted)) return;
                if (editingId === record.id) resetEditor();
                sheet.closeFor(record.id);
                renderRecords();
              });
            deleteButton.classList.add("menu-item-danger");
            const menu = node("details", undefined, "menu"),
              menuSummary = node("summary"),
              menuList = node("div", undefined, "menu-list"),
              actions = node("div", undefined, "absence-record-actions");
            menuSummary.setAttribute("aria-label", labels.actions);
            menuSummary.append(
              byId("record-menu-icon").content.cloneNode(true),
            );
            menuList.append(editButton, sheetButton, deleteButton);
            menu.append(menuSummary, menuList);
            actions.append(menu);
            details.append(actions);
          }
          const summary = details.querySelector("summary");
          const title = node("span", summary.textContent);
          const arrow = node("span", undefined, "toggle-arrow is-collapsed");
          arrow.setAttribute("aria-hidden", "true");
          summary.replaceChildren(title, arrow);
          details.addEventListener("toggle", () => {
            arrow.classList.toggle("is-collapsed", !details.open);
            if (details.open) {
              wrap
                .querySelectorAll("details.absence-record")
                .forEach((other) => {
                  if (other !== details && other.open) other.open = false;
                });
            }
          });
          card.prepend(details);
          wrap.append(card);
        });
      renderSummary();
    }
    function recordElement(recordId) {
      return Array.from(
        byId("records").querySelectorAll("[data-record-id]"),
      ).find((element) => element.dataset.recordId === recordId);
    }
    function persist(nextRecords, success) {
      try {
        records = store.save(nextRecords);
        restoreFailed = false;
        message(success, false);
        renderRecords();
        return true;
      } catch (error) {
        message(labels.errors[error.message] || labels.errors.storage, true);
        return false;
      }
    }
    function resetEditor() {
      editingId = null;
      convertingLegacy = false;
      editingStatusBaseline = null;
      byId("editor-heading").textContent = labels.new_heading;
      byId("save").textContent = labels.save;
      byId("cancel").hidden = true;
      byId("editing-hint").hidden = true;
      byId("converting-hint").hidden = true;
      byId("justification").checked = false;
      byId("submitted").checked = false;
      modeFields();
      updateDraft();
    }
    function editRecord(record) {
      editingId = record.id;
      editingStatusBaseline = {
        justificationAvailable: record.justificationAvailable,
        submitted: record.submitted,
      };
      byId("mode").value =
        record.selectionMode === "course" ? "course" : "range";
      byId("start-date").value = record.startDate;
      byId("start-period").value = record.startPeriod;
      byId("end-date").value = record.endDate;
      byId("end-period").value = record.endPeriod;
      byId("course-date").value = record.startDate;
      coursesForDate();
      const matches =
        record.selectionMode === "course"
          ? model.matchingCourses(record.courses[0], courses)
          : [];
      byId("course-select").value = matches.length === 1 ? matches[0].key : "";
      byId("justification").checked = record.justificationAvailable;
      byId("submitted").checked = record.submitted;
      byId("editor-heading").textContent = labels.edit_heading;
      byId("save").textContent = labels.update;
      byId("cancel").hidden = false;
      byId("editing-hint").hidden = false;
      modeFields();
      updateDraft();
      openEditor();
      if (matches.length > 1) message(labels.errors.course_ambiguous, true);
    }
    function editLegacy(record) {
      const value = model.selectionFromLegacy(record, context.config);
      editingId = record.id;
      convertingLegacy = true;
      editingStatusBaseline = null;
      byId("mode").value = "range";
      byId("start-date").value = value.startDate;
      byId("start-period").value = value.startPeriod;
      byId("end-date").value = value.endDate;
      byId("end-period").value = value.endPeriod;
      byId("editor-heading").textContent = labels.convert_heading;
      byId("save").textContent = labels.update;
      byId("cancel").hidden = false;
      byId("converting-hint").hidden = false;
      modeFields();
      updateDraft();
      openEditor();
    }
    const sheet = AbsenceSheet.create({
      context,
      labels,
      model,
      byId,
      format,
      dateLabel,
      dateTimeLabel,
      dateRange,
      rangeLabel,
      duration,
      today,
      getRecords: () => records,
    });
    const closeSheet = sheet.close;
    const prepareSheet = sheet.prepare;
    const pdfAction = sheet.action;
    AppUtils.bindBlurKeys([
      byId("sheet-last-name"),
      byId("sheet-first-name"),
      byId("sheet-signing-date"),
    ]);
    AppUtils.bindBlurKeys([byId("sheet-reason")], { multiline: true });
    byId("form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!draft || restoreFailed) return;
      const covered = model.coveredRecord(records, draft, editingId);
      if (covered) {
        byId("form-error").textContent = format(labels.errors.covered, {
          interval: recordRangeLabel(covered),
        });
        byId("form-error").hidden = false;
        return;
      }
      const old = records.find((item) => item.id === editingId),
        now = new Date().toISOString(),
        changedJustification =
          old &&
          editingStatusBaseline &&
          byId("justification").checked !==
            editingStatusBaseline.justificationAvailable,
        changedSubmitted =
          old &&
          editingStatusBaseline &&
          byId("submitted").checked !== editingStatusBaseline.submitted,
        record = {
          ...draft,
          id: editingId || crypto.randomUUID(),
          createdAt: old?.createdAt || now,
          updatedAt: now,
          justificationAvailable:
            old && !convertingLegacy && !changedJustification
              ? old.justificationAvailable
              : byId("justification").checked,
          submitted:
            old && !convertingLegacy && !changedSubmitted
              ? old.submitted
              : byId("submitted").checked,
        };
      const nextRecords = old
        ? records.map((item) => (item.id === editingId ? record : item))
        : [...records, record];
      if (
        old &&
        old.kind === "absence" &&
        !model.sameCourseSnapshot(old.courses, record.courses) &&
        !confirm(labels.schedule_changed_confirm)
      ) {
        return;
      }
      if (!persist(nextRecords, old ? labels.updated : labels.saved)) return;
      resetEditor();
      renderRecords();
      closeEditor();
      const item = recordElement(record.id);
      if (item) {
        item.open = true;
        item.querySelector("summary").focus();
      }
    });
    [
      "mode",
      "date",
      "half-date",
      "period",
      "course-date",
      "course-select",
      "start-date",
      "start-period",
      "end-date",
      "end-period",
      "justification",
      "submitted",
    ].forEach((id) =>
      byId(id).addEventListener("change", () => {
        if (id === "course-date") coursesForDate();
        if (
          id === "start-date" &&
          byId("end-date").value < byId("start-date").value
        )
          byId("end-date").value = byId("start-date").value;
        modeFields();
        updateDraft();
      }),
    );
    byId("cancel").addEventListener("click", () => {
      resetEditor();
      closeEditor();
    });
    byId("add").addEventListener("click", () => {
      resetEditor();
      openEditor();
    });
    byId("dialog-close").addEventListener("click", () => {
      resetEditor();
      closeEditor();
    });
    if (dialog) dialog.addEventListener("close", resetEditor);
    byId("sheet-close").addEventListener("click", closeSheet);
    byId("pdf-download").addEventListener("click", () => pdfAction("download"));
    byId("pdf-open").addEventListener("click", () => pdfAction("open"));
    byId("export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(store.payload(records), null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = format(context.config.export_filename, {
        class: context.classId,
        year: context.year.label,
        date: today(),
      });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
    byId("clear").addEventListener("click", () => {
      if (!confirm(labels.clear_confirm)) return;
      try {
        store.clear();
        records = [];
        restoreFailed = false;
        resetEditor();
        closeSheet();
        message(labels.cleared, false);
      } catch (error) {
        message(labels.errors[error.message] || labels.errors.storage, true);
      }
      renderRecords();
    });
    byId("import").addEventListener("click", () => {
      byId("import-file").value = "";
      byId("import-file").click();
    });
    byId("import-file").addEventListener("change", async function () {
      const file = this.files[0];
      if (!file) return;
      if (file.size > context.config.max_import_bytes) {
        message(labels.errors.size, true);
        return;
      }
      try {
        const incoming = validation.migratePayload(
          JSON.parse(await file.text()),
          context,
        );
        if (records.length && !confirm(labels.import_confirm)) return;
        if (!persist(incoming, labels.imported)) return;
        resetEditor();
        closeSheet();
        renderRecords();
      } catch (error) {
        message(labels.errors[error.message] || labels.errors.format, true);
      }
    });
    try {
      records = store.load();
    } catch (error) {
      restoreFailed = true;
      message(labels.errors.restore, true);
    }
    const initial = today();
    ["date", "half-date", "course-date", "start-date", "end-date"].forEach(
      (id) => {
        byId(id).value = initial;
      },
    );
    byId("mode").value = context.config.default_mode;
    byId("period").value = context.config.default_period;
    byId("start-period").value = "morning";
    byId("end-period").value = "afternoon";
    coursesForDate();
    resetEditor();
    renderRecords();
    byId("app").hidden = false;
    const historyMenu = byId("history-menu");
    if (historyMenu) historyMenu.hidden = false;
    if (!writeAccess.writable) message(labels.errors.conflict, true);
    document.documentElement.dataset.storageReady = "true";
  });
})();

(function (global) {
  function create({
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
    getRecords,
  }) {
    let preparedRecordId = null,
      preparedTrigger = null,
      pdfBusy = false,
      pdfCacheKey = "",
      pdfCache = null;
    const fields = {
      lastName: "sheet-last-name",
      firstName: "sheet-first-name",
      reason: "sheet-reason",
      date: "sheet-signing-date",
    };
    let validationShown = false;
    function message(text, error) {
      const target = byId("sheet-message");
      target.textContent = text;
      target.hidden = !text;
      target.classList.toggle("absence-error", error);
      target.setAttribute("role", error ? "alert" : "status");
    }
    function showErrors(focus = false) {
      const errors = AbsencePersonal.errors(
        personal(),
        context.config,
        model.civilDate,
      );
      for (const [field, id] of Object.entries(fields)) {
        const input = byId(id),
          error = byId(id + "-error");
        if (error) {
          error.textContent =
            errors[field] && labels.errors[errors[field]]
              ? labels.errors[errors[field]]
              : "";
          error.hidden = !error.textContent;
        }
        if (errors[field]) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
      if (focus && Object.keys(errors).length)
        byId(fields[Object.keys(errors)[0]]).focus();
      return errors;
    }
    Object.values(fields).forEach((id) =>
      byId(id).addEventListener("input", () => {
        if (validationShown) {
          showErrors();
          byId("sheet-message").hidden = true;
        }
      }),
    );
    function personal() {
      return {
        lastName: byId("sheet-last-name").value.trim(),
        firstName: byId("sheet-first-name").value.trim(),
        reason: byId("sheet-reason").value.trim(),
        date: byId("sheet-signing-date").value,
      };
    }
    function sheetData(record, values) {
      const summary = model.summarize(record),
        evaluations = summary.evaluations.length
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
          : labels.none_feminine;
      return {
        title: labels.sheet_title,
        depositLines: labels.sheet_deposit.split("\n"),
        remindersTitle: labels.sheet_reminders,
        reminders: [labels.sheet_reminder_one, labels.sheet_reminder_two],
        rows: [
          {
            label: labels.sheet_year,
            value:
              context.config.sheet.program_label + " : " + context.classLabel,
          },
          {
            label: labels.sheet_identity,
            value: values.lastName + " " + values.firstName,
            annexTitle: labels.sheet_identity,
          },
          { label: labels.sheet_absence, value: dateRange(record) },
          {
            label: labels.sheet_range,
            value: rangeLabel(record),
            annexTitle: labels.sheet_range,
          },
          { label: labels.sheet_duration, value: duration(summary.minutes) },
          {
            label: labels.sheet_modules,
            value: summary.modules.join(", ") || labels.none,
            annexTitle: labels.sheet_modules,
          },
          {
            label: labels.sheet_evaluations,
            value: evaluations,
            annexTitle: labels.sheet_evaluations,
          },
          {
            label: labels.sheet_reason,
            value: values.reason,
            annexTitle: labels.sheet_reason,
          },
          {
            label: labels.sheet_justification,
            value: labels[record.justificationAvailable ? "yes" : "no"],
          },
        ],
        locationDate: format(labels.sheet_location_date, {
          place: context.config.sheet.signature_place,
          date: values.date ? dateLabel(values.date) : "",
        }),
        signatureLabel: labels.sheet_signature_area,
        annexTitle: labels.sheet_annex,
        annexReference: labels.sheet_annex_reference,
      };
    }
    function setPdfBusy(value) {
      pdfBusy = value;
      ["pdf-download", "pdf-open", "sheet-close"].forEach((id) => {
        byId(id).disabled = value;
      });
      byId("sheet-preparation").setAttribute(
        "aria-busy",
        value ? "true" : "false",
      );
    }
    function createPdf(record, values) {
      const content = sheetData(record, values),
        key = JSON.stringify({
          id: record.id,
          updatedAt: record.updatedAt,
          content,
        });
      if (!pdfCache || pdfCacheKey !== key) {
        pdfCacheKey = key;
        pdfCache = AbsencePdf.create(
          content,
          context.pdfAssets,
          context.config.sheet.pdf_layout,
        ).catch((error) => {
          pdfCache = null;
          throw error;
        });
      }
      return pdfCache;
    }
    function releaseLater(url) {
      setTimeout(
        () => URL.revokeObjectURL(url),
        context.config.sheet.blob_revoke_delay_ms,
      );
    }
    async function pdfAction(kind) {
      if (pdfBusy) return;
      validationShown = true;
      showErrors(true);
      let values;
      try {
        values = AbsencePersonal.validate(
          personal(),
          context.config,
          model.civilDate,
        );
      } catch (error) {
        if (labels.errors.sheet_invalid_fields)
          message(labels.errors.sheet_invalid_fields, true);
        return;
      }
      const record = getRecords().find(
        (item) => item.id === preparedRecordId && item.kind === "absence",
      );
      if (!record) return;
      const popup = kind === "open" ? window.open("", "_blank") : null;
      setPdfBusy(true);
      try {
        const bytes = await createPdf(record, values),
          blob = new Blob([bytes], { type: "application/pdf" }),
          url = URL.createObjectURL(blob);
        if (kind === "download") {
          const link = document.createElement("a");
          link.href = url;
          link.download = format(context.config.sheet.pdf_filename, {
            class: context.classId,
            date: today(),
          });
          document.body.append(link);
          link.click();
          link.remove();
          releaseLater(url);
          message(labels.pdf_downloaded, false);
        } else if (popup) {
          popup.opener = null;
          popup.location.href = url;
          releaseLater(url);
          message(labels.pdf_opened, false);
        } else {
          URL.revokeObjectURL(url);
          message(labels.pdf_open_blocked, true);
        }
      } catch (error) {
        if (popup && !popup.closed) popup.close();
        message(
          labels.errors[error.message] || labels.errors.pdf_generation,
          true,
        );
      } finally {
        setPdfBusy(false);
      }
    }
    function clearSheet() {
      validationShown = false;
      byId("sheet-message").hidden = true;
      Object.values(fields).forEach((id) => {
        byId(id).removeAttribute("aria-invalid");
        byId(id + "-error").hidden = true;
      });
      [
        "sheet-last-name",
        "sheet-first-name",
        "sheet-reason",
        "sheet-signing-date",
      ].forEach((id) => {
        byId(id).value = "";
      });
      preparedRecordId = null;
      pdfCacheKey = "";
      pdfCache = null;
    }
    function closeSheet() {
      byId("sheet-preparation").hidden = true;
      clearSheet();
      if (preparedTrigger && document.contains(preparedTrigger))
        preparedTrigger.focus();
      preparedTrigger = null;
    }
    function prepareSheet(record, trigger) {
      clearSheet();
      preparedRecordId = record.id;
      preparedTrigger = trigger;
      byId("sheet-signing-date").value = today();
      byId("sheet-preparation").hidden = false;
      byId("sheet-last-name").focus();
    }
    return {
      close: closeSheet,
      prepare: prepareSheet,
      action: pdfAction,
      closeFor(id) {
        if (preparedRecordId === id) closeSheet();
      },
    };
  }
  global.AbsenceSheet = { create };
})(globalThis);

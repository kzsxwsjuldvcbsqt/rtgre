async function runAbsenceBrowserTests({ frame, assert, change, pause }) {
  for (const width of [320, 390, 768, 960, 1440]) {
    const f = await frame("classes/b3cy1/absences.html", width),
      d = f.contentDocument,
      w = f.contentWindow,
      get = (id) => d.getElementById("absence-" + id);
    assert(
      !get("app").hidden && !d.querySelector(".absence-sheet-preview"),
      "Absence page initializes without printable preview: " + width,
    );
    assert(
      d.documentElement.scrollWidth <= width,
      "Absence page has no overflow: " +
        width +
        " (actual: " +
        d.documentElement.scrollWidth +
        ")",
    );
    get("add").click();
    const longOption = new w.Option(
      "Une absence sur plusieurs journées consécutives",
      "long-label",
    );
    get("mode").append(longOption);
    assert(
      d.documentElement.scrollWidth <= width,
      "Long controls stay inside the dialog without widening the page: " +
        width,
    );
    const selection = d.querySelector(".absence-selection");
    assert(
      selection.scrollWidth <= selection.clientWidth + 1 &&
        d.documentElement.scrollWidth <= width,
      "The editor fields wrap instead of scrolling sideways: " + width,
    );
    longOption.remove();
    ["day", "half_day", "course", "range"].forEach((mode) => {
      change(w, get("mode"), mode);
      assert(
        !get(mode === "half_day" ? "half-day-fields" : mode + "-fields").hidden,
        "Useful fields are shown for " + mode + ": " + width,
      );
    });
    const statusFields = d.querySelector(".absence-status-fields");
    assert(
      w.getComputedStyle(statusFields).overflowX !== "auto" &&
        statusFields.scrollWidth <= statusFields.clientWidth + 1,
      "Status controls wrap without a horizontal scroll: " + width,
    );
    f.remove();
  }
  let f = await frame("classes/b3cy1/absences.html"),
    d = f.contentDocument,
    w = f.contentWindow,
    get = (id) => d.getElementById("absence-" + id);
  async function waitFor(condition) {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (condition()) return;
      await pause();
    }
    throw new Error("Timed out waiting for PDF generation");
  }
  function encodeBytes(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  }
  assert(
    get("clear").textContent === "Tout effacer" &&
      !d.body.textContent.includes("built-in method"),
    "Clear action has its configured label",
  );
  change(w, get("mode"), "range");
  change(w, get("start-date"), "2026-09-07");
  change(w, get("start-period"), "morning");
  change(w, get("end-date"), "2026-09-10");
  change(w, get("end-period"), "afternoon");
  assert(
    get("practical").textContent.includes(
      "Du lundi 7 septembre 2026 matin au jeudi 10 septembre 2026 en fin de journée, inclus",
    ),
    "Continuous range describes full intermediate days and inclusive end",
  );
  change(w, get("end-period"), "morning");
  assert(
    get("practical").textContent.includes("en fin de matinée, inclus"),
    "Continuous range describes a return on the final afternoon",
  );
  change(w, get("start-date"), "2026-09-10");
  change(w, get("start-period"), "afternoon");
  assert(
    !get("form-error").hidden && get("save").disabled,
    "Incoherent same-date boundaries are refused",
  );
  change(w, get("mode"), "course");
  change(w, get("course-date"), "2026-09-08");
  assert(
    get("course-select").options.length > 0,
    "Course occurrences are selectable with their date",
  );
  get("save").click();
  assert(
    get("records").querySelectorAll(".absence-record").length === 1,
    "An isolated course is saved",
  );
  change(w, get("mode"), "day");
  change(w, get("date"), "2026-09-09");
  get("save").click();
  const recordsList = get("records").querySelectorAll(".absence-record");
  assert(recordsList.length === 2, "Two absences are saved");
  recordsList[0].open = true;
  recordsList[0].dispatchEvent(new w.Event("toggle"));
  assert(recordsList[0].open && !recordsList[1].open, "First record is open");
  recordsList[1].open = true;
  recordsList[1].dispatchEvent(new w.Event("toggle"));
  assert(
    !recordsList[0].open && recordsList[1].open,
    "Opening second record closes the first record",
  );
  w.confirm = () => true;
  Array.from(recordsList[0].querySelectorAll("button"))
    .find((button) => button.textContent === "Supprimer")
    .click();
  assert(
    get("records").querySelectorAll(".absence-record").length === 1,
    "Restored to single saved record",
  );
  const observer = await frame("classes/b3cy1/absences.html");
  const savedBeforeObserver = w.localStorage.getItem(
    "absences_b3cy1_2026-2027",
  );
  observer.contentWindow.confirm = () => true;
  observer.contentDocument.getElementById("absence-clear").click();
  const observerStatus = observer.contentDocument.querySelector(
    ".absence-record-status input",
  );
  observerStatus.checked = true;
  observerStatus.dispatchEvent(
    new observer.contentWindow.Event("change", { bubbles: true }),
  );
  assert(
    w.localStorage.getItem("absences_b3cy1_2026-2027") === savedBeforeObserver,
    "A second absence editor cannot clear or replace the active editor's records",
  );
  observer.remove();
  let details = get("records").querySelector(".absence-record");
  details.open = true;
  assert(
    (details.textContent.match(/Absence :/g) || []).length === 1,
    "An open saved absence contains one period title",
  );
  assert(
    !details.textContent.includes("Enregistrer le suivi"),
    "Saved absence has no status save button",
  );
  let statusInputs = details.querySelectorAll(".absence-record-status input"),
    justification = statusInputs[0],
    submitted = statusInputs[1];
  justification.focus();
  justification.checked = true;
  justification.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert(
    d.activeElement === justification &&
      details.open &&
      get("summary").textContent.includes("1 avec justificatif"),
    "Justification saves immediately while preserving focus and open state",
  );
  submitted.focus();
  submitted.checked = true;
  submitted.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert(
    d.activeElement === submitted &&
      get("records").querySelectorAll(".absence-record").length === 1,
    "Submitted status saves independently without duplicating the absence",
  );
  const currentKey = Array.from({ length: w.localStorage.length }, (_, index) =>
    w.localStorage.key(index),
  ).find((key) => key.startsWith("absences_b3cy1_"));
  assert(
    JSON.parse(w.localStorage.getItem(currentKey)).records[0]
      .justificationAvailable &&
      JSON.parse(w.localStorage.getItem(currentKey)).records[0].submitted,
    "Both statuses are written immediately",
  );
  f.remove();
  f = await frame("classes/b3cy1/absences.html");
  d = f.contentDocument;
  w = f.contentWindow;
  get = (id) => d.getElementById("absence-" + id);
  details = get("records").querySelector(".absence-record");
  details.open = true;
  statusInputs = details.querySelectorAll(".absence-record-status input");
  justification = statusInputs[0];
  submitted = statusInputs[1];
  assert(
    justification.checked && submitted.checked,
    "Both statuses survive a reload",
  );
  const storagePrototype = w.Storage.prototype,
    originalSetItem = storagePrototype.setItem,
    originalRemoveItem = storagePrototype.removeItem;
  storagePrototype.setItem = function () {
    throw new Error("unavailable");
  };
  justification.focus();
  justification.checked = false;
  justification.dispatchEvent(new w.Event("change", { bubbles: true }));
  storagePrototype.setItem = originalSetItem;
  assert(
    justification.checked &&
      d.activeElement === justification &&
      get("summary").textContent.includes("1 avec justificatif") &&
      get("message").getAttribute("role") === "alert" &&
      get("records").querySelectorAll(".absence-record").length === 1,
    "A status storage error restores the value and summary while keeping the absence",
  );
  Array.from(details.querySelectorAll("button"))
    .find((button) => button.textContent === "Modifier l’absence")
    .click();
  justification.checked = false;
  justification.dispatchEvent(new w.Event("change", { bubbles: true }));
  get("save").click();
  details = get("records").querySelector(".absence-record");
  details.open = true;
  statusInputs = details.querySelectorAll(".absence-record-status input");
  justification = statusInputs[0];
  submitted = statusInputs[1];
  assert(
    !justification.checked &&
      submitted.checked &&
      get("summary").textContent.includes("1 sans justificatif") &&
      get("records").querySelectorAll(".absence-record").length === 1,
    "Editing dates preserves status changes saved after editing opened",
  );
  const prepare = Array.from(details.querySelectorAll("button")).find(
    (button) => button.textContent === "Préparer la fiche",
  );
  prepare.click();
  assert(
    !get("sheet-preparation").hidden &&
      !d.querySelector(".absence-sheet-preview") &&
      !d.querySelector(".absence-print-sheet") &&
      d.activeElement === get("sheet-last-name") &&
      !w.PDFLib,
    "Sheet preparation has no preview and keeps PDF dependencies unloaded",
  );
  get("sheet-last-name").value = "Durand";
  get("sheet-last-name").focus();
  get("sheet-last-name").dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert(
    d.activeElement === get("sheet-last-name") &&
      get("sheet-last-name").value === "Durand",
    "PDF identity input ignores Enter during IME composition",
  );
  get("sheet-last-name").dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert(
    d.activeElement !== get("sheet-last-name") && !w.PDFLib,
    "Enter leaves PDF identity input without generating a document",
  );
  get("sheet-reason").focus();
  get("sheet-reason").dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert(
    d.activeElement === get("sheet-reason"),
    "Shift and Enter remains available in the multiline PDF reason",
  );
  get("sheet-reason").dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert(
    d.activeElement !== get("sheet-reason") && !w.PDFLib,
    "Enter leaves the PDF reason without submitting or generating",
  );
  change(w, get("sheet-last-name"), "Durand", "input");
  change(w, get("sheet-first-name"), "Camille", "input");
  change(
    w,
    get("sheet-reason"),
    "Motif : cœur, œuvre • l’étudiant — délai.",
    "input",
  );
  change(w, get("sheet-signing-date"), "2026-09-10");
  let pdfUrl = "",
    pdfName = "";
  const originalAnchorClick = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.download.endsWith(".pdf")) {
      pdfUrl = this.href;
      pdfName = this.download;
    }
  };
  for (const invalidName of ["123", "---", "Durand<script>"]) {
    change(w, get("sheet-last-name"), invalidName, "input");
    get("pdf-download").click();
    assert(
      get("sheet-last-name").getAttribute("aria-invalid") === "true" &&
        d.activeElement === get("sheet-last-name"),
      "Invalid name is visibly identified beside the focused field",
    );
    assert(
      !pdfUrl && !w.PDFLib,
      "Invalid PDF identity is rejected before loading resources: " +
        invalidName,
    );
  }
  change(w, get("sheet-last-name"), "Durand", "input");
  get("pdf-download").click();
  assert(
    get("pdf-download").disabled &&
      get("sheet-preparation").getAttribute("aria-busy") === "true",
    "PDF actions prevent double clicks while resources load",
  );
  await waitFor(() => !get("pdf-download").disabled);
  assert(
    pdfUrl,
    "PDF download is available: " + get("sheet-message").textContent,
  );
  const pdfBytes = new w.Uint8Array(
      await (await w.fetch(pdfUrl)).arrayBuffer(),
    ),
    pdfDocument = await w.PDFLib.PDFDocument.load(pdfBytes),
    pageSize = pdfDocument.getPage(0).getSize();
  globalThis.absencePdfBase64 = encodeBytes(pdfBytes);
  assert(
    String.fromCharCode(...pdfBytes.slice(0, 4)) === "%PDF" &&
      pdfDocument.getPageCount() === 1 &&
      Math.abs(pageSize.width - 595.28) < 0.01 &&
      Math.abs(pageSize.height - 841.89) < 0.01 &&
      /^fiche-absence-b3cy1-\d{4}-\d{2}-\d{2}\.pdf$/.test(pdfName),
    "Download produces a real one-page A4 PDF with the configured name",
  );
  let popup;
  w.open = () =>
    (popup = {
      closed: false,
      opener: w,
      location: { href: "" },
      close() {
        this.closed = true;
      },
    });
  get("pdf-open").click();
  await waitFor(() => !get("pdf-open").disabled);
  assert(
    popup.location.href.startsWith("blob:") && popup.opener === null,
    "Open PDF uses the same local generator in a new tab",
  );
  w.open = () => null;
  get("pdf-open").click();
  await waitFor(() => !get("pdf-open").disabled);
  assert(
    get("sheet-message").textContent.includes(
      "téléchargement reste disponible",
    ) && get("sheet-message").getAttribute("role") === "alert",
    "A blocked PDF window leaves download available and reports the problem",
  );
  change(
    w,
    get("sheet-reason"),
    Array(80)
      .fill("Motif détaillé avec œuvre, cœur et délai — contenu conservé.")
      .join(" "),
    "input",
  );
  pdfUrl = "";
  get("pdf-download").click();
  await waitFor(() => !get("pdf-download").disabled);
  const annexBytes = new w.Uint8Array(
      await (await w.fetch(pdfUrl)).arrayBuffer(),
    ),
    annexDocument = await w.PDFLib.PDFDocument.load(annexBytes);
  globalThis.absencePdfAnnexBase64 = encodeBytes(annexBytes);
  assert(
    annexDocument.getPageCount() > 1,
    "Long content is preserved in an explicit PDF annex",
  );
  get("sheet-close").click();
  assert(
    get("sheet-preparation").hidden &&
      !get("sheet-last-name").value &&
      !get("sheet-first-name").value &&
      !get("sheet-reason").value,
    "Closing PDF preparation clears temporary personal data",
  );
  w.HTMLAnchorElement.prototype.click = originalAnchorClick;
  let blob;
  w.URL.createObjectURL = (value) => {
    blob = value;
    return "blob:test";
  };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {};
  get("export").click();
  const exported = JSON.parse(await blob.text());
  assert(
    !JSON.stringify(exported).includes("Durand") &&
      exported.records.length === 1,
    "Personal data is absent from exports",
  );
  w.localStorage.setItem("absences_b3cy2_2026-2027", "other class");
  w.localStorage.setItem("absences_b3cy1_2025-2026", "other year");
  w.localStorage.setItem("grades_b3cy1", "notes");
  w.confirm = () => true;
  storagePrototype.removeItem = function () {
    throw new Error("unavailable");
  };
  get("clear").click();
  storagePrototype.removeItem = originalRemoveItem;
  assert(
    get("records").querySelectorAll(".absence-record").length === 1 &&
      get("message").getAttribute("role") === "alert",
    "A clear storage error preserves in-memory absences and reports failure",
  );
  w.confirm = () => false;
  get("clear").click();
  assert(
    get("records").querySelectorAll(".absence-record").length === 1 &&
      w.localStorage.getItem(currentKey),
    "Cancelling clear preserves all absences",
  );
  details = get("records").querySelector(".absence-record");
  Array.from(details.querySelectorAll("button"))
    .find((button) => button.textContent === "Modifier l’absence")
    .click();
  details.open = true;
  Array.from(details.querySelectorAll("button"))
    .find((button) => button.textContent === "Préparer la fiche")
    .click();
  w.confirm = () => true;
  get("clear").click();
  assert(
    !get("records").querySelector(".absence-record") &&
      get("summary").textContent.startsWith("0 demi-journée") &&
      get("sheet-preparation").hidden &&
      get("cancel").hidden,
    "Successful clear updates history and summary and resets editing and sheet preparation",
  );
  assert(
    !w.localStorage.getItem(currentKey) &&
      w.localStorage.getItem("absences_b3cy2_2026-2027") === "other class" &&
      w.localStorage.getItem("absences_b3cy1_2025-2026") === "other year" &&
      w.localStorage.getItem("grades_b3cy1") === "notes",
    "Clear is isolated from other classes, years and grades",
  );
  f.remove();
  f = await frame("classes/b3cy1/absences.html");
  d = f.contentDocument;
  w = f.contentWindow;
  get = (id) => d.getElementById("absence-" + id);
  assert(
    !get("records").querySelector(".absence-record"),
    "Cleared absences stay cleared after reload",
  );
  change(w, get("mode"), "course");
  change(w, get("course-date"), "2026-09-08");
  get("save").click();
  details = get("records").querySelector(".absence-record");
  details.open = true;
  Array.from(details.querySelectorAll("button"))
    .find((button) => button.textContent === "Préparer la fiche")
    .click();
  change(w, get("sheet-last-name"), "O’Connor", "input");
  change(w, get("sheet-first-name"), "Élodie", "input");
  change(w, get("sheet-reason"), "Motif", "input");
  w.AbsencePdf.create = () => w.Promise.reject({ message: "pdf_resources" });
  get("pdf-download").click();
  await waitFor(() => !get("pdf-download").disabled);
  assert(
    get("sheet-message").textContent.includes("Impossible de charger le logo"),
    "PDF resource failure message: " + get("sheet-message").textContent,
  );
  assert(
    get("sheet-message").getAttribute("role") === "alert" &&
      !get("pdf-download").disabled,
    "A PDF resource failure is accessible and leaves actions available",
  );
  w.confirm = () => true;
  [...details.querySelectorAll("button")]
    .find((button) => button.textContent === "Supprimer")
    .click();
  assert(
    !get("records").querySelector(".absence-record") &&
      get("sheet-preparation").hidden,
    "Deleting the prepared absence closes its sheet without a browser error",
  );
  f.remove();
}

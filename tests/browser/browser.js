(async function () {
  const { results, errors, pause, assert, frame, change } =
    BrowserTest.create();
  try {
    for (const width of [320, 390, 768, 959, 960, 1440]) {
      for (const page of [
        "calendar.html#date=2026-09-08",
        "notes.html",
        "a-faire.html",
        "evaluations.html#period=all",
      ]) {
        const f = await frame("classes/b3cya/" + page, width);
        const d = f.contentDocument,
          w = f.contentWindow;
        assert(
          d.documentElement.scrollWidth <= width,
          "No page overflow: " + page + " at " + width,
        );
        assert(
          d.body.classList.contains("js-ready"),
          "Deferred scripts initialized: " + page + " at " + width,
        );
        if (page.startsWith("calendar"))
          assert(
            d.querySelectorAll(".day-section").length === 5,
            "Five configured days: " + width,
          );
        if (width < 960) {
          assert(
            w.getComputedStyle(d.querySelector(".nav-menu")).display === "flex",
            "Mobile navigation stays a visible bar: " + width,
          );
          assert(
            !d.querySelector(".nav-toggle"),
            "No burger toggle on mobile: " + width,
          );
        }
        assert(!w.injected, "Embedded event text is inert: " + page);
        f.remove();
      }
    }
    const tasks = await frame("classes/b3cya/a-faire.html"),
      td = tasks.contentDocument,
      tw = tasks.contentWindow,
      taskInput = td.getElementById("tasks-input"),
      taskText = "Préparer le rendu <script>window.taskInjected=1</script>";
    change(tw, taskInput, taskText);
    td.getElementById("tasks-form").dispatchEvent(
      new tw.Event("submit", { bubbles: true, cancelable: true }),
    );
    assert(
      td.querySelectorAll(".task-item").length === 1 &&
        td.querySelector(".task-text").textContent === taskText &&
        !tw.taskInjected,
      "Free task text is stored and rendered as inert text",
    );
    tw.confirm = () => true;
    td.querySelector(".task-item .menu-item-danger").click();
    assert(
      td.querySelectorAll(".task-item").length === 0,
      "A task can be deleted independently",
    );
    tasks.remove();
    const notes = await frame("classes/b3cya/notes.html");
    const nd = notes.contentDocument,
      nw = notes.contentWindow;
    const input = nd.querySelector(".grade-input");
    input.value = "11";
    input.focus();
    input.dispatchEvent(
      new nw.KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    assert(
      nd.activeElement === input && input.value === "11",
      "Grade input ignores Enter during IME composition",
    );
    for (const key of ["Escape", "Enter"]) {
      input.focus();
      input.dispatchEvent(
        new nw.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }),
      );
      assert(
        nd.activeElement !== input && input.value === "11",
        "Grade input releases focus on " + key,
      );
    }
    change(nw, input, "12,5", "input");
    assert(
      nd.getElementById("avg-s5").textContent === "12.50",
      "French decimals calculate correctly",
    );
    change(nw, input, "12abc", "input");
    assert(
      input.getAttribute("aria-invalid") === "true",
      "Trailing text is rejected",
    );
    change(nw, input, "", "input");
    assert(
      !input.hasAttribute("aria-invalid"),
      "Empty input clears invalid state",
    );
    change(nw, input, "14", "input");
    const fileInput = nd.getElementById("grades-import-file");
    async function importData(data) {
      const transfer = new nw.DataTransfer();
      transfer.items.add(
        new nw.File([JSON.stringify(data)], "grades.json", {
          type: "application/json",
        }),
      );
      fileInput.files = transfer.files;
      const Reader = nw.FileReader;
      await new Promise((resolve) => {
        nw.FileReader = class extends Reader {
          constructor() {
            super();
            this.addEventListener("loadend", resolve, { once: true });
          }
        };
        fileInput.dispatchEvent(new nw.Event("change", { bubbles: true }));
      });
      nw.FileReader = Reader;
    }
    let confirmations = 0;
    nw.confirm = () => {
      confirmations++;
      return true;
    };
    await importData({ format: "but3-grades", version: 1, class: "b3cya" });
    assert(
      input.value === "14" && confirmations === 0,
      "Malformed import preserves existing grades",
    );
    await importData({
      format: "but3-grades",
      version: 1,
      class: "b3cya",
      grades: { R501: "12abc" },
    });
    assert(input.value === "14", "Entirely invalid import preserves grades");
    nw.confirm = () => false;
    await importData({
      format: "but3-grades",
      version: 1,
      class: "b3cya",
      grades: { R501: "16,5" },
    });
    assert(input.value === "14", "Cancelled import preserves grades");
    nw.confirm = () => true;
    await importData({
      format: "but3-grades",
      version: 1,
      class: "b3cya",
      grades: { R501: "16,5" },
    });
    assert(
      input.value === "16.5",
      "Confirmed import accepts French decimals: " +
        input.value +
        " / " +
        nd.getElementById("grades-message").textContent,
    );
    change(nw, input, "10", "input");
    change(nw, nd.querySelector('[data-module="R502"]'), "20", "input");
    assert(
      nd.getElementById("avg-s5").textContent === "15.28",
      "Semester weighted averages are preserved",
    );
    assert(
      nd.getElementById("global-annual-avg").textContent === "15.28",
      "Annual weighted averages are preserved",
    );
    let exportedBlob;
    nw.URL.createObjectURL = (blob) => {
      exportedBlob = blob;
      return "blob:test";
    };
    nw.URL.revokeObjectURL = () => {};
    nw.HTMLAnchorElement.prototype.click = function () {};
    nd.getElementById("grades-export-btn").click();
    const exported = JSON.parse(await exportedBlob.text());
    assert(
      exported.format === "but3-grades" &&
        exported.version === 1 &&
        exported.grades.R501 === 10 &&
        exported.grades.R502 === 20,
      "Export stays compatible with existing files",
    );
    change(nw, input, "16.5", "input");
    const semester = nd.querySelector(".semester-toggle-btn");
    semester.click();
    assert(
      nd.querySelector(".subject-row").hidden &&
        !nd.querySelector(".grades-table").hidden,
      "Semester collapse keeps average visible",
    );
    const gradesStoragePrototype = nw.Storage.prototype;
    const originalGradeSetItem = gradesStoragePrototype.setItem;
    const originalGradeRemoveItem = gradesStoragePrototype.removeItem;
    gradesStoragePrototype.setItem = function () {
      throw new Error("unavailable");
    };
    await importData({
      format: "but3-grades",
      version: 1,
      class: "b3cya",
      grades: { R501: 18 },
    });
    gradesStoragePrototype.setItem = originalGradeSetItem;
    assert(
      input.value === "16.5" &&
        nd.getElementById("grades-message").getAttribute("role") === "alert",
      "Grade import storage failure preserves displayed notes",
    );
    gradesStoragePrototype.removeItem = function () {
      throw new Error("unavailable");
    };
    nd.getElementById("grades-reset-btn").click();
    gradesStoragePrototype.removeItem = originalGradeRemoveItem;
    assert(
      input.value === "16.5" &&
        nd.getElementById("grades-message").getAttribute("role") === "alert",
      "Grade clear storage failure preserves displayed notes",
    );
    notes.remove();
    const restored = await frame("classes/b3cya/notes.html");
    assert(
      restored.contentDocument.querySelector(".grade-input").value === "16.5",
      "Existing storage key restores grades",
    );
    restored.remove();
    localStorage.setItem("grades_b3cya", "{broken");
    const brokenGrades = await frame("classes/b3cya/notes.html");
    assert(
      brokenGrades.contentDocument
        .getElementById("grades-message")
        .textContent.includes("illisibles") &&
        localStorage.getItem("grades_b3cya") === "{broken",
      "Unreadable stored grades remain available for explicit recovery",
    );
    change(
      brokenGrades.contentWindow,
      brokenGrades.contentDocument.querySelector(".grade-input"),
      "14",
      "input",
    );
    assert(
      localStorage.getItem("grades_b3cya") === "{broken",
      "Typing cannot overwrite corrupt grade storage",
    );
    brokenGrades.contentWindow.confirm = () => true;
    brokenGrades.contentDocument.getElementById("grades-reset-btn").click();
    assert(
      localStorage.getItem("grades_b3cya") === null,
      "Explicit reset recovers corrupt grade storage",
    );
    brokenGrades.remove();
    const partiallyInvalid = JSON.stringify({ R501: 16.5, R502: "bad" });
    localStorage.setItem("grades_b3cya", partiallyInvalid);
    const partialRestore = await frame("classes/b3cya/notes.html");
    assert(
      partialRestore.contentDocument.querySelector(".grade-input").value ===
        "16.5",
      "Readable grades remain visible when another stored field is invalid",
    );
    change(
      partialRestore.contentWindow,
      partialRestore.contentDocument.querySelector(".grade-input"),
      "18",
      "input",
    );
    assert(
      localStorage.getItem("grades_b3cya") === partiallyInvalid,
      "Partially invalid grade storage cannot be silently normalized and overwritten",
    );
    partialRestore.remove();
    localStorage.removeItem("grades_b3cya");
    const writer = await frame("classes/b3cya/notes.html");
    const observer = await frame("classes/b3cya/notes.html");
    const writerInput = writer.contentDocument.querySelector(".grade-input");
    change(writer.contentWindow, writerInput, "13", "input");
    const saved = localStorage.getItem("grades_b3cya");
    change(
      observer.contentWindow,
      observer.contentDocument.querySelector(".grade-input"),
      "18",
      "input",
    );
    observer.contentWindow.confirm = () => true;
    observer.contentDocument.getElementById("grades-reset-btn").click();
    assert(
      localStorage.getItem("grades_b3cya") === saved,
      "A second editor cannot overwrite or clear the active editor's grades",
    );
    const secondInput =
      writer.contentDocument.querySelectorAll(".grade-input")[1];
    change(writer.contentWindow, writerInput, "13abc", "input");
    change(writer.contentWindow, secondInput, "17", "input");
    const partial = JSON.parse(localStorage.getItem("grades_b3cya"));
    assert(
      partial[writerInput.dataset.module] === 13 &&
        partial[secondInput.dataset.module] === 17,
      "Valid grades persist while an invalid field retains its last saved value",
    );
    writer.remove();
    observer.remove();
    const nextWriter = await frame("classes/b3cya/notes.html");
    change(
      nextWriter.contentWindow,
      nextWriter.contentDocument.querySelector(".grade-input"),
      "19",
      "input",
    );
    assert(
      JSON.parse(localStorage.getItem("grades_b3cya"))[
        writerInput.dataset.module
      ] === 19,
      "Closing the active editor releases its write access",
    );
    nextWriter.remove();
    localStorage.setItem("grades_b3cya", JSON.stringify({ R501: 16.5 }));

    const calendar = await frame(
      "classes/b3cya/calendar.html#view=week&date=2026-09-08&now=2026-09-08T09:00",
    );
    const cd = calendar.contentDocument,
      cw = calendar.contentWindow;
    assert(
      cd.querySelector(".current-time-text").textContent === "09:00",
      "Simulated time marker works",
    );
    const compare = cd.getElementById("cal-compare-select");
    const pending = {};
    cw.fetch = (url) =>
      new Promise((resolve) => {
        pending[url] = resolve;
      });
    change(cw, compare, "b3cyb");
    change(cw, compare, "b3dcc");
    pending["../../data/b3dcc.json"]({
      ok: true,
      json: () =>
        Promise.resolve({
          class: "b3dcc",
          events: [
            {
              start: "2026-09-08T10:00:00+02:00",
              end: "2026-09-08T11:00:00+02:00",
              title: "Current",
              slug: "current",
              module: "R501",
              category: null,
              rooms: [],
              teachers: [],
              staff_markers: [],
              groups: [],
              flags: [],
            },
          ],
        }),
    });
    await pause();
    assert(
      cd
        .querySelector("#day-section-2026-09-08 .cal-summary-compared")
        .textContent.includes("10:00"),
      "Latest comparison is displayed",
    );
    pending["../../data/b3cyb.json"]({
      ok: true,
      json: () =>
        Promise.resolve({
          class: "b3cyb",
          events: [
            {
              start: "2026-09-08T18:00:00+02:00",
              end: "2026-09-08T19:00:00+02:00",
              title: "Stale",
              slug: "stale",
              module: "R501",
              category: null,
              rooms: [],
              teachers: [],
              staff_markers: [],
              groups: [],
              flags: [],
            },
          ],
        }),
    });
    await pause();
    assert(
      cd
        .querySelector("#day-section-2026-09-08 .cal-summary-compared")
        .textContent.includes("10:00") &&
        !cd
          .querySelector("#day-section-2026-09-08 .cal-summary-compared")
          .textContent.includes("18:00"),
      "Stale comparison cannot overwrite current selection",
    );
    change(cw, compare, "b3cy1");
    pending["../../data/b3cy1.json"]({
      ok: true,
      json: () =>
        Promise.resolve({
          class: "b3cy1",
          events: [{ start: "2026-02-30T10:00:00+02:00" }],
        }),
    });
    await pause();
    assert(
      !cd.getElementById("calendar-message").hidden &&
        cd.getElementById("calendar-message").dataset.error === "format",
      "Invalid comparison data is rejected before rendering",
    );
    change(cw, compare, "");
    change(cw, cd.getElementById("cal-view-select"), "year");
    assert(
      cd.querySelectorAll(".calendar-event-item").length === 3,
      "Annual view shares day preparation",
    );
    calendar.remove();
    const malformed = await frame("classes/b3cya/calendar.html#search=%");
    assert(
      malformed.contentDocument.getElementById("cal-results-count").textContent
        .length > 0,
      "Malformed hash still initializes calendar",
    );
    malformed.remove();
    sessionStorage.removeItem("calendar_settings");
    const custom = await frame(
      "custom/classes/b3cya/calendar.html#date=2026-09-08",
    );
    const ud = custom.contentDocument,
      uw = custom.contentWindow;
    assert(
      ud.getElementById("cal-view-select").value === "day",
      "Configured default view is used",
    );
    change(uw, ud.getElementById("cal-view-select"), "week");
    assert(
      ud.querySelectorAll(".day-section").length === 7,
      "Configured weekend days are rendered",
    );
    custom.remove();
    const nojs = await frame("classes/b3cya/no-js.html");
    assert(
      nojs.contentWindow.getComputedStyle(
        nojs.contentDocument.querySelector(".nav-menu"),
      ).display !== "none",
      "Mobile navigation remains visible without JavaScript",
    );
    nojs.remove();
    const filters = await frame("classes/b3cya/evaluations.html#period=all");
    const fd = filters.contentDocument,
      fw = filters.contentWindow;
    const row = fd.querySelector(".eval-row");
    row.dataset.endTimestamp = String((Date.now() - 1000) / 1000);
    fd.dispatchEvent(new fw.Event("visibilitychange"));
    assert(
      row.dataset.past === "true" && !row.querySelector(".badge-past").hidden,
      "Past status updates without rebuilding",
    );
    filters.remove();
    assert(errors.length === 0, "No browser errors: " + errors.join(", "));
    document.body.textContent = JSON.stringify({
      checks: results.length,
      results,
    });
    document.documentElement.dataset.testResult = "passed";
  } catch (error) {
    document.body.textContent = JSON.stringify({
      error: error.stack,
      results,
      errors,
    });
    document.documentElement.dataset.testResult = "failed";
  }
})();

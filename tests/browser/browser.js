(async function () {
  const { results, errors, pause, assert, frame, change } =
    BrowserTest.create();
  try {
    for (const width of [320, 390, 768, 959, 960, 1440]) {
      for (const page of [
        "index.html#view=week&date=2026-09-08",
        "notes.html",
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
          const sidebar = d.getElementById("app-sidebar");
          d.querySelector(".nav-burger").click();
          assert(
            w.getComputedStyle(sidebar).display === "flex" &&
              !d.querySelector(".app-backdrop").hidden,
            "Mobile menu opens the navigation drawer: " + width,
          );
          d.querySelector(".nav-close").click();
          assert(
            w.getComputedStyle(sidebar).display === "none" &&
              d.querySelector(".app-backdrop").hidden,
            "Mobile menu closes the navigation drawer: " + width,
          );
          const filtersToggle = d.querySelector(".filters-toggle");
          if (filtersToggle) {
            const panel = d.getElementById(
              filtersToggle.getAttribute("aria-controls"),
            );
            filtersToggle.click();
            assert(
              w.getComputedStyle(panel).position === "fixed" &&
                d.documentElement.scrollWidth <= width,
              "Mobile filters open in a sheet: " + page + " at " + width,
            );
            panel.querySelector(".sheet-close").click();
            assert(
              w.getComputedStyle(panel).display === "none",
              "Mobile filter sheet closes: " + page + " at " + width,
            );
          }
        }
        if (page.startsWith("evaluations")) {
          const period = d.getElementById("filter-period");
          change(w, period, "upcoming");
          assert(
            Array.from(d.querySelectorAll(".month-card:not([hidden])")).every(
              (card) =>
                Number(card.querySelector(".data-box-meta").textContent) ===
                card.querySelectorAll(".eval-row:not([hidden])").length,
            ),
            "Month counters follow the filters: " + width,
          );
          change(w, period, "all");
        }
        assert(!w.injected, "Embedded event text is inert: " + page);
        f.remove();
      }
    }
    for (const [width, expected] of [
      [320, "day"],
      [960, "week"],
    ]) {
      sessionStorage.removeItem("calendar_settings");
      const cal = await frame("classes/b3cya/index.html", width);
      assert(
        cal.contentDocument.getElementById("cal-view-select").value ===
          expected,
        "Default calendar view per viewport: " + width,
      );
      cal.remove();
    }
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
      nd.getElementById("synth-annual-ue1").textContent === "",
      "A unit annual average waits for both semesters",
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
        exported.version === 2 &&
        exported.detail === undefined &&
        exported.grades.R501 === 10 &&
        exported.grades.R502 === 20,
      "Export stays compatible with existing files",
    );
    change(nw, input, "16.5", "input");
    const semester = nd.querySelector(".semester-toggle-btn");
    semester.click();
    assert(
      nd.querySelector("#semester-section-s5 .table-card").hidden &&
        /^\d+\.\d{2}$/.test(nd.getElementById("avg-s5").textContent),
      "Collapsed semester keeps its average in the summary",
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
      "classes/b3cya/index.html#view=week&date=2026-09-08&now=2026-09-08T09:00",
    );
    const cd = calendar.contentDocument,
      cw = calendar.contentWindow;
    assert(
      cd
        .querySelector(".has-filter-bar")
        .classList.contains("is-layout-ready") &&
        cw.getComputedStyle(cd.querySelector(".section-main")).visibility ===
          "visible",
      "Calendar layout is revealed only after initialization",
    );
    assert(
      cd.querySelector(".current-time-text").textContent === "09:00",
      "Simulated time marker works",
    );
    assert(
      cd
        .querySelector("#day-section-2026-09-08")
        .classList.contains("is-today"),
      "Current day is identified in week view",
    );
    change(cw, cd.getElementById("cal-view-select"), "year");
    assert(
      cd.querySelectorAll(".calendar-event-item").length === 0 &&
        cd.querySelectorAll("a.year-day").length > 0,
      "Annual view shows the year as days without listing courses",
    );
    assert(
      cd.querySelector("a.year-day.is-today").textContent === "8" &&
        /load-[1-9]/.test(cd.querySelector("a.year-day.is-today").className),
      "Current day is identified and weighted in year view",
    );
    const evalsOnly = cd.getElementById("cal-evals-only");
    evalsOnly.checked = true;
    evalsOnly.dispatchEvent(new cw.Event("change", { bubbles: true }));
    assert(
      cd.querySelectorAll(".year-results .calendar-event-item").length ===
        Number(cd.querySelector(".year-results .data-box-meta").textContent) &&
        cd.querySelectorAll("a.year-day").length ===
          cd.querySelectorAll(".year-results .day-section").length,
      "Filtered annual view lists the matching courses beside their days",
    );
    evalsOnly.checked = false;
    evalsOnly.dispatchEvent(new cw.Event("change", { bubbles: true }));
    cd.querySelector("a.year-day.is-today").click();
    await pause();
    assert(
      cd.getElementById("cal-view-select").value === "day" &&
        cd.querySelector("#day-section-2026-09-08") !== null,
      "A day of the annual view opens that day",
    );
    change(cw, cd.getElementById("cal-view-select"), "day");
    assert(
      !cd
        .querySelector("#day-section-2026-09-08")
        .classList.contains("is-today"),
      "Current day is not highlighted in day view",
    );
    calendar.remove();
    const dayGrid = await frame(
      "classes/b3cya/index.html#view=day&layout=grid&date=2026-09-08&now=2026-09-08T06:00",
      1280,
    );
    const gridItems = Array.from(
      dayGrid.contentDocument.querySelectorAll(".is-grid .calendar-event-item"),
    );
    const earlyMarker = dayGrid.contentDocument.getElementById(
      "current-time-marker",
    );
    assert(
      !earlyMarker.classList.contains("is-line") &&
        earlyMarker.textContent === "06:00" &&
        earlyMarker.getBoundingClientRect().bottom <=
          gridItems[0].getBoundingClientRect().top,
      "Before the first hour, the time marker sits above the grid with its time",
    );
    assert(
      gridItems.length > 0 &&
        gridItems.every(
          (item) =>
            item.querySelector(".event-summary") &&
            item.querySelector(".event-card"),
        ),
      "Day grid shows course blocks with their detail card",
    );
    gridItems[0].click();
    const pinnedCard = gridItems[0]
      .querySelector(".event-card")
      .getBoundingClientRect();
    const pinnedBlock = gridItems[0].getBoundingClientRect();
    assert(
      gridItems[0].classList.contains("is-pinned") &&
        pinnedCard.width > 100 &&
        pinnedCard.left >= pinnedBlock.left &&
        pinnedCard.right <= pinnedBlock.right,
      "Clicking a day grid block opens its detail card inside the block",
    );
    dayGrid.remove();
    const malformed = await frame("classes/b3cya/index.html#search=%");
    assert(
      malformed.contentDocument.getElementById("cal-results-count").textContent
        .length > 0,
      "Malformed hash still initializes calendar",
    );
    malformed.remove();
    sessionStorage.removeItem("calendar_settings");
    const custom = await frame(
      "custom/classes/b3cya/index.html#date=2026-09-08",
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
    assert(
      nojs.contentWindow.getComputedStyle(
        nojs.contentDocument.querySelector(".section-main"),
      ).visibility === "visible",
      "Calendar content remains visible without JavaScript",
    );
    nojs.remove();
    const filters = await frame("classes/b3cya/evaluations.html#period=all");
    const fd = filters.contentDocument,
      fw = filters.contentWindow;
    assert(
      fd
        .querySelector(".has-filter-bar")
        .classList.contains("is-layout-ready") &&
        fw.getComputedStyle(fd.querySelector(".section-main")).visibility ===
          "visible",
      "Evaluation layout is revealed only after initialization",
    );
    const row = fd.querySelector(".eval-row");
    const delayShown = (item) =>
      fw.getComputedStyle(item.querySelector(".eval-delay")).display !== "none";
    row.dataset.endTimestamp = String((Date.now() + 86400000) / 1000);
    fd.dispatchEvent(new fw.Event("visibilitychange"));
    assert(
      row.classList.contains("is-next") &&
        Array.from(fd.querySelectorAll(".eval-row")).every(
          (item) => delayShown(item) === (item === row),
        ),
      "Only the next evaluation shows its delay",
    );
    row.dataset.endTimestamp = String((Date.now() - 1000) / 1000);
    fd.dispatchEvent(new fw.Event("visibilitychange"));
    assert(
      row.dataset.past === "true" && !delayShown(row),
      "Past status updates without rebuilding",
    );
    filters.remove();
    const settings = await frame("classes/b3cya/reglages.html", 1440);
    const sd = settings.contentDocument;
    const themed = (doc) => doc.documentElement.dataset.theme || "";
    const pressed = () =>
      sd.querySelector("[data-theme-choice] [aria-pressed='true']");
    const [seasonalChoice, classicChoice, ...themeChoices] =
      sd.querySelectorAll("[data-theme-choice] [data-value]");
    const seasonalTheme = themed(sd);
    const chosenTheme = themeChoices[themeChoices.length - 1];
    assert(pressed() === seasonalChoice, "Theme follows the season by default");
    chosenTheme.click();
    assert(
      pressed() === chosenTheme && themed(sd) === chosenTheme.dataset.value,
      "Choosing a theme applies it at once",
    );
    const elsewhere = await frame("classes/b3cya/a-savoir.html", 1440);
    assert(
      themed(elsewhere.contentDocument) === chosenTheme.dataset.value &&
        elsewhere.contentWindow.getComputedStyle(
          elsewhere.contentDocument.getElementById("app-sidebar"),
          "::before",
        ).content !== "none",
      "The chosen theme is applied on the other pages",
    );
    elsewhere.remove();
    classicChoice.click();
    const sidebarCover = () =>
      settings.contentWindow.getComputedStyle(
        sd.getElementById("app-sidebar"),
        "::before",
      ).content;
    assert(
      pressed() === classicChoice &&
        themed(sd) === "" &&
        sidebarCover() === "none",
      "The classic choice removes every theme",
    );
    const accentRow = sd.querySelector(".accent-setting");
    const accentChoices = Array.from(
      sd.querySelectorAll("[data-accent-choice] [data-value]"),
    );
    const highlight = () =>
      settings.contentWindow
        .getComputedStyle(sd.documentElement)
        .getPropertyValue("--color-highlight");
    const defaultHighlight = highlight();
    accentChoices[1].click();
    assert(
      settings.contentWindow.getComputedStyle(accentRow).display !== "none" &&
        sd.documentElement.dataset.accent === accentChoices[1].dataset.value &&
        accentChoices[1].getAttribute("aria-pressed") === "true" &&
        highlight() !== defaultHighlight,
      "Choosing a colour changes the accent of the classic theme",
    );
    chosenTheme.click();
    assert(
      settings.contentWindow.getComputedStyle(accentRow).display === "none",
      "The colour choice is hidden while a theme is applied",
    );
    accentChoices[0].click();
    assert(
      !("accent" in sd.documentElement.dataset),
      "The default colour leaves no mark",
    );
    seasonalChoice.click();
    assert(
      pressed() === seasonalChoice && themed(sd) === seasonalTheme,
      "The seasonal choice restores the theme of the day",
    );
    settings.remove();
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

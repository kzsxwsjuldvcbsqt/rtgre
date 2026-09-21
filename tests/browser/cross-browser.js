(async function () {
  const { errors, pause, assert, frame, change } = BrowserTest.create();
  try {
    const expectedTheme = new URLSearchParams(location.search).get("theme");
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    if ((expectedTheme === "dark") !== dark) {
      throw new Error("Color scheme preference was not applied");
    }
    for (const width of [320, 390, 768, 959, 960, 1440]) {
      for (const page of [
        "calendar.html",
        "notes.html",
        "a-faire.html",
        "absences.html",
      ]) {
        const current = await frame(
          "classes/" +
            (page === "absences.html" ? "b3cy1" : "b3cya") +
            "/" +
            page,
          width,
        );
        if (current.contentDocument.documentElement.scrollWidth > width) {
          throw new Error("Horizontal overflow on " + page);
        }
        if (!current.contentDocument.body.classList.contains("js-ready")) {
          throw new Error("Initialization failed on " + page);
        }
        current.remove();
      }
    }
    const notes = await frame("classes/b3cya/notes.html", 390);
    const input = notes.contentDocument.querySelector(".grade-input");
    input.value = "12,5";
    input.focus();
    input.dispatchEvent(
      new notes.contentWindow.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    if (
      notes.contentDocument.activeElement === input ||
      input.value !== "12,5"
    ) {
      throw new Error("Shared keyboard contract failed");
    }
    notes.remove();
    await runAbsenceBrowserTests({ frame, assert, change, pause });
    if (errors.length) throw new Error(errors.join(", "));
    document.documentElement.dataset.testResult = "passed";
  } catch (error) {
    document.body.textContent = JSON.stringify({ error: error.stack, errors });
    document.documentElement.dataset.testResult = "failed";
  }
})();

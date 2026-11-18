(function () {
  const settings = document.currentScript.dataset;

  function remember(key, value) {
    AppUtils.safeStorageSet(key, value ? "1" : "0", true);
  }

  function initCollapsibleSemesters() {
    document.querySelectorAll(".semester-section").forEach(function (section) {
      const table = section.querySelector(".grades-table");
      const button = section.querySelector(".heading-toggle-btn");
      if (!table || !button) return;
      const arrow = button.querySelector(".toggle-arrow");
      const card = section.querySelector(".table-card");
      const key =
        "sem_collapsed_" + settings.classId + "_" + table.dataset.semester;

      function setCollapsed(collapsed) {
        card.hidden = collapsed;
        button.setAttribute("aria-expanded", collapsed ? "false" : "true");
        if (arrow) arrow.classList.toggle("is-collapsed", collapsed);
      }

      if (AppUtils.safeStorageGet(key, true) === "1") setCollapsed(true);
      button.addEventListener("click", function () {
        const collapsed = !card.hidden;
        setCollapsed(collapsed);
        remember(key, collapsed);
      });
    });
  }

  function initCoefficientToggle() {
    const page = document.getElementById("grades-page");
    const toggle = document.getElementById("grades-coef-toggle");
    if (!page || !toggle) return;
    const key = "coefs_visible_" + settings.classId;

    function setVisible(visible) {
      toggle.checked = visible;
      page.classList.toggle("show-coefs", visible);
    }

    const saved = AppUtils.safeStorageGet(key, true);
    setVisible(
      saved === null
        ? !window.matchMedia(settings.mobileQuery).matches
        : saved === "1",
    );
    toggle.addEventListener("change", function () {
      setVisible(toggle.checked);
      remember(key, toggle.checked);
    });
  }

  function initRowFocus() {
    document.querySelectorAll(".grades-table tbody").forEach(function (body) {
      body.addEventListener("click", function (event) {
        if (event.target.closest("input, button, a")) return;
        const row = event.target.closest("tr");
        const input = row && row.querySelector(".grade-input:not([hidden])");
        if (input) input.focus();
      });
    });
  }

  function initSummaryToggle() {
    const toggle = document.getElementById("grades-panel-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", function () {
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.closest(".grades-panel").classList.toggle("is-expanded", expanded);
    });
  }

  AppUtils.onDOMReady(function () {
    initCollapsibleSemesters();
    initCoefficientToggle();
    initRowFocus();
    initSummaryToggle();
  });
})();

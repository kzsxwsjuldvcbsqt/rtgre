document.addEventListener("DOMContentLoaded", function () {
  const container = document.getElementById("filters-container");
  if (!container) return;

  const dataset = container.dataset;
  const categories = JSON.parse(dataset.categories || "[]");
  const modules = JSON.parse(dataset.modules || "[]");

  const labelCategory = dataset.labelCategory;
  const labelModule = dataset.labelModule;
  const labelPeriod = dataset.labelPeriod;
  const labelReset = dataset.labelReset;
  const labelSingular = dataset.labelSingular;
  const labelPlural = dataset.labelPlural;
  const labelUpcoming = dataset.labelUpcoming;
  const labelPast = dataset.labelPast;
  const labelAll = dataset.labelAll;

  const STORAGE_KEY = "schedule_filters_state";

  const form = document.createElement("form");
  form.className = "filter-form";
  form.addEventListener("submit", function (e) {
    e.preventDefault();
  });

  const scrollGroup = document.createElement("div");
  scrollGroup.className = "filter-group filter-group-scroll";
  scrollGroup.id = "eval-filters-scroll";

  const periodItem = document.createElement("div");
  periodItem.className = "filter-group-item";

  const periodSelect = document.createElement("select");
  periodSelect.id = "filter-period";
  periodSelect.setAttribute("aria-label", labelPeriod);

  const periodOptGroup = document.createElement("optgroup");
  periodOptGroup.label = labelPeriod;

  const periods = [
    { value: "upcoming", label: labelUpcoming },
    { value: "past", label: labelPast },
    { value: "all", label: labelAll },
  ];

  periods.forEach(function (p) {
    const opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    periodOptGroup.appendChild(opt);
  });
  periodSelect.appendChild(periodOptGroup);
  periodItem.appendChild(periodSelect);
  scrollGroup.appendChild(periodItem);

  if (modules.length > 0) {
    const modItem = document.createElement("div");
    modItem.className = "filter-group-item";

    const modSelect = document.createElement("select");
    modSelect.id = "filter-module";
    modSelect.setAttribute("aria-label", labelModule);

    const modOptGroup = document.createElement("optgroup");
    modOptGroup.label = labelModule;

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = labelAll;
    modOptGroup.appendChild(defaultOpt);

    modules.forEach(function (mod) {
      const opt = document.createElement("option");
      opt.value = mod;
      opt.textContent = mod;
      modOptGroup.appendChild(opt);
    });
    modSelect.appendChild(modOptGroup);
    modItem.appendChild(modSelect);
    scrollGroup.appendChild(modItem);
  }

  if (categories.length > 0) {
    categories.forEach(function (cat) {
      const lbl = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = "category";
      cb.value = cat.id;
      cb.checked = true;
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(" " + cat.label));
      scrollGroup.appendChild(lbl);
    });
  }

  form.appendChild(scrollGroup);

  const resetGroup = document.createElement("div");
  resetGroup.className = "filter-group filter-group-reset";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.id = "filter-reset";
  resetBtn.textContent = labelReset;
  resetGroup.appendChild(resetBtn);
  form.appendChild(resetGroup);

  const countDiv = document.createElement("div");
  countDiv.className = "results-count";
  countDiv.id = "results-count";
  form.appendChild(countDiv);

  container.appendChild(form);

  const filterPeriodSelect = form.querySelector("#filter-period");
  const moduleSelect = form.querySelector("#filter-module");
  const resetButton = form.querySelector("#filter-reset");
  const resultsCountDiv = form.querySelector("#results-count");
  const emptyStateMsg = document.getElementById("empty-state-message");
  const evaluationsList = document.getElementById("evaluations-list");

  function getStoredState() {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      return null;
    }
    return null;
  }

  function setStoredState(state) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function removeStoredState() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function applyStateObject(state) {
    if (!state) return;

    if (state.period !== undefined && filterPeriodSelect) {
      if (["upcoming", "past", "all"].includes(state.period)) {
        filterPeriodSelect.value = state.period;
      } else {
        filterPeriodSelect.value = "upcoming";
      }
    }

    if (state.mod !== undefined && moduleSelect) {
      if (modules.includes(state.mod)) {
        moduleSelect.value = state.mod;
      } else {
        moduleSelect.value = "";
      }
    }

    if (state.cat !== undefined) {
      const deselectedCats = Array.isArray(state.cat)
        ? state.cat
        : typeof state.cat === "string" && state.cat
          ? state.cat.split(",")
          : [];
      const checkboxes = form.querySelectorAll('input[name="category"]');
      checkboxes.forEach(function (cb) {
        cb.checked = !deselectedCats.includes(cb.value);
      });
    }
  }

  function restoreFilters() {
    const hasHash = window.location.hash && window.location.hash.length > 1;

    if (hasHash) {
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const hashState = {};

      if (params.has("period")) hashState.period = params.get("period");
      if (params.has("mod")) hashState.mod = params.get("mod");
      if (params.has("cat")) hashState.cat = params.get("cat").split(",");

      applyStateObject(hashState);
    } else {
      const stored = getStoredState();
      if (stored) {
        applyStateObject(stored);
      }
    }
  }

  function persistFiltersAndHash() {
    const period = filterPeriodSelect ? filterPeriodSelect.value : "upcoming";
    const mod = moduleSelect ? moduleSelect.value : "";

    const catCheckboxes = form.querySelectorAll('input[name="category"]');
    const deselectedCats = [];
    catCheckboxes.forEach(function (cb) {
      if (!cb.checked) deselectedCats.push(cb.value);
    });

    const stateObj = {
      period: period,
      mod: mod,
      cat: deselectedCats,
    };

    setStoredState(stateObj);

    const params = new URLSearchParams();
    if (period && period !== "upcoming") params.set("period", period);
    if (mod) params.set("mod", mod);

    if (deselectedCats.length > 0) {
      params.set("cat", deselectedCats.join(","));
    }

    const hashStr = params.toString();
    if (hashStr) {
      history.replaceState(null, "", "#" + hashStr);
    } else {
      history.replaceState(null, "", window.location.pathname);
    }
  }

  const rows = Array.from(document.querySelectorAll(".eval-row"));

  function applyFilters() {
    const selectedPeriod = filterPeriodSelect
      ? filterPeriodSelect.value
      : "upcoming";
    const selectedModule = moduleSelect ? moduleSelect.value : "";

    const catCheckboxes = form.querySelectorAll('input[name="category"]');
    const selectedCats = [];
    catCheckboxes.forEach(function (cb) {
      if (cb.checked) selectedCats.push(cb.value);
    });

    let visibleCount = 0;

    rows.forEach(function (row) {
      const cat = row.dataset.category;
      const mod = row.dataset.module;
      const isPast = row.dataset.past === "true";

      let matches = true;

      if (catCheckboxes.length > 0 && !selectedCats.includes(cat))
        matches = false;
      if (selectedModule && mod !== selectedModule) matches = false;

      if (selectedPeriod === "upcoming" && isPast) matches = false;
      if (selectedPeriod === "past" && !isPast) matches = false;

      if (matches) {
        row.removeAttribute("hidden");
        visibleCount++;
      } else {
        row.setAttribute("hidden", "");
      }
    });

    const monthCards = document.querySelectorAll(".month-card");
    monthCards.forEach(function (card) {
      if (card.querySelector(".eval-row:not([hidden])")) {
        card.removeAttribute("hidden");
      } else {
        card.setAttribute("hidden", "");
      }
    });

    if (visibleCount === 0) {
      if (evaluationsList) evaluationsList.setAttribute("hidden", "");
      if (emptyStateMsg) emptyStateMsg.removeAttribute("hidden");
    } else {
      if (evaluationsList) evaluationsList.removeAttribute("hidden");
      if (emptyStateMsg) emptyStateMsg.setAttribute("hidden", "");
    }

    const countLabel = visibleCount < 2 ? labelSingular : labelPlural;
    if (resultsCountDiv) {
      resultsCountDiv.textContent = visibleCount + " " + countLabel;
    }

    persistFiltersAndHash();
  }

  restoreFilters();
  applyFilters();

  form.addEventListener("change", applyFilters);
  document.addEventListener("evaluations-time-change", applyFilters);
  window.addEventListener("hashchange", function () {
    restoreFilters();
    applyFilters();
  });

  if (resetButton) {
    resetButton.addEventListener("click", function () {
      if (filterPeriodSelect) filterPeriodSelect.value = "upcoming";
      if (moduleSelect) moduleSelect.value = "";

      const checkboxes = form.querySelectorAll('input[name="category"]');
      checkboxes.forEach(function (cb) {
        cb.checked = true;
      });

      removeStoredState();
      applyFilters();
    });
  }
});

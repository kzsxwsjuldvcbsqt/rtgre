AppUtils.onDOMReady(function () {
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

  const STORAGE_KEY = "evaluation_filters";

  const form = document.createElement("form");
  form.className = "filter-form";
  form.addEventListener("submit", function (e) {
    e.preventDefault();
  });

  const scrollGroup = document.createElement("div");
  scrollGroup.className = "filter-group filter-group-scroll";
  scrollGroup.id = "eval-filters-scroll";

  function makeFieldTitle(text) {
    const title = document.createElement("span");
    title.className = "filter-field-title";
    title.setAttribute("aria-hidden", "true");
    title.textContent = text;
    return title;
  }

  const periodItem = document.createElement("div");
  periodItem.className = "filter-group-item";

  const periodSelect = document.createElement("select");
  periodSelect.id = "filter-period";
  periodSelect.dataset.control = "segmented";
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
  periodItem.appendChild(makeFieldTitle(labelPeriod));
  periodItem.appendChild(periodSelect);

  if (modules.length > 0) {
    const modItem = document.createElement("div");
    modItem.className = "filter-group-item";

    const modSelect = document.createElement("select");
    modSelect.id = "filter-module";
    modSelect.dataset.control = "menu";
    modSelect.dataset.searchLabel = dataset.labelModuleSearch;
    modSelect.dataset.emptyLabel = dataset.labelModuleEmpty;
    modSelect.setAttribute("aria-label", labelModule);

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = dataset.labelModuleAll;
    modSelect.appendChild(defaultOpt);

    const modGroups = new Map();
    modules.forEach(function (mod) {
      if (!modGroups.has(mod.group)) {
        const group = document.createElement("optgroup");
        group.label = mod.group || labelModule;
        modGroups.set(mod.group, group);
        modSelect.appendChild(group);
      }
      const opt = document.createElement("option");
      opt.value = mod.code;
      opt.dataset.code = mod.code;
      opt.dataset.label = mod.label;
      opt.textContent = mod.label
        ? mod.code + dataset.labelModuleSeparator + mod.label
        : mod.code;
      modGroups.get(mod.group).appendChild(opt);
    });
    modItem.appendChild(makeFieldTitle(labelModule));
    modItem.appendChild(modSelect);
    scrollGroup.appendChild(modItem);
  }
  scrollGroup.appendChild(periodItem);

  if (categories.length > 0) {
    scrollGroup.appendChild(makeFieldTitle(labelCategory));
    categories.forEach(function (cat) {
      const lbl = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = "category";
      cb.value = cat.id;
      lbl.appendChild(cb);
      lbl.appendChild(AppUtils.buildIcon(dataset.iconCheck, "icon-sm"));
      const name = document.createElement("span");
      name.className = cat.tone
        ? "filter-tone label-" + cat.tone
        : "filter-tone";
      name.textContent = cat.label;
      lbl.appendChild(name);
      scrollGroup.appendChild(lbl);
    });
  }

  form.appendChild(scrollGroup);

  const resetGroup = document.createElement("div");
  resetGroup.className = "filter-group filter-group-reset";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.id = "filter-reset";
  resetBtn.hidden = true;
  resetBtn.appendChild(AppUtils.buildIcon(dataset.iconReset, "icon-sm"));
  const resetLabel = document.createElement("span");
  resetLabel.className = "reset-label";
  resetLabel.textContent = labelReset;
  resetBtn.appendChild(resetLabel);
  resetBtn.setAttribute("aria-label", labelReset);
  resetBtn.dataset.shortcut = dataset.hintReset;
  resetGroup.appendChild(resetBtn);
  const shortcuts = {};
  shortcuts[dataset.keyReset] = function () {
    return AppUtils.press(resetBtn);
  };
  AppUtils.bindShortcuts(shortcuts);
  form.appendChild(resetGroup);

  const countDiv = document.createElement("div");
  countDiv.className = "results-count";
  countDiv.id = "results-count";
  countDiv.dataset.mobileSlot = "eval-count-slot";
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
      if (
        modules.some(function (mod) {
          return mod.code === state.mod;
        })
      ) {
        moduleSelect.value = state.mod;
      } else {
        moduleSelect.value = "";
      }
    }

    if (state.cat !== undefined) {
      const selectedCats = Array.isArray(state.cat)
        ? state.cat
        : typeof state.cat === "string" && state.cat
          ? state.cat.split(",")
          : [];
      const checkboxes = form.querySelectorAll('input[name="category"]');
      checkboxes.forEach(function (cb) {
        cb.checked = selectedCats.includes(cb.value);
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
    const selectedCats = [];
    catCheckboxes.forEach(function (cb) {
      if (cb.checked) selectedCats.push(cb.value);
    });

    const stateObj = {
      period: period,
      mod: mod,
      cat: selectedCats,
    };

    setStoredState(stateObj);

    const params = new URLSearchParams();
    if (period && period !== "upcoming") params.set("period", period);
    if (mod) params.set("mod", mod);

    if (selectedCats.length > 0) {
      params.set("cat", selectedCats.join(","));
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

    if (resetButton) {
      resetButton.hidden =
        selectedPeriod === "upcoming" &&
        !selectedModule &&
        selectedCats.length === 0;
    }

    let visibleCount = 0;

    rows.forEach(function (row) {
      const cat = row.dataset.category;
      const mod = row.dataset.module;
      const isPast = row.dataset.past === "true";

      let matches = true;

      if (selectedCats.length > 0 && !selectedCats.includes(cat))
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

    const next = rows.find(function (row) {
      return !row.hidden && row.dataset.past === "false";
    });
    rows.forEach(function (row) {
      row.classList.toggle("is-next", row === next);
    });

    const monthCards = document.querySelectorAll(".month-card");
    monthCards.forEach(function (card) {
      const shown = card.querySelectorAll(".eval-row:not([hidden])").length;
      const meta = card.querySelector(".data-box-meta");
      if (meta) meta.textContent = shown;
      if (shown > 0) {
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
        cb.checked = false;
      });

      removeStoredState();
      applyFilters();
    });
  }

  const layout = container.closest(".has-filter-bar");
  if (layout) layout.classList.add("is-layout-ready");
});

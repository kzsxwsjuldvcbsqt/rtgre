(function () {
  const chevron = document.currentScript.dataset.chevron;
  const valueProperty = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );
  const rows = [];

  function closeRow(entry) {
    entry.trigger.setAttribute("aria-expanded", "false");
    entry.row.hidden = true;
  }

  function openRow(entry) {
    rows.forEach(function (other) {
      if (other !== entry) closeRow(other);
    });
    entry.trigger.setAttribute("aria-expanded", "true");
    entry.row.hidden = false;
  }

  function enhance(select) {
    const host = select.closest("form, .filter-form");
    if (!host) return;
    const label = select.getAttribute("aria-label");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "choice-trigger";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", select.id + "-choices");
    trigger.setAttribute("aria-label", label);
    const triggerKey = document.createElement("span");
    triggerKey.className = "choice-trigger-key";
    triggerKey.textContent = label;
    const triggerText = document.createElement("span");
    trigger.appendChild(triggerKey);
    trigger.appendChild(triggerText);
    trigger.appendChild(AppUtils.buildIcon(chevron, "icon-sm"));
    select.insertAdjacentElement("afterend", trigger);

    const row = document.createElement("div");
    row.className = "choice-row";
    row.id = select.id + "-choices";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", label);
    row.hidden = true;
    const title = document.createElement("span");
    title.className = "choice-row-title";
    title.textContent = label;
    row.appendChild(title);

    const choices = Array.from(select.options).map(function (option) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "choice";
      choice.textContent = option.textContent;
      choice.dataset.value = option.value;
      row.appendChild(choice);
      return choice;
    });
    const anchor = rows.length > 0 ? rows[rows.length - 1].row : host;
    anchor.insertAdjacentElement("afterend", row);

    const entry = { select: select, trigger: trigger, row: row };
    rows.push(entry);

    function sync() {
      const current = valueProperty.get.call(select);
      const selected = select.options[select.selectedIndex];
      triggerText.textContent =
        selected && selected.value !== "" ? selected.textContent : "";
      triggerText.hidden = triggerText.textContent === "";
      choices.forEach(function (choice) {
        choice.setAttribute(
          "aria-pressed",
          choice.dataset.value === current ? "true" : "false",
        );
      });
    }

    Object.defineProperty(select, "value", {
      configurable: true,
      get: function () {
        return valueProperty.get.call(this);
      },
      set: function (next) {
        valueProperty.set.call(this, next);
        sync();
      },
    });
    select.addEventListener("change", sync);

    trigger.addEventListener("click", function () {
      if (trigger.getAttribute("aria-expanded") === "true") {
        closeRow(entry);
      } else {
        openRow(entry);
      }
    });

    row.addEventListener("click", function (event) {
      const choice = event.target.closest(".choice");
      if (!choice) return;
      if (choice.dataset.value !== valueProperty.get.call(select)) {
        valueProperty.set.call(select, choice.dataset.value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      closeRow(entry);
      trigger.focus();
    });

    if (select.parentElement) {
      new MutationObserver(function () {
        if (select.parentElement.hidden) closeRow(entry);
      }).observe(select.parentElement, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
    }

    sync();
  }

  AppUtils.onDOMReady(function () {
    document
      .querySelectorAll(".has-filter-sidebar select[aria-label]")
      .forEach(enhance);

    document.addEventListener("click", function (event) {
      if (event.target.closest(".choice-trigger, .choice-row")) return;
      rows.forEach(function (entry) {
        closeRow(entry);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      rows.forEach(function (entry) {
        if (entry.row.hidden) return;
        closeRow(entry);
        entry.trigger.focus();
      });
    });
  });
})();

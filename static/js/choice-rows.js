(function () {
  const chevron = document.currentScript.dataset.chevron;
  const valueProperty = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );
  const rows = [];

  function buildIcon() {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "icon icon-sm");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS(svgNs, "use");
    use.setAttribute("href", chevron);
    svg.appendChild(use);
    return svg;
  }

  function closeRow(entry, animate) {
    if (entry.row.hidden) return;
    entry.trigger.setAttribute("aria-expanded", "false");
    if (!animate) {
      entry.row.hidden = true;
      return;
    }
    AppUtils.playMotion(entry.row, "is-concealing", function () {
      entry.row.hidden = entry.trigger.getAttribute("aria-expanded") !== "true";
    });
  }

  function openRow(entry) {
    rows.forEach(function (other) {
      if (other !== entry) closeRow(other, false);
    });
    entry.trigger.setAttribute("aria-expanded", "true");
    entry.row.hidden = false;
    AppUtils.playMotion(entry.row, "is-revealing");
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
    const triggerText = document.createElement("span");
    trigger.appendChild(triggerText);
    trigger.appendChild(buildIcon());
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
        selected && selected.value !== "" ? selected.textContent : label;
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
        closeRow(entry, true);
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
      closeRow(entry, true);
      trigger.focus();
    });

    if (select.parentElement) {
      new MutationObserver(function () {
        if (select.parentElement.hidden) closeRow(entry, false);
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
        closeRow(entry, true);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      rows.forEach(function (entry) {
        if (entry.row.hidden) return;
        closeRow(entry, true);
        entry.trigger.focus();
      });
    });
  });
})();

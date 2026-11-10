(function () {
  const sprite = document.currentScript.dataset.sprite;
  const valueProperty = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );
  const menus = [];

  function choose(select, value) {
    if (value === valueProperty.get.call(select)) return;
    valueProperty.set.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function watchValue(select, sync) {
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
  }

  function buildSegmented(select) {
    const group = document.createElement("div");
    group.className = "segmented";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", select.getAttribute("aria-label"));
    const buttons = Array.from(select.options).map(function (option) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.textContent;
      button.dataset.value = option.value;
      group.appendChild(button);
      return button;
    });
    select.insertAdjacentElement("afterend", group);

    function sync() {
      const current = valueProperty.get.call(select);
      buttons.forEach(function (button) {
        button.setAttribute(
          "aria-pressed",
          button.dataset.value === current ? "true" : "false",
        );
      });
    }

    group.addEventListener("click", function (event) {
      const button = event.target.closest("button");
      if (button) choose(select, button.dataset.value);
    });
    watchValue(select, sync);
    sync();
  }

  function closeMenu(entry, restoreFocus) {
    if (entry.panel.hidden) return;
    entry.panel.hidden = true;
    entry.trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) entry.trigger.focus();
  }

  function visibleItems(entry) {
    return entry.items.filter(function (item) {
      return !item.hidden;
    });
  }

  function applySearch(entry) {
    const query = entry.search.value.trim().toLowerCase();
    let matches = 0;
    entry.items.forEach(function (item) {
      const match = item.dataset.search.includes(query);
      item.hidden = !match;
      if (match) matches++;
    });
    entry.headings.forEach(function (heading) {
      heading.hidden = !heading.items.some(function (item) {
        return !item.hidden;
      });
    });
    entry.empty.hidden = matches > 0;
  }

  function openMenu(entry) {
    menus.forEach(function (other) {
      if (other !== entry) closeMenu(other, false);
    });
    entry.search.value = "";
    applySearch(entry);
    entry.panel.hidden = false;
    entry.trigger.setAttribute("aria-expanded", "true");
    entry.search.focus();
  }

  function buildItem(option) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "choice-menu-item";
    item.dataset.value = option.value;
    item.dataset.search = option.textContent.toLowerCase();
    item.appendChild(AppUtils.buildIcon(sprite + "#check", "icon-sm"));
    const code = document.createElement("span");
    code.className = "choice-menu-code";
    code.textContent = option.dataset.code || option.textContent;
    item.appendChild(code);
    if (option.dataset.label) {
      const label = document.createElement("span");
      label.className = "choice-menu-label";
      label.textContent = option.dataset.label;
      item.appendChild(label);
    }
    return item;
  }

  function buildMenu(select) {
    const label = select.getAttribute("aria-label");
    const panelId = select.id + "-menu";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "choice-trigger";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", panelId);
    const triggerKey = document.createElement("span");
    triggerKey.className = "choice-trigger-key";
    triggerKey.textContent = label;
    const triggerText = document.createElement("span");
    trigger.appendChild(triggerKey);
    trigger.appendChild(triggerText);
    trigger.appendChild(
      AppUtils.buildIcon(sprite + "#chevron-down", "icon-sm"),
    );

    const panel = document.createElement("div");
    panel.className = "menu-list choice-menu";
    panel.id = panelId;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", label);
    panel.hidden = true;

    const search = document.createElement("input");
    search.type = "search";
    search.className = "choice-menu-search";
    search.placeholder = select.dataset.searchLabel || label;
    search.setAttribute("aria-label", search.placeholder);
    search.autocomplete = "off";
    panel.appendChild(search);

    const list = document.createElement("div");
    list.className = "choice-menu-list";
    panel.appendChild(list);

    const items = [];
    const headings = [];
    Array.from(select.children).forEach(function (child) {
      if (child.tagName === "OPTGROUP") {
        const heading = document.createElement("p");
        heading.className = "choice-menu-group";
        heading.textContent = child.label;
        heading.items = [];
        list.appendChild(heading);
        headings.push(heading);
        Array.from(child.children).forEach(function (option) {
          const item = buildItem(option);
          heading.items.push(item);
          items.push(item);
          list.appendChild(item);
        });
      } else {
        const item = buildItem(child);
        items.push(item);
        list.appendChild(item);
      }
    });

    const empty = document.createElement("p");
    empty.className = "choice-menu-empty";
    empty.textContent = select.dataset.emptyLabel || "";
    empty.hidden = true;
    panel.appendChild(empty);

    select.insertAdjacentElement("afterend", trigger);
    trigger.insertAdjacentElement("afterend", panel);

    const entry = {
      select: select,
      trigger: trigger,
      panel: panel,
      search: search,
      items: items,
      headings: headings,
      empty: empty,
    };
    menus.push(entry);

    function sync() {
      const current = valueProperty.get.call(select);
      const selected = select.options[select.selectedIndex];
      triggerText.textContent =
        selected && selected.value !== ""
          ? selected.dataset.code || selected.textContent
          : "";
      triggerText.hidden = triggerText.textContent === "";
      trigger.setAttribute(
        "aria-label",
        triggerText.hidden ? label : label + " " + triggerText.textContent,
      );
      items.forEach(function (item) {
        item.setAttribute(
          "aria-pressed",
          item.dataset.value === current ? "true" : "false",
        );
      });
    }

    trigger.addEventListener("click", function () {
      if (panel.hidden) {
        openMenu(entry);
      } else {
        closeMenu(entry, false);
      }
    });

    search.addEventListener("input", function () {
      applySearch(entry);
    });

    panel.addEventListener("click", function (event) {
      const item = event.target.closest(".choice-menu-item");
      if (!item) return;
      choose(select, item.dataset.value);
      closeMenu(entry, true);
    });

    panel.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu(entry, true);
        return;
      }
      if (event.key === "Enter" && event.target === search) {
        event.preventDefault();
        const first = visibleItems(entry)[0];
        if (first) first.click();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const available = visibleItems(entry);
      if (available.length === 0) return;
      const index = available.indexOf(document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next =
        index === -1
          ? step === 1
            ? 0
            : available.length - 1
          : (index + step + available.length) % available.length;
      available[next].focus();
    });

    watchValue(select, sync);
    sync();
  }

  AppUtils.onDOMReady(function () {
    document
      .querySelectorAll(".has-filter-sidebar select[data-control]")
      .forEach(function (select) {
        if (select.dataset.control === "segmented") buildSegmented(select);
        if (select.dataset.control === "menu") buildMenu(select);
      });

    document.addEventListener("click", function (event) {
      menus.forEach(function (entry) {
        if (
          !entry.panel.contains(event.target) &&
          !entry.trigger.contains(event.target)
        ) {
          closeMenu(entry, false);
        }
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      menus.forEach(function (entry) {
        closeMenu(entry, entry.panel.contains(document.activeElement));
      });
    });
  });
})();

(function (global) {
  var controllers = new WeakMap();
  var openController = null;
  var positionFrame = null;
  var sequence = 0;
  var valueDescriptor = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );

  function optionRows(controller) {
    return controller.rows.filter(function (row) {
      return row.option && !row.option.disabled && !row.groupDisabled;
    });
  }

  function selectedOption(select) {
    return select.options[select.selectedIndex] || select.options[0] || null;
  }

  function setActive(controller, row, scroll) {
    controller.rows.forEach(function (item) {
      item.element.classList.toggle("is-active", item === row);
    });
    controller.active = row || null;
    if (row) {
      controller.trigger.setAttribute("aria-activedescendant", row.element.id);
      if (scroll) row.element.scrollIntoView({ block: "nearest" });
    } else {
      controller.trigger.removeAttribute("aria-activedescendant");
    }
  }

  function sync(controller) {
    var option = selectedOption(controller.select);
    controller.value.textContent = option ? option.textContent : "";
    controller.trigger.disabled = controller.select.disabled;
    controller.rows.forEach(function (row) {
      var selected = row.option === option;
      row.element.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected && controller.open) setActive(controller, row, false);
    });
    if (controller.select.disabled && controller.open) close(controller, false);
  }

  function makeOption(controller, option, parent, groupDisabled) {
    var element = document.createElement("div");
    var marker = document.createElement("span");
    var label = document.createElement("span");
    var row = {
      element: element,
      option: option,
      groupDisabled: groupDisabled,
    };

    element.className = "custom-select-option";
    element.id = controller.id + "-option-" + controller.rows.length;
    element.setAttribute("role", "option");
    if (option.disabled || groupDisabled)
      element.setAttribute("aria-disabled", "true");

    marker.className = "custom-select-option-marker";
    marker.setAttribute("aria-hidden", "true");
    label.className = "custom-select-option-label";
    label.textContent = option.textContent;
    element.append(marker, label);
    parent.appendChild(element);
    controller.rows.push(row);

    element.addEventListener("pointermove", function () {
      if (!option.disabled && !groupDisabled) setActive(controller, row, false);
    });
    element.addEventListener("click", function () {
      if (option.disabled || groupDisabled) return;
      choose(controller, row);
    });
  }

  function build(controller) {
    controller.menu.replaceChildren();
    controller.rows = [];

    Array.from(controller.select.children).forEach(function (child) {
      if (child instanceof HTMLOptGroupElement) {
        var group = document.createElement("div");
        var heading = document.createElement("div");
        group.className = "custom-select-group";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", child.label);
        heading.className = "custom-select-group-label";
        heading.setAttribute("aria-hidden", "true");
        heading.textContent = child.label;
        group.appendChild(heading);
        Array.from(child.children).forEach(function (option) {
          if (option instanceof HTMLOptionElement)
            makeOption(controller, option, group, child.disabled);
        });
        controller.menu.appendChild(group);
      } else if (child instanceof HTMLOptionElement) {
        makeOption(controller, child, controller.menu, false);
      }
    });

    sync(controller);
  }

  function position(controller) {
    if (!controller.open) return;
    var rect = controller.trigger.getBoundingClientRect();
    if (!rect.width) {
      close(controller, false);
      return;
    }

    controller.menu.classList.remove("opens-above");
    controller.menu.style.setProperty(
      "--custom-select-inline-start",
      rect.left + "px",
    );
    controller.menu.style.setProperty(
      "--custom-select-block-start",
      rect.bottom + "px",
    );
    controller.menu.style.setProperty(
      "--custom-select-inline-size",
      rect.width + "px",
    );

    var below = window.innerHeight - rect.bottom;
    var above = rect.top;
    var opensAbove =
      controller.menu.getBoundingClientRect().height > below && above > below;
    if (opensAbove) {
      controller.menu.classList.add("opens-above");
      controller.menu.style.setProperty(
        "--custom-select-block-start",
        rect.top + "px",
      );
    }
    controller.menu.style.setProperty(
      "--custom-select-available-size",
      (opensAbove ? above : below) + "px",
    );
  }

  function schedulePosition() {
    if (!openController || positionFrame !== null) return;
    positionFrame = requestAnimationFrame(function () {
      positionFrame = null;
      if (openController) position(openController);
    });
  }

  function open(controller) {
    if (controller.open || controller.select.disabled) return;
    if (openController) close(openController, false);
    controller.menu.hidden = false;
    if (typeof controller.menu.showPopover === "function") {
      try {
        controller.menu.showPopover();
      } catch (error) {}
    }
    controller.open = true;
    openController = controller;
    controller.trigger.setAttribute("aria-expanded", "true");
    var option = selectedOption(controller.select);
    var row = controller.rows.find(function (item) {
      return item.option === option;
    });
    setActive(controller, row || optionRows(controller)[0] || null, false);
    position(controller);
    if (controller.active)
      controller.active.element.scrollIntoView({ block: "nearest" });
  }

  function close(controller, restoreFocus) {
    if (!controller || !controller.open) return;
    if (
      typeof controller.menu.hidePopover === "function" &&
      controller.menu.matches(":popover-open")
    ) {
      controller.menu.hidePopover();
    }
    controller.menu.hidden = true;
    controller.open = false;
    controller.trigger.setAttribute("aria-expanded", "false");
    controller.trigger.removeAttribute("aria-activedescendant");
    setActive(controller, null, false);
    if (openController === controller) openController = null;
    if (restoreFocus) controller.trigger.focus();
  }

  function choose(controller, row) {
    if (!row || row.option.disabled || row.groupDisabled) return;
    controller.select.value = row.option.value;
    sync(controller);
    close(controller, true);
    controller.select.dispatchEvent(new Event("input", { bubbles: true }));
    controller.select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function move(controller, direction) {
    var rows = optionRows(controller);
    if (!rows.length) return;
    var current = rows.indexOf(controller.active);
    var next = current + direction;
    if (current < 0) next = direction > 0 ? 0 : rows.length - 1;
    if (next < 0) next = rows.length - 1;
    if (next >= rows.length) next = 0;
    setActive(controller, rows[next], true);
  }

  function boundary(controller, last) {
    var rows = optionRows(controller);
    if (!rows.length) return;
    setActive(controller, last ? rows[rows.length - 1] : rows[0], true);
  }

  function match(controller, key) {
    var rows = optionRows(controller);
    if (!rows.length) return;
    var normalized = AppUtils.stripAccents(key).toLowerCase();
    var start = Math.max(rows.indexOf(controller.active), -1);
    for (var offset = 1; offset <= rows.length; offset++) {
      var row = rows[(start + offset) % rows.length];
      if (
        AppUtils.stripAccents(row.option.textContent)
          .trim()
          .toLowerCase()
          .startsWith(normalized)
      ) {
        setActive(controller, row, true);
        return;
      }
    }
  }

  function labelController(controller) {
    var label = controller.select.id
      ? document.querySelector('label[for="' + controller.select.id + '"]')
      : null;
    var labelId;
    if (label) {
      if (!label.id) label.id = controller.id + "-label";
      labelId = label.id;
    } else if (controller.select.getAttribute("aria-label")) {
      var hiddenLabel = document.createElement("span");
      hiddenLabel.id = controller.id + "-label";
      hiddenLabel.className = "visually-hidden";
      hiddenLabel.textContent = controller.select.getAttribute("aria-label");
      controller.wrapper.prepend(hiddenLabel);
      labelId = hiddenLabel.id;
    }
    controller.value.id = controller.id + "-value";
    controller.trigger.setAttribute(
      "aria-labelledby",
      labelId ? labelId + " " + controller.value.id : controller.value.id,
    );
    if (label)
      label.addEventListener("click", function (event) {
        event.preventDefault();
        controller.trigger.focus();
      });
  }

  function enhance(select) {
    if (!(select instanceof HTMLSelectElement) || controllers.has(select))
      return;

    sequence += 1;
    var id = (select.id || "select") + "-custom-" + sequence;
    var wrapper = document.createElement("span");
    var trigger = document.createElement("button");
    var value = document.createElement("span");
    var chevron = document.createElement("span");
    var menu = document.createElement("div");
    var template = document.getElementById("select-chevron-template");
    var controller = {
      id: id,
      select: select,
      wrapper: wrapper,
      trigger: trigger,
      value: value,
      menu: menu,
      rows: [],
      active: null,
      open: false,
    };

    wrapper.className = "custom-select";
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", id + "-listbox");
    value.className = "custom-select-value";
    chevron.className = "custom-select-chevron";
    chevron.setAttribute("aria-hidden", "true");
    if (template) chevron.appendChild(template.content.cloneNode(true));
    trigger.append(value, chevron);

    menu.id = id + "-listbox";
    menu.className = "custom-select-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("popover", "manual");
    menu.hidden = true;

    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, trigger);
    document.body.appendChild(menu);
    select.classList.add("visually-hidden");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;
    controllers.set(select, controller);
    labelController(controller);

    if (valueDescriptor) {
      Object.defineProperty(select, "value", {
        configurable: true,
        get: function () {
          return valueDescriptor.get.call(select);
        },
        set: function (nextValue) {
          valueDescriptor.set.call(select, nextValue);
          sync(controller);
        },
      });
    }

    trigger.addEventListener("click", function () {
      if (controller.open) close(controller, false);
      else open(controller);
    });
    trigger.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (controller.open) {
          event.preventDefault();
          close(controller, false);
        }
        return;
      }
      if (event.key === "Tab") {
        close(controller, false);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!controller.open) open(controller);
        move(controller, event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        if (!controller.open) open(controller);
        boundary(controller, event.key === "End");
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (controller.open) choose(controller, controller.active);
        else open(controller);
        return;
      }
      if (
        event.key.length === 1 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        if (!controller.open) open(controller);
        match(controller, event.key);
      }
    });
    select.addEventListener("change", function () {
      sync(controller);
    });
    select.addEventListener("focus", function () {
      trigger.focus();
    });
    if (select.form)
      select.form.addEventListener("reset", function () {
        requestAnimationFrame(function () {
          sync(controller);
        });
      });

    new MutationObserver(function () {
      build(controller);
    }).observe(select, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["disabled", "label"],
    });

    build(controller);
  }

  function enhanceWithin(root) {
    if (root instanceof HTMLSelectElement) enhance(root);
    if (root.querySelectorAll)
      root.querySelectorAll("select").forEach(function (select) {
        enhance(select);
      });
  }

  AppUtils.onDOMReady(function () {
    enhanceWithin(document);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === Node.ELEMENT_NODE) enhanceWithin(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener("pointerdown", function (event) {
      if (
        openController &&
        !openController.wrapper.contains(event.target) &&
        !openController.menu.contains(event.target)
      ) {
        close(openController, false);
      }
    });
    window.addEventListener("scroll", schedulePosition, true);
    window.addEventListener("resize", schedulePosition);
  });

  global.AppSelect = {
    enhance: enhance,
    sync: function (select) {
      var controller = controllers.get(select);
      if (controller) sync(controller);
    },
  };
})(this);

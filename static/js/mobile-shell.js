(function () {
  const labels = document.currentScript.dataset;

  AppUtils.onDOMReady(function () {
    const root = document.documentElement;
    const body = document.body;
    const backdrop = document.querySelector(".app-backdrop");
    const sidebar = document.getElementById("app-sidebar");
    const main = document.querySelector(".app-main");
    const navToggles = Array.from(document.querySelectorAll(".nav-toggle"));
    const navClose = sidebar && sidebar.querySelector(".nav-close");
    const filterToggles = Array.from(
      document.querySelectorAll(".filters-toggle[aria-controls]"),
    );
    const moved = Array.from(
      document.querySelectorAll("[data-mobile-slot]"),
    ).map(function (element) {
      const anchor = document.createTextNode("");
      element.before(anchor);
      return {
        element: element,
        anchor: anchor,
        slot: document.getElementById(element.dataset.mobileSlot),
      };
    });
    let navOpen = false;
    let openSheet = null;
    let lastTrigger = null;

    function shown(element) {
      return getComputedStyle(element).display !== "none";
    }

    function drawerMode() {
      return navToggles.some(shown);
    }

    function sheetMode() {
      return filterToggles.some(shown);
    }

    function syncOverlay() {
      const active = navOpen || openSheet !== null;
      if (backdrop) backdrop.hidden = !active;
      root.classList.toggle("is-overlay-open", active);
      if (sidebar) sidebar.inert = drawerMode() && !navOpen;
      if (main) main.inert = navOpen;
    }

    function setExpanded(buttons, expanded) {
      buttons.forEach(function (button) {
        button.setAttribute("aria-expanded", expanded ? "true" : "false");
      });
    }

    function setNav(open, restoreFocus) {
      navOpen = open;
      body.classList.toggle("is-nav-open", open);
      setExpanded(navToggles, open);
      syncOverlay();
      if (open && navClose) navClose.focus();
      if (!open && restoreFocus && lastTrigger) lastTrigger.focus();
    }

    function togglesOf(panel) {
      return filterToggles.filter(function (button) {
        return button.getAttribute("aria-controls") === panel.id;
      });
    }

    function setSheet(panel, open, restoreFocus) {
      if (openSheet && openSheet !== panel) {
        openSheet.classList.remove("is-open");
        setExpanded(togglesOf(openSheet), false);
      }
      panel.classList.toggle("is-open", open);
      setExpanded(togglesOf(panel), open);
      openSheet = open ? panel : null;
      syncOverlay();
      if (open) panel.querySelector(".sheet-close").focus();
      if (!open && restoreFocus && lastTrigger) lastTrigger.focus();
    }

    function closeAll(restoreFocus) {
      if (navOpen) setNav(false, restoreFocus);
      if (openSheet) setSheet(openSheet, false, restoreFocus);
    }

    function buildSheet(panel) {
      panel.hidden = false;
      const head = document.createElement("div");
      head.className = "sheet-head";
      const title = document.createElement("span");
      title.className = "sheet-title";
      title.textContent = labels.labelFilters;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "sheet-close";
      close.setAttribute("aria-label", labels.labelClose);
      close.appendChild(AppUtils.buildIcon(labels.iconClose, ""));
      head.appendChild(title);
      head.appendChild(close);
      panel.prepend(head);

      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "sheet-apply";
      panel.appendChild(apply);

      const count = panel.querySelector(".results-count");
      function syncApply() {
        const text = count ? count.textContent.trim() : "";
        apply.textContent = text
          ? labels.labelApply.split("{count}").join(text)
          : labels.labelApplyEmpty;
      }
      if (count) {
        new MutationObserver(syncApply).observe(count, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
      syncApply();

      [close, apply].forEach(function (button) {
        button.addEventListener("click", function () {
          setSheet(panel, false, true);
        });
      });
    }

    function place() {
      const mobile = sheetMode();
      moved.forEach(function (entry) {
        if (!entry.slot) return;
        if (mobile && entry.element.parentNode !== entry.slot) {
          entry.slot.appendChild(entry.element);
        } else if (!mobile && entry.element.parentNode === entry.slot) {
          entry.anchor.after(entry.element);
        }
      });
    }

    const panels = [];
    filterToggles.forEach(function (button) {
      const panel = document.getElementById(
        button.getAttribute("aria-controls"),
      );
      if (!panel) return;
      if (panels.indexOf(panel) === -1) {
        panels.push(panel);
        buildSheet(panel);
      }
      button.addEventListener("click", function () {
        lastTrigger = button;
        setSheet(panel, openSheet !== panel, false);
      });
    });

    navToggles.forEach(function (button) {
      button.addEventListener("click", function () {
        lastTrigger = button;
        setNav(!navOpen, false);
      });
    });
    if (navClose) {
      navClose.addEventListener("click", function () {
        setNav(false, true);
      });
    }
    if (backdrop) {
      backdrop.addEventListener("click", function () {
        closeAll(false);
      });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeAll(true);
    });
    window.addEventListener("resize", function () {
      if (navOpen && !drawerMode()) setNav(false, false);
      if (openSheet && !sheetMode()) setSheet(openSheet, false, false);
      place();
      syncOverlay();
    });

    place();
    syncOverlay();
  });
})();

(function () {
  function panelOf(menu) {
    return menu.querySelector(":scope > .menu-list");
  }
  function openMenu(menu) {
    menu.open = true;
    const panel = panelOf(menu);
    if (panel) AppUtils.playMotion(panel, "is-revealing");
  }
  function closeMenu(menu, done) {
    const panel = panelOf(menu);
    if (!menu.open || !panel) {
      menu.open = false;
      if (done) done();
      return;
    }
    AppUtils.playMotion(panel, "is-concealing", () => {
      menu.open = false;
      if (done) done();
    });
  }
  function closeExcept(current) {
    document.querySelectorAll("details.menu[open]").forEach((menu) => {
      if (menu !== current) closeMenu(menu);
    });
  }
  document.querySelectorAll("details.menu > summary").forEach((summary) => {
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      const menu = summary.parentElement;
      if (menu.open) closeMenu(menu);
      else openMenu(menu);
    });
  });
  document.addEventListener("click", (event) => {
    const item = event.target.closest(".menu-list button, .menu-list a");
    if (item) {
      const owner = item.closest("details.menu");
      if (owner) closeMenu(owner);
      return;
    }
    closeExcept(event.target.closest("details.menu"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = document.querySelector("details.menu[open]");
    if (!open) return;
    closeMenu(open);
    const summary = open.querySelector("summary");
    if (summary) summary.focus();
  });
})();

(function () {
  function closeExcept(current) {
    document.querySelectorAll("details.menu[open]").forEach((menu) => {
      if (menu !== current) menu.open = false;
    });
  }
  document.addEventListener("click", (event) => {
    const item = event.target.closest(".menu-list button, .menu-list a");
    if (item) {
      const owner = item.closest("details.menu");
      if (owner) owner.open = false;
      return;
    }
    closeExcept(event.target.closest("details.menu"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = document.querySelector("details.menu[open]");
    if (!open) return;
    open.open = false;
    const summary = open.querySelector("summary");
    if (summary) summary.focus();
  });
})();

document.documentElement.classList.add("js-enabled");
window.ColorScheme = (function () {
  const STORAGE_KEY = "color_scheme";
  const AUTO = "auto";
  const system = window.matchMedia("(prefers-color-scheme: dark)");

  function choice() {
    try {
      return localStorage.getItem(STORAGE_KEY) || AUTO;
    } catch (error) {
      return AUTO;
    }
  }

  function apply() {
    const chosen = choice();
    const dark = chosen === "dark" || (chosen === AUTO && system.matches);
    document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
  }

  function choose(value) {
    try {
      if (value === AUTO) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      return;
    } finally {
      apply();
    }
  }

  system.addEventListener("change", apply);
  apply();
  return { choice: choice, choose: choose };
})();
function markScrolled() {
  document.documentElement.classList.toggle("is-scrolled", window.scrollY > 0);
}
markScrolled();
window.addEventListener("scroll", markScrolled, { passive: true });
window.addEventListener("load", function () {
  document.querySelectorAll(".has-filter-bar").forEach(function (layout) {
    layout.classList.add("is-layout-ready");
  });
});

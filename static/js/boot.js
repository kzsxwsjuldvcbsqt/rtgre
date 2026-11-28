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
window.Theme = (function () {
  const STORAGE_KEY = "theme";
  const root = document.documentElement;
  const source = document.currentScript.dataset;
  const SEASONAL = source.themeSeasonal;
  const CLASSIC = source.themeClassic;
  const seasonal = root.dataset.theme || CLASSIC;
  const sheets = new Map();
  document.querySelectorAll("link[data-theme-id]").forEach(function (link) {
    sheets.set(link.dataset.themeId, link);
  });

  function choice() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === CLASSIC || sheets.has(stored) ? stored : SEASONAL;
    } catch (error) {
      return SEASONAL;
    }
  }

  function apply() {
    const chosen = choice();
    const id = chosen === SEASONAL ? seasonal : chosen;
    if (sheets.has(id)) root.dataset.theme = id;
    else delete root.dataset.theme;
    return sheets.get(id);
  }

  function choose(value) {
    try {
      if (value === SEASONAL) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      return;
    } finally {
      apply();
    }
  }

  const sheet = apply();
  if (sheet)
    JSON.parse(sheet.dataset.preloadImages).forEach(function (image) {
      const preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "image";
      preload.href = new URL(image, sheet.href).href;
      document.head.appendChild(preload);
    });
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

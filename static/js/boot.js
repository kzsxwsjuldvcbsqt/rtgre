document.documentElement.classList.add("js-enabled");
(function () {
  const root = document.documentElement;
  const source = document.currentScript.dataset;

  function storedSetting(key, fallback, allowed, apply) {
    function choice() {
      try {
        const stored = localStorage.getItem(key);
        return allowed(stored) ? stored : fallback;
      } catch (error) {
        return fallback;
      }
    }

    function refresh() {
      apply(choice());
    }

    function choose(value) {
      try {
        if (value === fallback) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (error) {
        return;
      } finally {
        refresh();
      }
    }

    refresh();
    return { choice: choice, choose: choose, refresh: refresh };
  }

  function mark(name, value) {
    if (value) root.dataset[name] = value;
    else delete root.dataset[name];
  }

  const AUTO = "auto";
  const SCHEMES = ["light", "dark"];
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  window.ColorScheme = storedSetting(
    "color_scheme",
    AUTO,
    function (stored) {
      return SCHEMES.includes(stored);
    },
    function (chosen) {
      const dark = chosen === "dark" || (chosen === AUTO && system.matches);
      mark("colorScheme", dark ? "dark" : "light");
    },
  );
  system.addEventListener("change", window.ColorScheme.refresh);

  const SEASONAL = source.themeSeasonal;
  const CLASSIC = source.themeClassic;
  const seasonal = root.dataset.theme || CLASSIC;
  const sheets = new Map();
  document.querySelectorAll("link[data-theme-id]").forEach(function (link) {
    sheets.set(link.dataset.themeId, link);
  });
  window.Theme = storedSetting(
    "theme",
    SEASONAL,
    function (stored) {
      return stored === CLASSIC || sheets.has(stored);
    },
    function (chosen) {
      const id = chosen === SEASONAL ? seasonal : chosen;
      mark("theme", sheets.has(id) ? id : "");
    },
  );
  const sheet = sheets.get(root.dataset.theme);
  if (sheet)
    JSON.parse(sheet.dataset.preloadImages).forEach(function (image) {
      const preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "image";
      preload.href = new URL(image, sheet.href).href;
      document.head.appendChild(preload);
    });

  const accents = source.accents.split(" ");
  window.Accent = storedSetting(
    "accent",
    accents[0],
    function (stored) {
      return accents.includes(stored);
    },
    function (chosen) {
      mark("accent", chosen === accents[0] ? "" : chosen);
    },
  );
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

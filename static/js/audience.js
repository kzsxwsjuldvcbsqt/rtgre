window.Audience = (function () {
  const STORAGE_KEY = "audience_opt_out";
  const TRACKER_KEY = "umami.disabled";
  const source = document.currentScript;

  function refused() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function choose(counted) {
    try {
      if (counted) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(TRACKER_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, "1");
        localStorage.setItem(TRACKER_KEY, "1");
      }
    } catch (error) {
      return;
    }
  }

  function measured(hostname) {
    return !refused() && hostname === source.dataset.domain;
  }

  if (measured(window.location.hostname)) {
    const tracker = document.createElement("script");
    tracker.defer = true;
    tracker.src = source.dataset.tracker;
    tracker.dataset.websiteId = source.dataset.websiteId;
    document.head.appendChild(tracker);
  }

  return { refused: refused, choose: choose, measured: measured };
})();

AppUtils.onDOMReady(function () {
  document.querySelectorAll("[data-audience-choice]").forEach(function (group) {
    const options = Array.from(group.querySelectorAll("[data-value]"));

    function sync() {
      const choice = Audience.refused() ? "refused" : "counted";
      options.forEach(function (option) {
        option.setAttribute(
          "aria-pressed",
          option.dataset.value === choice ? "true" : "false",
        );
      });
    }

    group.addEventListener("click", function (event) {
      const option = event.target.closest("[data-value]");
      if (!option) return;
      Audience.choose(option.dataset.value === "counted");
      sync();
    });
    sync();
  });
});

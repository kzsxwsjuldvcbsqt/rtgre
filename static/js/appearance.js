AppUtils.onDOMReady(function () {
  [
    ["[data-color-scheme-choice]", ColorScheme],
    ["[data-theme-choice]", Theme],
  ].forEach(function (entry) {
    const setting = entry[1];
    document.querySelectorAll(entry[0]).forEach(function (group) {
      const options = Array.from(group.querySelectorAll("[data-value]"));

      function sync() {
        const choice = setting.choice();
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
        setting.choose(option.dataset.value);
        sync();
      });
      sync();
    });
  });
});

AppUtils.onDOMReady(function () {
  document
    .querySelectorAll("[data-color-scheme-choice]")
    .forEach(function (group) {
      const options = Array.from(group.querySelectorAll("[data-value]"));

      function sync() {
        const choice = ColorScheme.choice();
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
        ColorScheme.choose(option.dataset.value);
        sync();
      });
      sync();
    });
});

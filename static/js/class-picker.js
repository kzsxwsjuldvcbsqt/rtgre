AppUtils.onDOMReady(function () {
  const picker = document.querySelector(".class-picker");
  if (!picker) return;
  const steps = Array.from(picker.querySelectorAll(".picker-step"));

  function show(stepId, focusTarget) {
    steps.forEach(function (step) {
      const active = step.dataset.stepPanel === stepId;
      step.classList.toggle("is-active", active);
      step.inert = !active;
    });
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  picker.addEventListener("click", function (event) {
    const option = event.target.closest("[data-program]");
    if (option) {
      const step = picker.querySelector(
        '[data-step-panel="' + option.dataset.program + '"]',
      );
      show(option.dataset.program, step.querySelector(".picker-option"));
      return;
    }
    const back = event.target.closest(".picker-back");
    if (back) {
      const program = back.closest(".picker-step").dataset.stepPanel;
      show("program", picker.querySelector('[data-program="' + program + '"]'));
    }
  });

  show("program");
  picker.classList.add("is-ready");
});

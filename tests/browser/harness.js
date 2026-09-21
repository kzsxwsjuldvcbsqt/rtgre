(function (global) {
  function create() {
    const results = [];
    const errors = [];
    window.addEventListener("error", (event) => errors.push(event.message));
    window.addEventListener("unhandledrejection", (event) =>
      errors.push(String(event.reason)),
    );
    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
    function assert(value, message) {
      if (!value) throw new Error(message);
      results.push(message);
    }
    async function frame(path, width = 390) {
      const element = document.createElement("iframe");
      element.style.width = width + "px";
      element.style.height = "850px";
      document.body.append(element);
      await new Promise((resolve) => {
        element.onload = resolve;
        element.src = path;
      });
      const deadline = Date.now() + 30000;
      if (/\/(?:notes|absences|a-faire)\.html(?:[?#]|$)/.test(path)) {
        while (
          element.contentDocument.documentElement.dataset.storageReady !==
          "true"
        ) {
          if (Date.now() > deadline)
            throw new Error("Storage initialization timed out: " + path);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      errors.push(...(element.contentWindow.__testErrors || []));
      element.contentWindow.addEventListener("unhandledrejection", (event) =>
        errors.push(String(event.reason)),
      );
      element.contentWindow.addEventListener("error", (event) =>
        errors.push(event.message),
      );
      return element;
    }
    function change(window, element, value, type = "change") {
      element.value = value;
      element.dispatchEvent(new window.Event(type, { bubbles: true }));
    }
    return { results, errors, pause, assert, frame, change };
  }
  global.BrowserTest = { create };
})(globalThis);

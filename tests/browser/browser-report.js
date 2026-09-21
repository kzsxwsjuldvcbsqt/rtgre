(function () {
  const observer = new MutationObserver(async () => {
    const status = document.documentElement.dataset.testResult;
    if (!status) return;
    observer.disconnect();
    await fetch("/__browser_result__", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        html: document.documentElement.outerHTML,
      }),
    });
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-test-result"],
  });
})();

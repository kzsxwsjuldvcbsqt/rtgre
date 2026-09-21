(async function () {
  const { results, errors, pause, assert, frame, change } =
    BrowserTest.create();
  try {
    await runAbsenceBrowserTests({ frame, assert, change, pause });
    assert(
      errors.length === 0,
      "No absence browser errors: " + errors.join(", "),
    );
    document.body.textContent = JSON.stringify({
      checks: results.length,
      results,
    });
    if (globalThis.absencePdfBase64) {
      const output = document.createElement("output");
      output.id = "absence-pdf-data";
      output.textContent = globalThis.absencePdfBase64;
      document.body.append(output);
    }
    if (globalThis.absencePdfAnnexBase64) {
      const output = document.createElement("output");
      output.id = "absence-pdf-annex-data";
      output.textContent = globalThis.absencePdfAnnexBase64;
      document.body.append(output);
    }
    document.documentElement.dataset.testResult = "passed";
  } catch (error) {
    document.body.textContent = JSON.stringify({
      error: error.stack,
      results,
      errors,
    });
    document.documentElement.dataset.testResult = "failed";
  }
})();

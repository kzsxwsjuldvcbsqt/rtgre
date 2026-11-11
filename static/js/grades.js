(function () {
  document.addEventListener("DOMContentLoaded", async function () {
    var scriptEl = document.querySelector("script[data-class-id]");
    if (!scriptEl) return;

    var actionsEl = document.getElementById("grades-actions");
    if (actionsEl) {
      actionsEl.hidden = false;
    }

    var classId = scriptEl.getAttribute("data-class-id");
    var minVal = parseFloat(scriptEl.getAttribute("data-min"));
    var maxVal = parseFloat(scriptEl.getAttribute("data-max"));
    var decimals = parseInt(scriptEl.getAttribute("data-decimals"), 10);
    var passMark = parseFloat(scriptEl.getAttribute("data-pass-mark"));
    var storagePrefix = scriptEl.getAttribute("data-storage-prefix");
    var formatVersion = parseInt(
      scriptEl.getAttribute("data-format-version"),
      10,
    );
    var exportFormat = scriptEl.getAttribute("data-export-format");
    var exportFilename = scriptEl.getAttribute("data-export-filename");
    var maxImportBytes = parseInt(
      scriptEl.getAttribute("data-max-import-bytes"),
      10,
    );
    var maxEntries = parseInt(scriptEl.getAttribute("data-max-entries"), 10);
    var importReplaceConfirm = scriptEl.getAttribute(
      "data-import-replace-confirm",
    );
    var errEmptyImport = scriptEl.getAttribute("data-err-empty-import");
    var errStorage = scriptEl.getAttribute("data-err-storage");
    var errRestore = scriptEl.getAttribute("data-err-restore");
    var errFileSize = scriptEl.getAttribute("data-err-file-size");
    var messageEl = document.getElementById("grades-message");
    var resetConfirmMsg = scriptEl.getAttribute("data-reset-confirm");
    var confirmOtherClassMsg = scriptEl.getAttribute(
      "data-confirm-other-class",
    );
    var errInvalidJson = scriptEl.getAttribute("data-err-invalid-json");
    var errBadFormat = scriptEl.getAttribute("data-err-bad-format");
    var errNewerVersion = scriptEl.getAttribute("data-err-newer-version");
    var importSuccessMsg = scriptEl.getAttribute("data-import-success");
    var entriesIgnoredMsg = scriptEl.getAttribute("data-entries-ignored");

    var rawConfigData = scriptEl.getAttribute("data-grades-config");
    var gradesConfig = JSON.parse(rawConfigData);

    var storageKey = storagePrefix + "_" + classId;
    var errConflict = scriptEl.getAttribute("data-err-conflict");
    var gradesBaseline;
    var restoreFailed = false;
    var writeAccess = await WriteAccess.acquire(storageKey);
    var lastValidByCode = {};

    var inputs = Array.prototype.slice.call(
      document.querySelectorAll(".grade-input[data-module]"),
    );
    var inputsByCode = {};
    inputs.forEach(function (input) {
      var code = input.getAttribute("data-module");
      inputsByCode[code] = input;
    });

    var hasDetails = gradesConfig.has_details === true;
    var detailKey =
      scriptEl.getAttribute("data-detail-storage-prefix") + "_" + classId;
    var detailToggle = document.getElementById("grades-detail-toggle");
    var detailOption = document.getElementById("grades-detail-option");
    var evaluationInputs = Array.prototype.slice.call(
      document.querySelectorAll(".grade-input[data-evaluation]"),
    );
    var evaluationRows = Array.prototype.slice.call(
      document.querySelectorAll(".evaluation-row"),
    );
    var computedOutputs = Array.prototype.slice.call(
      document.querySelectorAll(".grade-computed"),
    );
    var detailLimits = {
      minimum: minVal,
      maximum: maxVal,
      maxEntries: maxEntries,
    };
    var detailEnabled = false;
    var detailBaseline;
    var lastValidDetail = {};

    function currentEvaluations() {
      var evaluations = {};
      evaluationInputs.forEach(function (input) {
        var grade = getValidGrade(input);
        if (grade === null) return;
        var code = input.getAttribute("data-evaluation-module");
        evaluations[code] = evaluations[code] || {};
        evaluations[code][input.getAttribute("data-evaluation")] = grade;
      });
      return evaluations;
    }

    function currentDetail() {
      return { enabled: detailEnabled, evaluations: currentEvaluations() };
    }

    function countEvaluations(evaluations) {
      return Object.keys(evaluations).reduce(function (total, code) {
        return total + Object.keys(evaluations[code]).length;
      }, 0);
    }

    function applyMode() {
      if (detailToggle) detailToggle.checked = detailEnabled;
      evaluationRows.forEach(function (row) {
        row.hidden = !detailEnabled;
      });
      computedOutputs.forEach(function (output) {
        output.hidden = !detailEnabled;
        var input = inputsByCode[output.getAttribute("data-computed-module")];
        if (input) input.hidden = detailEnabled;
      });
    }

    function getValidGrade(input) {
      var valStr = input.value.trim();
      if (valStr === "") {
        input.removeAttribute("aria-invalid");
        return null;
      }
      var num = AppUtils.parseGrade(valStr, minVal, maxVal);
      if (num === null) {
        input.setAttribute("aria-invalid", "true");
        return null;
      }
      input.removeAttribute("aria-invalid");
      return num;
    }

    function currentGrades() {
      var gradesByCode = {};
      inputs.forEach(function (input) {
        var code = input.getAttribute("data-module");
        var g = getValidGrade(input);
        if (g !== null) {
          gradesByCode[code] = g;
        }
      });
      return gradesByCode;
    }

    function markResult(element, value) {
      var known = value !== null && value !== undefined;
      element.classList.toggle("is-pass", known && value >= passMark);
      element.classList.toggle("is-fail", known && value < passMark);
    }

    function showAverage(element, value) {
      if (!element) return;
      element.textContent =
        value !== null && value !== undefined ? value.toFixed(decimals) : "";
      markResult(element, value);
    }

    function showComputed(detail) {
      var computed = GradesModel.moduleGradesFromDetail(
        detail.evaluations,
        gradesConfig,
      );
      computedOutputs.forEach(function (output) {
        var code = output.getAttribute("data-computed-module");
        var value = computed[code];
        output.classList.toggle("is-empty", value === undefined);
        markResult(output, value);
        output.textContent =
          value === undefined
            ? inputsByCode[code].placeholder
            : value.toFixed(decimals);
      });
    }

    function calculate() {
      var detail = currentDetail();
      showComputed(detail);
      var averages = GradesModel.calculate(
        GradesModel.effectiveGrades(currentGrades(), detail, gradesConfig),
        gradesConfig,
      );
      inputs.concat(evaluationInputs).forEach(function (input) {
        markResult(input, getValidGrade(input));
      });
      gradesConfig.semesters.forEach(function (sem) {
        showAverage(
          document.getElementById("avg-" + sem.id),
          averages.semesters[sem.id],
        );
      });
      var panelTable = document.getElementById("grades-panel-table");
      var panelEmpty = document.getElementById("grades-panel-empty");
      if (panelTable && panelEmpty) {
        var hasAverage = Object.keys(averages.units).some(function (id) {
          return averages.units[id] !== null;
        });
        panelTable.hidden = !hasAverage;
        panelEmpty.hidden = hasAverage;
      }
      gradesConfig.annual_units.forEach(function (au) {
        gradesConfig.semesters.forEach(function (sem) {
          showAverage(
            document.getElementById("synth-" + sem.id + "-" + au.id),
            averages.units[au.units[sem.id]],
          );
        });
        var complete = gradesConfig.semesters.every(function (sem) {
          var unitId = au.units[sem.id];
          return !unitId || averages.units[unitId] !== null;
        });
        showAverage(
          document.getElementById("synth-annual-" + au.id),
          complete ? averages.annualUnits[au.id] : null,
        );
      });
    }

    function writeGrades(grades) {
      writeAccess.assertWritable();
      var current = localStorage.getItem(storageKey);
      if (gradesBaseline !== undefined && current !== gradesBaseline) {
        throw new Error("conflict");
      }
      var serialized = JSON.stringify(grades);
      localStorage.setItem(storageKey, serialized);
      gradesBaseline = serialized;
    }

    function assertDetailUnchanged() {
      if (!hasDetails) return;
      var current = localStorage.getItem(detailKey);
      if (detailBaseline !== undefined && current !== detailBaseline) {
        throw new Error("conflict");
      }
    }

    function writeDetail(detail) {
      if (!hasDetails) return;
      writeAccess.assertWritable();
      assertDetailUnchanged();
      if (!detail.enabled && countEvaluations(detail.evaluations) === 0) {
        localStorage.removeItem(detailKey);
        detailBaseline = null;
        return;
      }
      var serialized = JSON.stringify(detail);
      localStorage.setItem(detailKey, serialized);
      detailBaseline = serialized;
    }

    function applyDetail(detail) {
      evaluationInputs.forEach(function (input) {
        var values =
          detail.evaluations[input.getAttribute("data-evaluation-module")] ||
          {};
        var id = input.getAttribute("data-evaluation");
        input.value = Object.prototype.hasOwnProperty.call(values, id)
          ? String(values[id])
          : "";
        input.removeAttribute("aria-invalid");
      });
      detailEnabled = detail.enabled;
      applyMode();
      calculate();
    }

    function applyGrades(grades) {
      inputs.forEach(function (input) {
        var code = input.getAttribute("data-module");
        input.value = Object.prototype.hasOwnProperty.call(grades, code)
          ? String(grades[code])
          : "";
        input.removeAttribute("aria-invalid");
      });
      calculate();
    }

    function saveToStorage() {
      if (restoreFailed) {
        showMessage(errRestore, true);
        return false;
      }
      inputs.forEach(function (input) {
        var code = input.getAttribute("data-module");
        var g = getValidGrade(input);
        if (g !== null) {
          lastValidByCode[code] = g;
        } else if (input.getAttribute("aria-invalid") !== "true") {
          delete lastValidByCode[code];
        }
      });
      evaluationInputs.forEach(function (input) {
        var code = input.getAttribute("data-evaluation-module");
        var id = input.getAttribute("data-evaluation");
        var g = getValidGrade(input);
        if (g !== null) {
          lastValidDetail[code] = lastValidDetail[code] || {};
          lastValidDetail[code][id] = g;
        } else if (
          input.getAttribute("aria-invalid") !== "true" &&
          lastValidDetail[code]
        ) {
          delete lastValidDetail[code][id];
          if (Object.keys(lastValidDetail[code]).length === 0) {
            delete lastValidDetail[code];
          }
        }
      });
      try {
        assertDetailUnchanged();
        writeGrades(lastValidByCode);
        writeDetail({ enabled: detailEnabled, evaluations: lastValidDetail });
        return true;
      } catch (e) {
        showMessage(e.message === "conflict" ? errConflict : errStorage, true);
        return false;
      }
    }

    function restoreFromStorage() {
      try {
        var raw = localStorage.getItem(storageKey);
        gradesBaseline = raw;
        if (!raw) return;
        var restored = GradesModel.normalizeGrades(
          JSON.parse(raw),
          Object.keys(inputsByCode),
          {
            minimum: minVal,
            maximum: maxVal,
            maxEntries: maxEntries,
          },
        );
        lastValidByCode = Object.assign({}, restored.grades);
        applyGrades(restored.grades);
        if (restored.ignored) {
          restoreFailed = true;
          showMessage(errRestore, true);
        }
      } catch (error) {
        restoreFailed = true;
        showMessage(
          error instanceof SyntaxError || error.message === "format"
            ? errRestore
            : errStorage,
          true,
        );
      }
    }

    function restoreDetail() {
      if (!hasDetails) return;
      try {
        var raw = localStorage.getItem(detailKey);
        detailBaseline = raw;
        if (!raw) return;
        var restored = GradesModel.normalizeDetail(
          JSON.parse(raw),
          gradesConfig,
          detailLimits,
        );
        lastValidDetail = JSON.parse(
          JSON.stringify(restored.detail.evaluations),
        );
        applyDetail(restored.detail);
        if (restored.ignored) {
          restoreFailed = true;
          showMessage(errRestore, true);
        }
      } catch (error) {
        restoreFailed = true;
        showMessage(
          error instanceof SyntaxError || error.message === "format"
            ? errRestore
            : errStorage,
          true,
        );
      }
    }

    inputs.concat(evaluationInputs).forEach(function (input) {
      input.addEventListener("input", function () {
        calculate();
        saveToStorage();
        updateActionState();
      });
    });

    AppUtils.bindBlurKeys(inputs.concat(evaluationInputs));

    restoreFromStorage();
    restoreDetail();
    applyMode();
    calculate();

    if (detailToggle && detailOption) {
      detailOption.hidden = false;
      detailToggle.addEventListener("change", function () {
        detailEnabled = detailToggle.checked;
        applyMode();
        calculate();
        saveToStorage();
      });
    }
    if (!writeAccess.writable) showMessage(errConflict, true);
    document.documentElement.dataset.storageReady = "true";

    var exportBtn = document.getElementById("grades-export-btn");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        var exportedGrades = {};
        inputs.forEach(function (input) {
          var val = input.value.trim();
          if (val !== "") {
            var num = AppUtils.parseGrade(val, minVal, maxVal);
            if (num !== null) {
              exportedGrades[input.getAttribute("data-module")] = num;
            }
          }
        });

        var exportObject = {
          format: exportFormat,
          version: formatVersion,
          class: classId,
          exported_at: new Date().toISOString(),
          grades: exportedGrades,
        };
        if (hasDetails) exportObject.detail = currentDetail();

        var blob = new Blob([JSON.stringify(exportObject, null, 2)], {
          type: "application/json",
        });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        var dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = AppUtils.formatText(exportFilename, {
          class: classId,
          date: dateStr,
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }

    var resetBtn = document.getElementById("grades-reset-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (window.confirm(resetConfirmMsg)) {
          try {
            writeAccess.assertWritable();
            if (localStorage.getItem(storageKey) !== gradesBaseline)
              throw new Error("conflict");
            assertDetailUnchanged();
            localStorage.removeItem(storageKey);
            gradesBaseline = null;
            writeDetail({ enabled: detailEnabled, evaluations: {} });
            restoreFailed = false;
          } catch (error) {
            showMessage(
              error.message === "conflict" ? errConflict : errStorage,
              true,
            );
            return;
          }
          lastValidByCode = {};
          lastValidDetail = {};
          applyGrades({});
          applyDetail({ enabled: detailEnabled, evaluations: {} });
          updateActionState();
          showMessage("");
        }
      });
    }

    function updateActionState() {
      var isEmpty =
        Object.keys(lastValidByCode).length === 0 &&
        Object.keys(lastValidDetail).length === 0;
      if (exportBtn) exportBtn.disabled = isEmpty;
      if (resetBtn) resetBtn.disabled = isEmpty && !restoreFailed;
    }
    updateActionState();

    var importBtn = document.getElementById("grades-import-btn");
    var importFile = document.getElementById("grades-import-file");

    function showMessage(msg, isError) {
      if (!messageEl) return;
      if (!msg) {
        messageEl.hidden = true;
        messageEl.textContent = "";
        return;
      }
      messageEl.hidden = false;
      messageEl.setAttribute("role", isError ? "alert" : "status");
      messageEl.textContent = msg;
    }

    var bulletinBtn = document.getElementById("grades-bulletin-btn");
    var bulletinFile = document.getElementById("grades-bulletin-file");
    var bulletinConfig = JSON.parse(
      scriptEl.getAttribute("data-bulletin-config"),
    );

    function bulletinText(name) {
      return scriptEl.getAttribute("data-" + name);
    }

    function fillTemplate(template, values) {
      return Object.keys(values).reduce(function (text, key) {
        return text.split("{" + key + "}").join(String(values[key]));
      }, template);
    }

    async function readBulletinPages(file) {
      var pdfjs = await import(
        new URL(scriptEl.getAttribute("data-pdfjs"), document.baseURI).href
      );
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        scriptEl.getAttribute("data-pdfjs-worker"),
        document.baseURI,
      ).href;
      var task = pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        isEvalSupported: false,
        disableFontFace: true,
        enableXfa: false,
        verbosity: 0,
      });
      var doc = await task.promise;
      try {
        if (doc.numPages > bulletinConfig.max_pages) {
          throw new Error("not_recognized");
        }
        var info = (await doc.getMetadata()).info || {};
        var pages = [];
        for (var number = 1; number <= doc.numPages; number++) {
          var page = await doc.getPage(number);
          var content = await page.getTextContent();
          pages.push(
            content.items.map(function (item) {
              return {
                x: item.transform[4],
                y: item.transform[5],
                text: item.str,
              };
            }),
          );
        }
        return { info: info, pages: pages };
      } finally {
        await task.destroy();
      }
    }

    function mergeBulletin(result) {
      var counts = { added: 0, replaced: 0, unchanged: 0 };
      function count(previous, next) {
        if (previous === undefined) counts.added++;
        else if (previous === next) counts.unchanged++;
        else counts.replaced++;
      }
      var grades = Object.assign({}, lastValidByCode);
      Object.keys(result.grades).forEach(function (code) {
        count(lastValidByCode[code], result.grades[code]);
        grades[code] = result.grades[code];
      });
      var evaluations = JSON.parse(JSON.stringify(lastValidDetail));
      Object.keys(result.evaluations).forEach(function (code) {
        evaluations[code] = evaluations[code] || {};
        Object.keys(result.evaluations[code]).forEach(function (id) {
          count(
            lastValidDetail[code] && lastValidDetail[code][id],
            result.evaluations[code][id],
          );
          evaluations[code][id] = result.evaluations[code][id];
        });
      });
      return { grades: grades, evaluations: evaluations, counts: counts };
    }

    async function importBulletin(file) {
      if (file.size > bulletinConfig.max_bytes) {
        showMessage(errFileSize, true);
        return;
      }
      if (restoreFailed) {
        showMessage(errRestore, true);
        return;
      }
      showMessage(bulletinText("bulletin-reading"), false);
      var result;
      try {
        var source = await readBulletinPages(file);
        var parsed = BulletinModel.read(
          source.pages,
          source.info,
          bulletinConfig,
        );
        result = BulletinModel.match(parsed, gradesConfig);
      } catch (error) {
        showMessage(
          bulletinText(
            error && error.message === "not_recognized"
              ? "err-bulletin-not-recognized"
              : "err-bulletin-unreadable",
          ),
          true,
        );
        return;
      }
      if (result.known === 0) {
        showMessage(bulletinText("err-bulletin-modules"), true);
        return;
      }
      if (
        result.tracks.length !== 1 ||
        result.tracks[0] !== gradesConfig.track
      ) {
        showMessage(bulletinText("err-bulletin-track"), true);
        return;
      }
      if (
        result.statuses.length !== 1 ||
        result.statuses[0] !== gradesConfig.status
      ) {
        showMessage(bulletinText("err-bulletin-status"), true);
        return;
      }
      if (
        Object.keys(result.grades).length +
          countEvaluations(result.evaluations) ===
        0
      ) {
        showMessage(bulletinText("err-bulletin-empty"), true);
        return;
      }
      var merged = mergeBulletin(result);
      if (
        merged.counts.replaced > 0 &&
        !window.confirm(
          fillTemplate(bulletinText("bulletin-replace-confirm"), {
            count: merged.counts.replaced,
          }),
        )
      ) {
        showMessage("", false);
        return;
      }
      var detail = { enabled: detailEnabled, evaluations: merged.evaluations };
      try {
        assertDetailUnchanged();
        writeGrades(merged.grades);
        writeDetail(detail);
      } catch (error) {
        showMessage(
          error.message === "conflict" ? errConflict : errStorage,
          true,
        );
        return;
      }
      lastValidByCode = Object.assign({}, merged.grades);
      lastValidDetail = JSON.parse(JSON.stringify(merged.evaluations));
      applyGrades(merged.grades);
      applyDetail(detail);
      updateActionState();
      var message = fillTemplate(
        bulletinText("bulletin-success"),
        merged.counts,
      );
      if (result.ignored > 0) {
        message += " (" + result.ignored + " " + entriesIgnoredMsg + ")";
      }
      showMessage(message, false);
    }

    if (bulletinBtn && bulletinFile) {
      bulletinBtn.addEventListener("click", function () {
        bulletinFile.value = "";
        bulletinFile.click();
      });
      bulletinFile.addEventListener("change", function (evt) {
        var file = evt.target.files[0];
        if (file) importBulletin(file);
      });
    }

    if (importBtn && importFile) {
      importBtn.addEventListener("click", function () {
        importFile.value = "";
        importFile.click();
      });

      importFile.addEventListener("change", function (evt) {
        var file = evt.target.files[0];
        if (!file) return;
        if (file.size > maxImportBytes) {
          showMessage(errFileSize, true);
          return;
        }

        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var data = JSON.parse(e.target.result);

            if (
              !data ||
              typeof data !== "object" ||
              Array.isArray(data) ||
              data.format !== exportFormat ||
              typeof data.class !== "string" ||
              !data.class ||
              !data.grades ||
              typeof data.grades !== "object" ||
              Array.isArray(data.grades) ||
              !Number.isInteger(data.version) ||
              data.version < 1 ||
              (data.detail !== undefined &&
                (!data.detail ||
                  typeof data.detail !== "object" ||
                  Array.isArray(data.detail)))
            ) {
              showMessage(errBadFormat, true);
              return;
            }

            if (data.version > formatVersion) {
              showMessage(errNewerVersion, true);
              return;
            }

            if (data.class !== classId) {
              if (!window.confirm(confirmOtherClassMsg)) {
                return;
              }
            }

            var normalized = GradesModel.normalizeGrades(
              data.grades,
              Object.keys(inputsByCode),
              {
                minimum: minVal,
                maximum: maxVal,
                maxEntries: maxEntries,
              },
            );
            var importedGrades = data.grades;
            var ignoredCount = normalized.ignored;
            var newValues = normalized.grades;
            var newDetail = { enabled: false, evaluations: {} };
            var detailEntries = 0;
            if (data.detail !== undefined) {
              var normalizedDetail = GradesModel.normalizeDetail(
                data.detail,
                gradesConfig,
                detailLimits,
              );
              newDetail = normalizedDetail.detail;
              detailEntries = normalizedDetail.entries;
              ignoredCount += normalizedDetail.ignored;
            }

            if (
              Object.keys(importedGrades).length + detailEntries > 0 &&
              Object.keys(newValues).length +
                countEvaluations(newDetail.evaluations) ===
                0
            ) {
              showMessage(errEmptyImport, true);
              return;
            }
            if (
              inputs.concat(evaluationInputs).some(function (input) {
                return input.value.trim() !== "";
              }) &&
              !window.confirm(importReplaceConfirm)
            )
              return;

            try {
              assertDetailUnchanged();
              writeGrades(newValues);
              writeDetail(newDetail);
            } catch (error) {
              showMessage(
                error.message === "conflict" ? errConflict : errStorage,
                true,
              );
              return;
            }
            restoreFailed = false;
            lastValidByCode = Object.assign({}, newValues);
            lastValidDetail = JSON.parse(JSON.stringify(newDetail.evaluations));
            applyGrades(newValues);
            applyDetail(newDetail);
            updateActionState();

            var statusMsg = importSuccessMsg;
            if (ignoredCount > 0) {
              statusMsg += " (" + ignoredCount + " " + entriesIgnoredMsg + ")";
            }
            showMessage(statusMsg, false);
          } catch (error) {
            showMessage(
              error instanceof SyntaxError ? errInvalidJson : errBadFormat,
              true,
            );
          }
        };
        reader.onerror = function () {
          showMessage(errInvalidJson, true);
        };
        reader.readAsText(file);
      });
    }

    function initCollapsibleSemesters() {
      var semSections = document.querySelectorAll(".semester-section");
      semSections.forEach(function (sec) {
        var table = sec.querySelector(".grades-table");
        if (!table) return;
        var semId = table.getAttribute("data-semester");
        var btn = sec.querySelector(".heading-toggle-btn");
        if (!btn) return;
        var arrow = btn.querySelector(".toggle-arrow");
        var card = sec.querySelector(".table-card");

        var semStorageKey = "sem_collapsed_" + classId + "_" + semId;

        function setCollapsed(isCollapsed) {
          card.hidden = isCollapsed;
          btn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
          if (arrow) {
            if (isCollapsed) {
              arrow.classList.add("is-collapsed");
            } else {
              arrow.classList.remove("is-collapsed");
            }
          }
        }

        var savedState = AppUtils.safeStorageGet(semStorageKey, true);
        if (savedState === "1") {
          setCollapsed(true);
        }

        btn.addEventListener("click", function () {
          var nextState = !card.hidden;
          setCollapsed(nextState);
          AppUtils.safeStorageSet(semStorageKey, nextState ? "1" : "0", true);
        });
      });
    }

    function initCoefficientToggle() {
      var page = document.getElementById("grades-page");
      var option = document.getElementById("grades-coef-option");
      var toggle = document.getElementById("grades-coef-toggle");
      if (!page || !option || !toggle) return;
      var coefStorageKey = "coefs_visible_" + classId;

      function setVisible(visible) {
        toggle.checked = visible;
        page.classList.toggle("show-coefs", visible);
      }

      setVisible(AppUtils.safeStorageGet(coefStorageKey, true) === "1");
      option.hidden = false;
      toggle.addEventListener("change", function () {
        setVisible(toggle.checked);
        AppUtils.safeStorageSet(
          coefStorageKey,
          toggle.checked ? "1" : "0",
          true,
        );
      });
    }

    initCollapsibleSemesters();
    initCoefficientToggle();
  });
})();

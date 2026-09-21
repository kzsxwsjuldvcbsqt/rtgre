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
    var emptyValue = scriptEl.getAttribute("data-empty-value");
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
      document.querySelectorAll(".grade-input"),
    );
    var inputsByCode = {};
    inputs.forEach(function (input) {
      var code = input.getAttribute("data-module");
      inputsByCode[code] = input;
    });

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

    function calculate() {
      var averages = GradesModel.calculate(currentGrades(), gradesConfig);
      gradesConfig.semesters.forEach(function (sem) {
        sem.units.forEach(function (u) {
          var value = averages.units[u.id];
          var cell = document.getElementById("avg-" + u.id);
          if (cell) {
            cell.textContent =
              value !== null ? value.toFixed(decimals) : emptyValue;
          }
        });
        var semAvgCell = document.getElementById("avg-" + sem.id);
        if (semAvgCell) {
          var semesterValue = averages.semesters[sem.id];
          semAvgCell.textContent =
            semesterValue !== null
              ? semesterValue.toFixed(decimals)
              : emptyValue;
        }
      });

      gradesConfig.annual_units.forEach(function (au) {
        gradesConfig.semesters.forEach(function (sem) {
          var average = averages.units[au.units[sem.id]];
          var cell = document.getElementById("synth-" + sem.id + "-" + au.id);
          if (cell)
            cell.textContent =
              average !== null && average !== undefined
                ? average.toFixed(decimals)
                : emptyValue;
        });
        var annualCell = document.getElementById("synth-annual-" + au.id);
        if (annualCell) {
          var annualValue = averages.annualUnits[au.id];
          annualCell.textContent =
            annualValue !== null ? annualValue.toFixed(decimals) : emptyValue;
        }
      });
      var globalAvgEl = document.getElementById("global-annual-avg");
      if (globalAvgEl) {
        globalAvgEl.textContent =
          averages.global !== null
            ? averages.global.toFixed(decimals)
            : emptyValue;
      }
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
      try {
        writeGrades(lastValidByCode);
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

    inputs.forEach(function (input) {
      input.addEventListener("input", function () {
        calculate();
        saveToStorage();
        updateActionState();
      });
    });

    AppUtils.bindBlurKeys(inputs);

    restoreFromStorage();
    calculate();
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
            localStorage.removeItem(storageKey);
            restoreFailed = false;
            gradesBaseline = null;
          } catch (error) {
            showMessage(
              error.message === "conflict" ? errConflict : errStorage,
              true,
            );
            return;
          }
          lastValidByCode = {};
          applyGrades({});
          updateActionState();
          showMessage("");
        }
      });
    }

    function updateActionState() {
      var isEmpty = Object.keys(lastValidByCode).length === 0;
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
              data.version < 1
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

            if (
              Object.keys(importedGrades).length > 0 &&
              Object.keys(newValues).length === 0
            ) {
              showMessage(errEmptyImport, true);
              return;
            }
            if (
              inputs.some(function (input) {
                return input.value.trim() !== "";
              }) &&
              !window.confirm(importReplaceConfirm)
            )
              return;

            try {
              writeGrades(newValues);
            } catch (error) {
              showMessage(
                error.message === "conflict" ? errConflict : errStorage,
                true,
              );
              return;
            }
            restoreFailed = false;
            lastValidByCode = Object.assign({}, newValues);
            applyGrades(newValues);
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
        var thead = table.querySelector("thead");
        var subjectRows = table.querySelectorAll(".subject-row");

        var semStorageKey = "sem_collapsed_" + classId + "_" + semId;

        function setCollapsed(isCollapsed) {
          if (thead) thead.hidden = isCollapsed;
          subjectRows.forEach(function (row) {
            row.hidden = isCollapsed;
          });
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
          var currentlyCollapsed = thead ? thead.hidden : false;
          var nextState = !currentlyCollapsed;
          setCollapsed(nextState);
          AppUtils.safeStorageSet(semStorageKey, nextState ? "1" : "0", true);
        });
      });
    }

    initCollapsibleSemesters();
  });
})();

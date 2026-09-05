(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var scriptEl = document.querySelector('script[data-class-id]');
    if (!scriptEl) return;

    var actionsEl = document.getElementById('grades-actions');
    if (actionsEl) {
      actionsEl.hidden = false;
    }

    var classId = scriptEl.getAttribute('data-class-id');
    var minVal = parseFloat(scriptEl.getAttribute('data-min'));
    var maxVal = parseFloat(scriptEl.getAttribute('data-max'));
    var decimals = parseInt(scriptEl.getAttribute('data-decimals'), 10);
    var storagePrefix = scriptEl.getAttribute('data-storage-prefix');
    var formatVersion = parseInt(scriptEl.getAttribute('data-format-version'), 10);
    var emptyValue = scriptEl.getAttribute('data-empty-value');
    var resetConfirmMsg = scriptEl.getAttribute('data-reset-confirm');
    var confirmOtherClassMsg = scriptEl.getAttribute('data-confirm-other-class');
    var errInvalidJson = scriptEl.getAttribute('data-err-invalid-json');
    var errBadFormat = scriptEl.getAttribute('data-err-bad-format');
    var errNewerVersion = scriptEl.getAttribute('data-err-newer-version');
    var importSuccessMsg = scriptEl.getAttribute('data-import-success');
    var entriesIgnoredMsg = scriptEl.getAttribute('data-entries-ignored');

    var rawConfigData = scriptEl.getAttribute('data-grades-config');
    var gradesConfig = JSON.parse(rawConfigData);

    var storageKey = storagePrefix + '_' + classId;

    var inputs = Array.prototype.slice.call(document.querySelectorAll('.grade-input'));
    var inputsByCode = {};
    inputs.forEach(function (input) {
      var code = input.getAttribute('data-module');
      inputsByCode[code] = input;
    });

    function getValidGrade(input) {
      var valStr = input.value.trim();
      if (valStr === '') return null;
      var num = parseFloat(valStr);
      if (isNaN(num) || num < minVal || num > maxVal) {
        input.setAttribute('aria-invalid', 'true');
        return null;
      }
      input.removeAttribute('aria-invalid');
      return num;
    }

    function calculate() {
      var gradesByCode = {};
      inputs.forEach(function (input) {
        var code = input.getAttribute('data-module');
        var g = getValidGrade(input);
        if (g !== null) {
          gradesByCode[code] = g;
        }
      });

      var ueAverages = {};
      gradesConfig.semesters.forEach(function (sem) {
        sem.units.forEach(function (u) {
          var uId = u.id;
          var numSum = 0;
          var denSum = 0;

          sem.subjects.forEach(function (subj) {
            var coeff = subj.coeffs[uId];
            if (coeff !== null && coeff !== undefined) {
              var grade = gradesByCode[subj.code];
              if (grade !== undefined && grade !== null) {
                numSum += grade * coeff;
                denSum += coeff;
              }
            }
          });

          if (denSum > 0) {
            ueAverages[uId] = numSum / denSum;
          } else {
            ueAverages[uId] = null;
          }

          var cell = document.getElementById('avg-' + uId);
          if (cell) {
            cell.textContent = ueAverages[uId] !== null ? ueAverages[uId].toFixed(decimals) : emptyValue;
          }
        });

        var semNum = 0;
        var semDen = 0;
        sem.units.forEach(function (u) {
          var uAvg = ueAverages[u.id];
          var w = u.weight || 1;
          if (uAvg !== null) {
            semNum += uAvg * w;
            semDen += w;
          }
        });

        var semAvgCell = document.getElementById('avg-' + sem.id);
        if (semAvgCell) {
          var semAvg = semDen > 0 ? (semNum / semDen) : null;
          if (semAvg !== null) {
            semAvgCell.textContent = semAvg.toFixed(decimals);
          } else {
            semAvgCell.textContent = emptyValue;
          }
        }
      });

      var annualUeAverages = {};
      gradesConfig.annual_units.forEach(function (au) {
        var auId = au.id;
        var s5UId = au.s5_unit_id;
        var s6UId = au.s6_unit_id;

        var numSum = 0;
        var denSum = 0;

        gradesConfig.semesters.forEach(function (sem) {
          var targetUId = sem.id === 's5' ? s5UId : s6UId;
          if (!targetUId) return;

          sem.subjects.forEach(function (subj) {
            var coeff = subj.coeffs[targetUId];
            if (coeff !== null && coeff !== undefined) {
              var grade = gradesByCode[subj.code];
              if (grade !== undefined && grade !== null) {
                numSum += grade * coeff;
                denSum += coeff;
              }
            }
          });
        });

        var s5Avg = ueAverages[s5UId];
        var s6Avg = ueAverages[s6UId];

        var s5Cell = document.getElementById('synth-s5-' + auId);
        if (s5Cell) {
          s5Cell.textContent = s5Avg !== null && s5Avg !== undefined ? s5Avg.toFixed(decimals) : emptyValue;
        }

        var s6Cell = document.getElementById('synth-s6-' + auId);
        if (s6Cell) {
          s6Cell.textContent = s6Avg !== null && s6Avg !== undefined ? s6Avg.toFixed(decimals) : emptyValue;
        }

        if (denSum > 0) {
          annualUeAverages[auId] = numSum / denSum;
        } else {
          annualUeAverages[auId] = null;
        }

        var annualCell = document.getElementById('synth-annual-' + auId);
        if (annualCell) {
          var aVal = annualUeAverages[auId];
          if (aVal !== null) {
            annualCell.textContent = aVal.toFixed(decimals);
          } else {
            annualCell.textContent = emptyValue;
          }
        }
      });

      var gNum = 0;
      var gDen = 0;
      gradesConfig.annual_units.forEach(function (au) {
        var aAvg = annualUeAverages[au.id];
        var w = au.s5_weight || 1;
        if (aAvg !== null && aAvg !== undefined) {
          gNum += aAvg * w;
          gDen += w;
        }
      });

      var globalAvgEl = document.getElementById('global-annual-avg');
      if (globalAvgEl) {
        var gAvg = gDen > 0 ? (gNum / gDen) : null;
        globalAvgEl.textContent = gAvg !== null ? gAvg.toFixed(decimals) : emptyValue;
      }
    }

    function saveToStorage() {
      try {
        var dataToSave = {};
        inputs.forEach(function (input) {
          var val = input.value.trim();
          if (val !== '') {
            dataToSave[input.getAttribute('data-module')] = val;
          }
        });
        localStorage.setItem(storageKey, JSON.stringify(dataToSave));
      } catch (e) {}
    }

    function restoreFromStorage() {
      try {
        var raw = localStorage.getItem(storageKey);
        if (raw) {
          var parsed = JSON.parse(raw);
          Object.keys(parsed).forEach(function (code) {
            if (Object.prototype.hasOwnProperty.call(inputsByCode, code)) {
              inputsByCode[code].value = parsed[code];
            }
          });
        }
      } catch (e) {}
    }

    inputs.forEach(function (input) {
      input.addEventListener('input', function () {
        calculate();
        saveToStorage();
      });
    });

    restoreFromStorage();
    calculate();

    var exportBtn = document.getElementById('grades-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var exportedGrades = {};
        inputs.forEach(function (input) {
          var val = input.value.trim();
          if (val !== '') {
            var num = parseFloat(val);
            if (!isNaN(num) && num >= minVal && num <= maxVal) {
              exportedGrades[input.getAttribute('data-module')] = num;
            }
          }
        });

        var exportObject = {
          format: 'but3-grades',
          version: formatVersion,
          class: classId,
          exported_at: new Date().toISOString(),
          grades: exportedGrades
        };

        var blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = 'grades-' + classId + '-' + dateStr + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }

    var resetBtn = document.getElementById('grades-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (window.confirm(resetConfirmMsg)) {
          inputs.forEach(function (input) {
            input.value = '';
            input.removeAttribute('aria-invalid');
          });
          try {
            localStorage.removeItem(storageKey);
          } catch (e) {}
          calculate();
          showMessage('');
        }
      });
    }

    var importBtn = document.getElementById('grades-import-btn');
    var importFile = document.getElementById('grades-import-file');
    var messageEl = document.getElementById('grades-message');

    function showMessage(msg, isError) {
      if (!messageEl) return;
      if (!msg) {
        messageEl.hidden = true;
        messageEl.textContent = '';
        return;
      }
      messageEl.hidden = false;
      messageEl.textContent = msg;
    }

    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () {
        importFile.value = '';
        importFile.click();
      });

      importFile.addEventListener('change', function (evt) {
        var file = evt.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var data = JSON.parse(e.target.result);

            if (!data || typeof data !== 'object' || data.format !== 'but3-grades') {
              showMessage(errBadFormat, true);
              return;
            }

            if (typeof data.version !== 'number' || data.version > formatVersion) {
              showMessage(errNewerVersion, true);
              return;
            }

            if (data.class !== classId) {
              if (!window.confirm(confirmOtherClassMsg)) {
                return;
              }
            }

            var importedGrades = (data && data.grades && typeof data.grades === 'object') ? data.grades : {};
            var ignoredCount = 0;
            var newValues = {};

            Object.keys(importedGrades).forEach(function (code) {
              if (Object.prototype.hasOwnProperty.call(inputsByCode, code)) {
                var val = importedGrades[code];
                var num = typeof val === 'number' ? val : parseFloat(val);
                if (!isNaN(num) && num >= minVal && num <= maxVal) {
                  newValues[code] = num;
                } else {
                  ignoredCount++;
                }
              } else {
                ignoredCount++;
              }
            });

            inputs.forEach(function (input) {
              var code = input.getAttribute('data-module');
              if (Object.prototype.hasOwnProperty.call(newValues, code)) {
                input.value = newValues[code];
                input.removeAttribute('aria-invalid');
              } else {
                input.value = '';
                input.removeAttribute('aria-invalid');
              }
            });

            calculate();
            saveToStorage();

            var statusMsg = importSuccessMsg;
            if (ignoredCount > 0) {
              statusMsg += ' (' + ignoredCount + ' ' + entriesIgnoredMsg + ')';
            }
            showMessage(statusMsg, false);
          } catch (err) {
            showMessage(errInvalidJson, true);
          }
        };
        reader.readAsText(file);
      });
    }

    function initCollapsibleSemesters() {
      var semSections = document.querySelectorAll('.semester-section');
      semSections.forEach(function (sec) {
        var table = sec.querySelector('.grades-table');
        if (!table) return;
        var semId = table.getAttribute('data-semester');
        var btn = sec.querySelector('.heading-toggle-btn');
        if (!btn) return;
        var arrow = btn.querySelector('.toggle-arrow');
        var thead = table.querySelector('thead');
        var subjectRows = table.querySelectorAll('.subject-row');

        var semStorageKey = 'sem_collapsed_' + classId + '_' + semId;

        function setCollapsed(isCollapsed) {
          if (thead) thead.hidden = isCollapsed;
          subjectRows.forEach(function (row) {
            row.hidden = isCollapsed;
          });
          btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
          if (arrow) {
            if (isCollapsed) {
              arrow.classList.add('is-collapsed');
            } else {
              arrow.classList.remove('is-collapsed');
            }
          }
        }

        var savedState = AppUtils.safeStorageGet(semStorageKey, true);
        if (savedState === '1') {
          setCollapsed(true);
        }

        btn.addEventListener('click', function () {
          var currentlyCollapsed = thead ? thead.hidden : false;
          var nextState = !currentlyCollapsed;
          setCollapsed(nextState);
          AppUtils.safeStorageSet(semStorageKey, nextState ? '1' : '0', true);
        });
      });
    }

    initCollapsibleSemesters();
  });
})();

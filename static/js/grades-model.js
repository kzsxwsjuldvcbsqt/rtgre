(function (global) {
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeGrades(source, allowedCodes, limits) {
    if (!isObject(source) || Object.keys(source).length > limits.maxEntries) {
      throw new Error("format");
    }
    const allowed = new Set(allowedCodes);
    const grades = {};
    let ignored = 0;
    Object.keys(source).forEach(function (code) {
      const value = source[code];
      if (!allowed.has(code)) {
        ignored += 1;
        return;
      }
      if (typeof value !== "string" && typeof value !== "number") {
        throw new Error("format");
      }
      const grade = global.AppUtils.parseGrade(
        value,
        limits.minimum,
        limits.maximum,
      );
      if (grade === null) {
        ignored += 1;
        return;
      }
      grades[code] = grade;
    });
    return { grades, ignored };
  }

  function weightedAverage(values) {
    let numerator = 0;
    let denominator = 0;
    values.forEach(function (item) {
      if (item.value === null || item.value === undefined) return;
      numerator += item.value * item.weight;
      denominator += item.weight;
    });
    return denominator > 0 ? numerator / denominator : null;
  }

  function calculate(grades, config) {
    const units = {};
    const semesters = {};
    const annualUnits = {};

    config.semesters.forEach(function (semester) {
      semester.units.forEach(function (unit) {
        units[unit.id] = weightedAverage(
          semester.subjects
            .filter(function (subject) {
              return (
                subject.coeffs[unit.id] !== null &&
                subject.coeffs[unit.id] !== undefined
              );
            })
            .map(function (subject) {
              return {
                value: grades[subject.code],
                weight: subject.coeffs[unit.id],
              };
            }),
        );
      });
      semesters[semester.id] = weightedAverage(
        semester.units.map(function (unit) {
          return { value: units[unit.id], weight: unit.weight };
        }),
      );
    });

    config.annual_units.forEach(function (annualUnit) {
      const contributions = [];
      config.semesters.forEach(function (semester) {
        const unitId = annualUnit.units[semester.id];
        if (!unitId) return;
        semester.subjects.forEach(function (subject) {
          const coefficient = subject.coeffs[unitId];
          if (coefficient === null || coefficient === undefined) return;
          contributions.push({
            value: grades[subject.code],
            weight: coefficient,
          });
        });
      });
      annualUnits[annualUnit.id] = weightedAverage(contributions);
    });

    return { units, semesters, annualUnits };
  }

  function detailedSubjects(config) {
    const subjects = [];
    config.semesters.forEach(function (semester) {
      semester.subjects.forEach(function (subject) {
        if (subject.evaluations && subject.evaluations.length > 0) {
          subjects.push(subject);
        }
      });
    });
    return subjects;
  }

  function normalizeDetail(source, config, limits) {
    if (!isObject(source)) throw new Error("format");
    const rawEvaluations =
      source.evaluations === undefined ? {} : source.evaluations;
    if (!isObject(rawEvaluations)) throw new Error("format");
    const allowed = {};
    detailedSubjects(config).forEach(function (subject) {
      allowed[subject.code] = new Set(
        subject.evaluations.map(function (evaluation) {
          return evaluation.id;
        }),
      );
    });
    const evaluations = {};
    let ignored = 0;
    let entries = 0;
    Object.keys(rawEvaluations).forEach(function (code) {
      const values = rawEvaluations[code];
      if (!isObject(values)) throw new Error("format");
      Object.keys(values).forEach(function (id) {
        entries += 1;
        if (entries > limits.maxEntries) throw new Error("format");
        const value = values[id];
        if (typeof value !== "string" && typeof value !== "number") {
          throw new Error("format");
        }
        if (!allowed[code] || !allowed[code].has(id)) {
          ignored += 1;
          return;
        }
        const grade = global.AppUtils.parseGrade(
          value,
          limits.minimum,
          limits.maximum,
        );
        if (grade === null) {
          ignored += 1;
          return;
        }
        evaluations[code] = evaluations[code] || {};
        evaluations[code][id] = grade;
      });
    });
    const enabled = source.enabled === true && Object.keys(allowed).length > 0;
    return { detail: { enabled, evaluations }, ignored, entries };
  }

  function moduleGradesFromDetail(evaluations, config) {
    const grades = {};
    detailedSubjects(config).forEach(function (subject) {
      const values = evaluations[subject.code] || {};
      const average = weightedAverage(
        subject.evaluations.map(function (evaluation) {
          return { value: values[evaluation.id], weight: evaluation.weight };
        }),
      );
      if (average !== null) grades[subject.code] = average;
    });
    return grades;
  }

  function effectiveGrades(grades, detail, config) {
    if (!detail || !detail.enabled) return grades;
    const result = Object.assign({}, grades);
    const computed = moduleGradesFromDetail(detail.evaluations, config);
    detailedSubjects(config).forEach(function (subject) {
      delete result[subject.code];
      if (computed[subject.code] !== undefined) {
        result[subject.code] = computed[subject.code];
      }
    });
    return result;
  }

  const api = {
    calculate,
    normalizeGrades,
    normalizeDetail,
    moduleGradesFromDetail,
    effectiveGrades,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GradesModel = api;
})(globalThis);

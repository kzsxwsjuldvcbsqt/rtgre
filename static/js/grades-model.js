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

    const global = weightedAverage(
      config.annual_units.map(function (unit) {
        return { value: annualUnits[unit.id], weight: unit.weight };
      }),
    );
    return { units, semesters, annualUnits, global };
  }

  const api = { calculate, normalizeGrades };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.GradesModel = api;
})(globalThis);

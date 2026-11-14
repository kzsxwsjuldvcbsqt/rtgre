(function (global) {
  function fail(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function normalizeLabel(text) {
    return String(text)
      .normalize("NFKC")
      .replace(/[‘’“”]/g, function (quote) {
        return quote === "‘" || quote === "’" ? "'" : '"';
      })
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\d+\s*[-.)]\s*/, "")
      .toLowerCase();
  }

  function groupRows(items, tolerance) {
    const sorted = items
      .filter(function (item) {
        return String(item.text).trim() !== "";
      })
      .slice()
      .sort(function (a, b) {
        return b.y - a.y || a.x - b.x;
      });
    const rows = [];
    sorted.forEach(function (item) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - item.y) <= tolerance) {
        row.items.push(item);
      } else {
        rows.push({ y: item.y, items: [item] });
      }
    });
    return rows.map(function (row) {
      return {
        y: row.y,
        items: row.items
          .slice()
          .sort(function (a, b) {
            return a.x - b.x;
          })
          .map(function (item) {
            return { x: item.x, text: String(item.text).trim() };
          }),
      };
    });
  }

  function gradeValue(text, missing) {
    if (text === missing) return null;
    if (!/^\d{1,3}(?:[.,]\d+)?$/.test(text)) return undefined;
    return parseFloat(text.replace(",", "."));
  }

  function moduleCode(text, prefixes) {
    const token = text.split(" ")[0];
    const known = prefixes.some(function (prefix) {
      return (
        token.indexOf(prefix) === 0 && /^\d$/.test(token.charAt(prefix.length))
      );
    });
    if (!known || token.indexOf(".") === -1) return null;
    return /^[A-Za-z0-9.]+$/.test(token) ? token : null;
  }

  function read(pages, info, config) {
    const ignored = new Set(config.ignored_texts);
    const rows = [];
    pages.forEach(function (items) {
      groupRows(items, config.row_tolerance).forEach(function (row) {
        const kept = row.items.filter(function (item) {
          return !ignored.has(item.text);
        });
        if (kept.length)
          rows.push({ y: row.y, items: kept, page: pages.indexOf(items) });
      });
    });

    const texts = rows.map(function (row) {
      return row.items
        .map(function (item) {
          return item.text;
        })
        .join(" ");
    });
    const source = [info && info.Author, info && info.Producer]
      .filter(Boolean)
      .join(" ");
    const formation = texts.find(function (text) {
      return text.indexOf(config.formation_marker) === 0;
    });
    if (
      source.indexOf(config.producer_marker) === -1 ||
      texts.indexOf(config.title_marker) === -1 ||
      !formation ||
      formation.indexOf(config.program_marker) === -1
    ) {
      throw fail("not_recognized");
    }

    const header = [(info && info.Title) || "", formation].join(" ");
    const modules = {};
    const evaluations = [];
    let section = null;
    let noteX = null;
    let currentModule = null;
    let sectionName = null;
    let previous = null;

    function labelOf(items) {
      return items
        .filter(function (item) {
          return (
            item.x < noteX - config.column_tolerance &&
            gradeValue(item.text, config.missing_grade) === undefined
          );
        })
        .map(function (item) {
          return item.text;
        })
        .join(" ");
    }

    rows.forEach(function (entry) {
      const row = entry.items;
      const lastEvaluation = previous;
      previous = null;
      const first = row[0].text;
      const noteHeader = row.find(function (item) {
        return item.text === config.note_header;
      });
      if (noteHeader) {
        noteX = noteHeader.x;
        if (first === config.ue_section) section = "ue";
        if (config.evaluation_sections.indexOf(first) !== -1) {
          if (first !== sectionName) currentModule = null;
          section = "evaluations";
          sectionName = first;
        }
        return;
      }
      if (first.indexOf(config.footer_marker) === 0 || noteX === null) return;

      const cells = row.filter(function (item) {
        return item.x >= noteX - config.column_tolerance;
      });
      const last = cells[cells.length - 1];
      const grade = last
        ? gradeValue(last.text, config.missing_grade)
        : undefined;
      const code = moduleCode(first, config.module_prefixes);

      if (section === "ue") {
        if (!code || grade === undefined) return;
        if (!(code in modules) || modules[code] === null) modules[code] = grade;
        return;
      }
      if (section !== "evaluations") return;
      if (code && first.slice(code.length).indexOf(" - ") === 0) {
        currentModule = code;
        return;
      }
      if (!currentModule) return;
      if (grade === undefined) {
        if (
          lastEvaluation &&
          lastEvaluation.page === entry.page &&
          lastEvaluation.y - entry.y <= config.wrap_gap
        ) {
          const extra = labelOf(row);
          if (extra) lastEvaluation.evaluation.label += " " + extra;
        }
        return;
      }
      const label = labelOf(row);
      if (label) {
        const evaluation = {
          module: currentModule,
          label: label,
          grade: grade,
        };
        evaluations.push(evaluation);
        previous = { page: entry.page, y: entry.y, evaluation: evaluation };
      }
    });

    return { header: header, modules: modules, evaluations: evaluations };
  }

  function siteCode(code) {
    return code.replace(/\./g, "");
  }

  function match(parsed, gradesConfig) {
    const subjects = {};
    gradesConfig.semesters.forEach(function (semester) {
      semester.subjects.forEach(function (subject) {
        subjects[subject.code] = subject;
      });
    });
    const trackIds = new Set(gradesConfig.track_ids);
    const tracks = new Set();
    const codes = Object.keys(parsed.modules).concat(
      parsed.evaluations.map(function (evaluation) {
        return evaluation.module;
      }),
    );
    codes.forEach(function (code) {
      code
        .toLowerCase()
        .split(".")
        .forEach(function (part) {
          if (trackIds.has(part)) tracks.add(part);
        });
    });
    const words = parsed.header.toLowerCase().split(/[^a-z0-9]+/);
    const statuses = gradesConfig.status_ids.filter(function (status) {
      return words.indexOf(status.toLowerCase()) !== -1;
    });

    const grades = {};
    const evaluations = {};
    let ignored = 0;
    let known = 0;
    Object.keys(parsed.modules).forEach(function (code) {
      const subject = subjects[siteCode(code)];
      if (subject) known++;
      const grade = parsed.modules[code];
      if (grade === null) return;
      if (subject) grades[subject.code] = grade;
      else ignored++;
    });
    parsed.evaluations.forEach(function (evaluation) {
      if (evaluation.grade === null) return;
      const subject = subjects[siteCode(evaluation.module)];
      if (!subject || !subject.evaluations.length) {
        if (gradesConfig.has_details) ignored++;
        return;
      }
      const wanted = normalizeLabel(evaluation.label);
      const target = subject.evaluations.find(function (item) {
        return normalizeLabel(item.label) === wanted;
      });
      if (!target) {
        ignored++;
        return;
      }
      evaluations[subject.code] = evaluations[subject.code] || {};
      evaluations[subject.code][target.id] = evaluation.grade;
    });

    return {
      tracks: Array.from(tracks),
      statuses: statuses,
      known: known,
      grades: grades,
      evaluations: evaluations,
      ignored: ignored,
    };
  }

  const api = { groupRows, read, match, normalizeLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.BulletinModel = api;
})(globalThis);

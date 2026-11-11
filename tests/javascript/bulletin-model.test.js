const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../../static/js/bulletin-model.js");

const config = {
  producer_marker: "ScoDoc",
  title_marker: "RELEVÉ DE NOTES",
  formation_marker: "Formation:",
  program_marker: "Réseaux et Télécommunications",
  ue_section: "Unités d'enseignement",
  evaluation_sections: [
    "Ressources",
    "Situations d'apprentissage et d'évaluation",
  ],
  note_header: "Note/20",
  footer_marker: "Édité par ScoDoc",
  missing_grade: "~",
  ignored_texts: ["Provisoire"],
  module_pattern: "^(?:R|SAE)\\d+(?:\\.[A-Za-z0-9]+)+",
  row_tolerance: 3,
  column_tolerance: 5,
  wrap_gap: 12,
};

const info = {
  Title: "Bulletin BUT Réseaux et Télécommunications 2023 semestre 5 FI",
  Author: "ScoDoc 9",
};

function row(y, cells) {
  return cells.map(function (cell) {
    return { x: cell[0], y: y, text: cell[1] };
  });
}

const pages = [
  [].concat(
    row(765, [[223, "RELEVÉ DE NOTES"]]),
    row(726, [
      [34, "Formation: BUT Réseaux et Télécommunications 2023 semestre 5"],
    ]),
    row(683, [
      [40, "Unités d'enseignement"],
      [473, "Coef."],
      [519, "Note/20"],
    ]),
    row(645, [
      [40, "UE5.1 - Compétence 1"],
      [530, "14.00"],
    ]),
    row(597, [
      [40, "R5.01 Wifi - Wifi avancé"],
      [484, "6.0"],
      [530, "14.00"],
    ]),
    row(579, [
      [40, "R5.dc.09 DevOps - Outils"],
      [484, "8.0"],
      [549, "~"],
    ]),
    row(561, [
      [40, "R5.99 Inconnu - Module absent"],
      [484, "2.0"],
      [530, "11.00"],
    ]),
    row(558, [[132, "Provisoire"]]),
    row(18, [[57, "Édité par ScoDoc le 22/10/2026"]]),
  ),
  [].concat(
    row(390, [
      [40, "Ressources"],
      [474, "Coef."],
      [510, "Note/20"],
    ]),
    row(356, [[40, "R5.01 - Wifi - Wifi avancé"]]),
    row(338, [
      [294, "1.0"],
      [478, "03.00"],
    ]),
    row(336, [
      [40, "1 - DS Wifi"],
      [530, "14.00"],
    ]),
    row(318, [
      [40, "Réalisation technique (travail rendu et"],
      [549, "~"],
    ]),
    row(308, [[40, "intéressement)"]]),
    row(290, [
      [40, "Évaluation non prévue"],
      [530, "09.50"],
    ]),
    row(250, [[34, "3 demi-journées d'absences"]]),
  ),
];

const gradesConfig = {
  track: "dc",
  status: "fi",
  track_ids: ["cy", "dc"],
  status_ids: ["fi", "fa"],
  has_details: true,
  semesters: [
    {
      id: "s5",
      subjects: [
        {
          code: "R501",
          evaluations: [
            { id: "ds-wifi", label: "DS Wifi" },
            {
              id: "realisation",
              label: "Réalisation technique (travail rendu et intéressement)",
            },
          ],
        },
        { code: "R5dc09", evaluations: [] },
      ],
    },
  ],
};

test("bulletin rows are grouped by line and watermark is dropped", () => {
  const parsed = model.read(pages, info, config);
  assert.deepEqual(parsed.modules, {
    "R5.01": 14,
    "R5.dc.09": null,
    "R5.99": 11,
  });
  assert.deepEqual(
    parsed.evaluations.map((evaluation) => evaluation.label),
    [
      "1 - DS Wifi",
      "Réalisation technique (travail rendu et intéressement)",
      "Évaluation non prévue",
    ],
  );
});

test("bulletin grades are matched to site modules and evaluations", () => {
  const result = model.match(model.read(pages, info, config), gradesConfig);
  assert.deepEqual(result.tracks, ["dc"]);
  assert.deepEqual(result.statuses, ["fi"]);
  assert.equal(result.known, 2);
  assert.deepEqual(result.grades, { R501: 14 });
  assert.deepEqual(result.evaluations, { R501: { "ds-wifi": 14 } });
  assert.equal(result.ignored, 2);
});

test("documents that are not a ScoDoc bulletin are rejected", () => {
  assert.throws(
    () => model.read(pages, { Title: "Facture", Author: "Autre" }, config),
    /not_recognized/,
  );
  assert.throws(
    () => model.read([row(100, [[20, "Facture EDF"]])], info, config),
    /not_recognized/,
  );
});

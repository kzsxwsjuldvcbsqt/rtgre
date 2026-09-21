const test = require("node:test");
const assert = require("node:assert/strict");
const pdf = require("../../static/js/absence-pdf.js");

const font = {
  widthOfTextAtSize: (value, size) => Array.from(value).length * size,
};

test("PDF text wrapping preserves paragraphs and splits words wider than a cell", () => {
  assert.deepEqual(
    pdf.wrapText("Première ligne\nDeuxième ligne", font, 1, 20),
    ["Première ligne", "Deuxième ligne"],
  );
  assert.deepEqual(
    pdf.wrapText("mot-très-long", font, 1, 5).join(""),
    "mot-très-long",
  );
});

test("PDF text wrapping preserves French glyphs and the black bullet", () => {
  const value = "cœur • l’étudiant — délai";
  assert.equal(
    pdf.wrapText(value, font, 1, 40).join(" ").replace(/\s+/g, " "),
    value,
  );
});

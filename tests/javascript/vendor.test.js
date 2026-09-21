const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const config = require("../../config/absences.json");
const manifest = require("../../package.json");

test("distributed PDF libraries match the pinned audited npm packages byte for byte", () => {
  for (const [asset, name, file] of [
    ["library", "pdf-lib", "dist/pdf-lib.min.js"],
    ["fontkit", "@pdf-lib/fontkit", "dist/fontkit.umd.min.js"],
  ]) {
    const packagePath = require.resolve(name + "/package.json");
    assert.equal(require(packagePath).version, manifest.devDependencies[name]);
    assert.deepEqual(
      fs.readFileSync(
        path.resolve(__dirname, "../..", config.sheet.pdf_assets[asset]),
      ),
      fs.readFileSync(path.resolve(path.dirname(packagePath), file)),
      name,
    );
  }
});

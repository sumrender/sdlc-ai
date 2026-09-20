import assert from "node:assert/strict";
import { describe, it } from "node:test";

// e2e-coverage pulls in db/index.js (and therefore env.js) at import time.
// `postgres()` is lazy — it opens no socket until a query — so a syntactically
// valid URL is all the module graph needs to load in a test process.
process.env.DATABASE_URL ??= "postgres://sdlc:sdlc@127.0.0.1:5432/sdlc_test";
const { heuristicCovered, isSpecLike } = await import("./e2e-coverage.js");

const FE = { cwd: "fe", testDir: "e2e" };

// The exact changed-file list of task c3714ed6 / sumrender/meme#58, which
// reached Human Review with a green E2E badge and no e2e spec at all.
const REAL_RUN_CHANGED_FILES = [
  "ARCHITECTURE.md",
  "README.md",
  "fe/src/app/app.routes.ts",
  "fe/src/app/public/api-docs.component.html",
  "fe/src/app/public/api-docs.component.scss",
  "fe/src/app/public/api-docs.component.spec.ts",
  "fe/src/app/public/api-docs.component.ts",
];

describe("heuristicCovered", () => {
  it("does not treat an Angular unit spec outside the testDir as e2e coverage", () => {
    const result = heuristicCovered(REAL_RUN_CHANGED_FILES, FE);
    assert.equal(result.covered, false);
    assert.deepEqual(result.specFiles, []);
  });

  it("counts a real Playwright spec inside <cwd>/<testDir>", () => {
    const result = heuristicCovered([...REAL_RUN_CHANGED_FILES, "fe/e2e/api-docs.spec.ts"], FE);
    assert.equal(result.covered, true);
    assert.deepEqual(result.specFiles, ["fe/e2e/api-docs.spec.ts"]);
  });
});

describe("isSpecLike", () => {
  it("accepts a spec under the resolved testDir", () => {
    assert.equal(isSpecLike("fe/e2e/api-docs.spec.ts", FE), true);
  });

  it("rejects a unit spec co-located with app source", () => {
    assert.equal(isSpecLike("fe/src/app/public/api-docs.component.spec.ts", FE), false);
  });

  it("rejects a helper inside the testDir: support code is not coverage", () => {
    assert.equal(isSpecLike("fe/e2e/helpers/auth.ts", FE), false);
  });

  it("accepts a spec in a nested folder of the testDir", () => {
    assert.equal(isSpecLike("fe/e2e/public/api-docs.spec.ts", FE), true);
  });

  it("collapses the prefix to <testDir>/ when cwd is the repo root", () => {
    assert.equal(isSpecLike("e2e/foo.spec.ts", { cwd: ".", testDir: "e2e" }), true);
    assert.equal(isSpecLike("fe/e2e/foo.spec.ts", { cwd: ".", testDir: "e2e" }), false);
  });

  it("tolerates leading ./ and trailing slashes in the manifest", () => {
    assert.equal(isSpecLike("fe/e2e/foo.spec.ts", { cwd: "./fe/", testDir: "/e2e/" }), true);
  });

  it("rejects unit-test conventions the old rule accepted", () => {
    assert.equal(isSpecLike("fe/src/__tests__/thing.ts", FE), false);
    assert.equal(isSpecLike("fe/e2e/thing.test.ts", FE), false);
    assert.equal(isSpecLike("apps/api/src/pipeline/e2e-coverage.test.ts", FE), false);
  });

  it("accepts every Playwright spec suffix inside the testDir", () => {
    for (const name of ["a.spec.ts", "a.spec.tsx", "a.spec.js", "a.spec.mjs", "a.e2e.ts", "a.e2e.js"]) {
      assert.equal(isSpecLike(`fe/e2e/${name}`, FE), true, name);
    }
  });
});

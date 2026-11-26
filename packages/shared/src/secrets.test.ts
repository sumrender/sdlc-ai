import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  E2eSchema,
  UnitTestsSchema,
  redactSecrets,
  resolveSecretEnv,
  resolveSecretEnvOrThrow,
} from "./manifest.js";

const lookup = (values: Record<string, string | undefined>) => (name: string) => values[name];

describe("SecretRef env", () => {
  it("parses plain string env as before", () => {
    const u = UnitTestsSchema.parse({ command: "pnpm test", env: { FOO: "bar" } });
    assert.deepEqual(u.env, { FOO: "bar" });
    const e = E2eSchema.parse({ command: "pnpm e2e", env: { FOO: "bar" } });
    assert.deepEqual(e.env, { FOO: "bar" });
  });

  it("parses {env, optional} refs in unitTests.env and e2e.env", () => {
    const u = UnitTestsSchema.parse({ command: "pnpm test", env: { TOKEN: { env: "GH_TOKEN" } } });
    assert.deepEqual(u.env, { TOKEN: { env: "GH_TOKEN", optional: false } });
    const e = E2eSchema.parse({ command: "pnpm e2e", env: { TOKEN: { env: "GH_TOKEN", optional: true } } });
    assert.deepEqual(e.env, { TOKEN: { env: "GH_TOKEN", optional: true } });
  });

  it("resolves literals + required refs per invocation", () => {
    const { resolved, missing, secrets } = resolveSecretEnv(
      { LIT: "x", TOKEN: { env: "GH_TOKEN", optional: false } },
      lookup({ GH_TOKEN: "s3cr3t" }),
    );
    assert.deepEqual(resolved, { LIT: "x", TOKEN: "s3cr3t" });
    assert.deepEqual(missing, []);
    assert.deepEqual(secrets, ["s3cr3t"]);
  });

  it("fail-fast lists every missing required name", () => {
    const { missing } = resolveSecretEnv(
      { A: { env: "MISS_A", optional: false }, B: { env: "MISS_B", optional: false } },
      lookup({}),
    );
    assert.deepEqual(missing, ["A (env MISS_A)", "B (env MISS_B)"]);
    assert.throws(() => resolveSecretEnvOrThrow({ A: { env: "MISS_A", optional: false } }, lookup({})), /Missing required secrets: A \(env MISS_A\)/);
  });

  it("skips optional-missing keys", () => {
    const { resolved, missing } = resolveSecretEnv({ T: { env: "NOPE", optional: true } }, lookup({}));
    assert.deepEqual(resolved, {});
    assert.deepEqual(missing, []);
  });

  it("redacts resolved values longest-first", () => {
    assert.equal(redactSecrets("a s3cr3t and s3cr3t-long here", ["s3cr3t", "s3cr3t-long"]), "a <REDACTED> and <REDACTED> here");
    assert.equal(redactSecrets("nothing to hide", []), "nothing to hide");
  });
});

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

process.env.DATABASE_URL ??= "postgres://sdlc:sdlc@127.0.0.1:5432/sdlc_test";
const { SecretCrypto, formatSecretHint, parseEncryptionKey } = await import("./secrets.js");

const HEX_KEY_A = randomBytes(32).toString("hex");
const BASE64_KEY_B = randomBytes(32).toString("base64");

describe("parseEncryptionKey & formatSecretHint", () => {
  it("accepts 64-char hex and 32-byte base64 keys and rejects invalid ones", () => {
    assert.equal(parseEncryptionKey(HEX_KEY_A).length, 32);
    assert.equal(parseEncryptionKey(BASE64_KEY_B).length, 32);
    assert.throws(() => parseEncryptionKey("too-short"), /32-byte key/);
    assert.throws(() => parseEncryptionKey("z".repeat(64)), /32-byte key/);
  });

  it("masks secrets without leaking full short values", () => {
    assert.equal(formatSecretHint("ghp_12345678abcd"), "••••abcd");
    assert.equal(formatSecretHint("short"), "••••");
  });
});

describe("SecretCrypto AES-256-GCM", () => {
  it("round-trips UTF-8 plaintext with random non-deterministic IVs", () => {
    const crypto = new SecretCrypto({ key: HEX_KEY_A });
    const first = crypto.encrypt("super-secret-value");
    const second = crypto.encrypt("super-secret-value");

    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.equal(first.hint, "••••alue");
    assert.equal(crypto.decrypt(first.ciphertext), "super-secret-value");
    assert.equal(crypto.decrypt(second.ciphertext), "super-secret-value");
  });

  it("detects tampered ciphertext or auth tags", () => {
    const crypto = new SecretCrypto({ key: HEX_KEY_A });
    const { ciphertext } = crypto.encrypt("token-abc-123");
    const parts = ciphertext.split(":");
    const corrupted = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from("tampered").toString("base64")}`;
    assert.throws(() => crypto.decrypt(corrupted));
    assert.throws(() => crypto.decrypt("not-v1-format"), /Malformed/);
  });

  it("supports zero-downtime key rotation via SECRETS_ENCRYPTION_KEY_PREVIOUS", () => {
    const legacy = new SecretCrypto({ key: HEX_KEY_A });
    const encryptedWithOldKey = legacy.encrypt("rotated-token-9999").ciphertext;

    const rotated = new SecretCrypto({ key: BASE64_KEY_B, previousKey: HEX_KEY_A });
    assert.equal(rotated.decrypt(encryptedWithOldKey), "rotated-token-9999");

    const encryptedWithNewKey = rotated.encrypt("fresh-token-8888").ciphertext;
    assert.equal(rotated.decrypt(encryptedWithNewKey), "fresh-token-8888");
  });

  it("fails loudly in live mode when no encryption key is configured", () => {
    const unconfigured = new SecretCrypto({ allowFakeFallback: false });
    assert.throws(() => unconfigured.encrypt("abc"), /SECRETS_ENCRYPTION_KEY is not configured/);
  });

  it("allows ephemeral fallback only when allowFakeFallback is enabled", () => {
    const fake = new SecretCrypto({ allowFakeFallback: true });
    const { ciphertext } = fake.encrypt("fake-mode-token");
    assert.equal(fake.decrypt(ciphertext), "fake-mode-token");
  });
});

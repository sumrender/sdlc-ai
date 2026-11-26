import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";
import { HttpError } from "../errors.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const FORMAT_PREFIX = "v1";

// Deterministic dev-only key used only when SDLC_FAKES=true and SECRETS_ENCRYPTION_KEY is unset.
const FAKE_DEV_KEY = createHash("sha256").update("sdlc-ai-fakes-dev-key").digest();
let warnedFakeKey = false;

export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const b64 = Buffer.from(trimmed, "base64");
  if (b64.length === KEY_BYTES && b64.toString("base64").replace(/=+$/, "") === trimmed.replace(/=+$/, "")) {
    return b64;
  }
  throw new Error("SECRETS_ENCRYPTION_KEY must be a 32-byte key (64 hex chars or 44-char base64)");
}

export function formatSecretHint(plaintext: string): string {
  return plaintext.length >= 6 ? `••••${plaintext.slice(-4)}` : "••••";
}

export interface SecretCryptoOptions {
  key?: string;
  previousKey?: string;
  allowFakeFallback?: boolean;
}

export class SecretCrypto {
  private readonly rawKey?: string;
  private readonly rawPreviousKey?: string;
  private readonly allowFakeFallback: boolean;

  constructor(options: SecretCryptoOptions = {}) {
    this.rawKey = options.key;
    this.rawPreviousKey = options.previousKey;
    this.allowFakeFallback = options.allowFakeFallback ?? false;
  }

  private primaryKey(): Buffer {
    if (this.rawKey) return parseEncryptionKey(this.rawKey);
    if (this.allowFakeFallback) {
      if (!warnedFakeKey) {
        warnedFakeKey = true;
        console.warn("[secrets] SECRETS_ENCRYPTION_KEY not set; using ephemeral fake-mode key");
      }
      return FAKE_DEV_KEY;
    }
    throw new HttpError(
      500,
      "SECRETS_ENCRYPTION_KEY is not configured. Generate a 32-byte key (openssl rand -hex 32) and set it in .env.",
    );
  }

  private previousKey(): Buffer | null {
    return this.rawPreviousKey ? parseEncryptionKey(this.rawPreviousKey) : null;
  }

  encrypt(plaintext: string): { ciphertext: string; hint: string } {
    const key = this.primaryKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: `${FORMAT_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`,
      hint: formatSecretHint(plaintext),
    };
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(":");
    if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) {
      throw new Error("Malformed encrypted secret payload");
    }
    const iv = Buffer.from(parts[1]!, "base64");
    const tag = Buffer.from(parts[2]!, "base64");
    const data = Buffer.from(parts[3]!, "base64");

    const keys = [this.primaryKey()];
    const prev = this.previousKey();
    if (prev) keys.push(prev);

    let lastErr: unknown;
    for (const key of keys) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`Could not decrypt secret: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}

export const secretCrypto = new SecretCrypto({
  key: env.SECRETS_ENCRYPTION_KEY,
  previousKey: env.SECRETS_ENCRYPTION_KEY_PREVIOUS,
  allowFakeFallback: env.SDLC_FAKES,
});

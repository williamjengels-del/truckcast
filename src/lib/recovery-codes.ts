import { createHash, randomBytes } from "node:crypto";

// 2FA recovery codes — generation, formatting, and hashing.
//
// Codes are high-entropy random tokens; hashing with SHA-256 is
// sufficient because rainbow-table attacks aren't a realistic threat
// against 50-bit-of-entropy random strings. We're not protecting a
// chosen secret here, so a slow KDF (bcrypt/argon2) buys nothing for
// the cost.
//
// Format choices:
//   - 10 characters, alphanumeric uppercase
//   - Excluded ambiguous chars (0, O, 1, I, L) so operators can read
//     them off paper without confusion
//   - Displayed to operators with a hyphen at position 5 (XXXXX-XXXXX)
//     for readability; verify accepts either form

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars, no 0/O/1/I/L
const CODE_LENGTH = 10;

export const RECOVERY_CODE_COUNT = 8;

/**
 * Generate `count` cryptographically-random recovery codes.
 * Returns plaintext codes — the caller must hash them via
 * hashRecoveryCode() before storing.
 */
export function generateRecoveryCodes(
  count: number = RECOVERY_CODE_COUNT
): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(generateOneCode());
  }
  return codes;
}

function generateOneCode(): string {
  // crypto.randomBytes is uniformly distributed. Modulo bias is
  // negligible because 256 % 31 is small relative to the alphabet
  // size, but we use the rejection-sampling helper to avoid even
  // that worry — over 8 codes × 10 chars the cost is invisible.
  const bytes = randomBytes(CODE_LENGTH * 2); // overprovision for rejection
  let out = "";
  let i = 0;
  while (out.length < CODE_LENGTH && i < bytes.length) {
    const b = bytes[i++];
    if (b < 248) {
      // 248 = 31 * 8, the largest multiple of 31 below 256. Anything
      // 248-255 is rejected to prevent modulo bias.
      out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

/**
 * Format a code for display: insert a hyphen after position 5.
 *   "ABCDE12345" → "ABCDE-12345"
 */
export function formatRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== CODE_LENGTH) return normalized;
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

/**
 * Strip whitespace + hyphens, uppercase. Called on both store and
 * verify so "abcde-12345" and "ABCDE12345" hash to the same value.
 */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Stable hash for a recovery code. SHA-256 hex digest of the
 * normalized form. Storage and verification both go through this.
 */
export function hashRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code);
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Lexical-shape check on a candidate code. Used pre-DB-lookup to
 * reject obvious garbage before the verify endpoint hashes + queries.
 */
export function isWellFormedRecoveryCode(input: string): boolean {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== CODE_LENGTH) return false;
  for (const ch of normalized) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}

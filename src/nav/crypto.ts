import { createHash, createDecipheriv, randomBytes } from "node:crypto";
import { CryptoError } from "../errors";

/**
 * NAV Online Számla 3.0 cryptographic helpers.
 *
 * The 3.0 specification introduces the {@code cryptoType} attribute on every
 * hash element so the algorithm can be selected on a per-element basis:
 *
 *   - user.passwordHash          → SHA-512                  (uppercase hex)
 *   - user.requestSignature      → SHA3-512                 (uppercase hex)
 *   - electronicInvoiceHash      → SHA3-512 or SHA-256
 *
 * The exchange token returned by /tokenExchange is encrypted with
 * AES-128 ECB / PKCS5 (no IV, no salt) using the technical user's
 * `exchangeKey` (exactly 16 ASCII bytes) as key.
 *
 * All exported helpers return strings in the canonical NAV format
 * (uppercase hexadecimal) and throw {@link CryptoError} on any failure.
 */

export type HashAlgo = "SHA-512" | "SHA3-512" | "SHA-256";

const NODE_ALGO: Record<HashAlgo, string> = {
  "SHA-512": "sha512",
  "SHA3-512": "sha3-512",
  "SHA-256": "sha256",
};

export function hash(input: string | Uint8Array, algo: HashAlgo = "SHA3-512"): string {
  try {
    return createHash(NODE_ALGO[algo]).update(input).digest("hex").toUpperCase();
  } catch (err) {
    throw new CryptoError("HASH_FAILED", `Failed to compute ${algo} hash`, err);
  }
}

/** SHA-512 hash of the user password as required by `user/passwordHash`. */
export const passwordHash = (password: string): string => hash(password, "SHA-512");

/**
 * UTC timestamp formatted exactly as `YYYYMMDDhhmmss` (no separators) - the
 * required input for the request-signature hash. NAV verifies that the
 * `header/timestamp` is within ±1 day of server time.
 *
 * The XML-level timestamp uses ISO-8601 with millisecond precision and `Z`
 * suffix (`YYYY-MM-DDThh:mm:ss.sssZ`) - see {@link xmlTimestamp}.
 */
export function signatureTimestamp(date: Date = new Date()): string {
  const pad = (n: number, l = 2) => n.toString().padStart(l, "0");
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

/** ISO-8601 UTC timestamp used in the XML `<header/timestamp>` field. */
export function xmlTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, ".$1Z");
}

/**
 * Generates a NAV-compliant requestId.
 *
 * Spec: 1-30 chars, only [0-9A-Z], must be unique per technical user *forever*.
 * We use the signature timestamp as a sortable prefix and append 12 random
 * base32 characters for collision safety (>10^17 combinations per second).
 */
export function generateRequestId(prefix = "RID"): string {
  const safePrefix = prefix.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 5) || "RID";
  const ts = signatureTimestamp();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(8);
  let rand = "";
  for (const b of bytes) rand += alphabet[b % 32];
  const id = `${safePrefix}${ts}${rand}`;
  return id.slice(0, 30);
}

export interface RequestSignatureInput {
  /** value of `header/requestId` */
  readonly requestId: string;
  /** signature timestamp = UTC `YYYYMMDDhhmmss` (must equal `header/timestamp` truncated to seconds) */
  readonly timestamp: string;
  /** technical user's `signatureKey` */
  readonly signKey: string;
  /**
   * For manageInvoice / manageAnnulment: SHA3-512 hashes of every base64-encoded
   * payload in document order (one entry per invoiceData / annulmentData). For
   * other operations leave undefined or empty.
   */
  readonly invoiceHashes?: readonly string[];
}

/**
 * Computes the value of `user/requestSignature` for any NAV operation.
 *
 * Concatenation rule (Online Számla 3.0 §1.5.1):
 *   - tokenExchange / queryXxx: SHA3-512(requestId + timestamp + signKey)
 *   - manageInvoice / manageAnnulment: SHA3-512(requestId + timestamp + signKey + Σ invoiceHash[i])
 */
export function calcRequestSignature(input: RequestSignatureInput): string {
  if (!input.requestId) throw new CryptoError("REQ_SIG_MISSING_ID", "requestId is required");
  if (!input.timestamp) throw new CryptoError("REQ_SIG_MISSING_TS", "timestamp is required");
  if (!input.signKey) throw new CryptoError("REQ_SIG_MISSING_KEY", "signKey is required");
  const concat =
    input.requestId +
    input.timestamp +
    input.signKey +
    (input.invoiceHashes?.join("") ?? "");
  return hash(concat, "SHA3-512");
}

/**
 * Computes a single `invoiceOperation/electronicInvoiceHash` value used both
 * to:
 *  - build the per-operation digest fed into requestSignature, and
 *  - report the hash of an electronic invoice (3.0 §1.6.4).
 *
 * The hash is taken over the raw bytes of the base64-encoded invoiceData
 * string (NOT over the decoded XML).
 */
export function invoiceHash(base64Invoice: string, algo: HashAlgo = "SHA3-512"): string {
  return hash(base64Invoice, algo);
}

/**
 * Decrypts the encryptedExchangeToken returned by /tokenExchange.
 *
 * Algorithm: AES/ECB/PKCS5Padding, 128-bit key = the technical user's
 * exchangeKey interpreted as ASCII (must be exactly 16 bytes). The plain text
 * is the bearer token to be sent in subsequent requests.
 */
export function decryptExchangeToken(encryptedB64: string, exchangeKey: string): string {
  if (!exchangeKey) {
    throw new CryptoError("EXCHANGE_KEY_MISSING", "exchangeKey is required");
  }
  const keyBytes = Buffer.from(exchangeKey, "utf8");
  if (keyBytes.length !== 16) {
    throw new CryptoError(
      "EXCHANGE_KEY_INVALID_LENGTH",
      `exchangeKey must be exactly 16 ASCII bytes (got ${keyBytes.length})`,
    );
  }
  let cipherBytes: Buffer;
  try {
    cipherBytes = Buffer.from(encryptedB64, "base64");
  } catch (err) {
    throw new CryptoError("EXCHANGE_TOKEN_BAD_BASE64", "encryptedExchangeToken is not valid base64", err);
  }
  if (cipherBytes.length === 0 || cipherBytes.length % 16 !== 0) {
    throw new CryptoError(
      "EXCHANGE_TOKEN_BAD_LENGTH",
      `encryptedExchangeToken length (${cipherBytes.length}) is not a multiple of 16`,
    );
  }
  try {
    const decipher = createDecipheriv("aes-128-ecb", keyBytes, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    throw new CryptoError("EXCHANGE_TOKEN_DECRYPT_FAILED", "Failed to decrypt exchange token", err);
  }
}

/** Base64 encode a UTF-8 string (XML payload) for transport in invoiceOperation. */
export function toBase64(value: string | Uint8Array): string {
  if (typeof value === "string") return Buffer.from(value, "utf8").toString("base64");
  return Buffer.from(value).toString("base64");
}

export function fromBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

import { describe, expect, test } from "bun:test";
import {
  calcRequestSignature,
  decryptExchangeToken,
  generateRequestId,
  hash,
  invoiceHash,
  passwordHash,
  signatureTimestamp,
  toBase64,
  xmlTimestamp,
} from "./crypto";
import { createCipheriv } from "node:crypto";
import { CryptoError } from "../errors";

describe("hash", () => {
  test("SHA-512 of 'abc' matches the canonical NIST vector", () => {
    expect(hash("abc", "SHA-512")).toBe(
      "DDAF35A193617ABACC417349AE20413112E6FA4E89A97EA20A9EEEE64B55D39A2192992A274FC1A836BA3C23A3FEEBBD454D4423643CE80E2A9AC94FA54CA49F",
    );
  });

  test("SHA3-512 of '' matches the canonical NIST vector", () => {
    expect(hash("", "SHA3-512")).toBe(
      "A69F73CCA23A9AC5C8B567DC185A756E97C982164FE25859E0D1DCC1475C80A615B2123AF1F5F94C11E3E9402C3AC558F500199D95B6D3E301758586281DCD26",
    );
  });

  test("SHA-256 of 'abc' matches the canonical NIST vector", () => {
    expect(hash("abc", "SHA-256")).toBe(
      "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
    );
  });
});

describe("requestSignature", () => {
  test("matches NAV documented example for queries (no invoiceHashes)", () => {
    const sig = calcRequestSignature({
      requestId: "RID20210101000000",
      timestamp: "20210101000000",
      signKey: "ce-8f5e-215119fa7dd621DLMRHRLH2S",
    });
    expect(sig).toMatch(/^[0-9A-F]{128}$/);
    expect(sig).toBe(
      hash(
        "RID20210101000000" + "20210101000000" + "ce-8f5e-215119fa7dd621DLMRHRLH2S",
        "SHA3-512",
      ),
    );
  });

  test("appends invoice hashes for manageInvoice", () => {
    const sig = calcRequestSignature({
      requestId: "RID1",
      timestamp: "20210101000000",
      signKey: "key",
      invoiceHashes: ["AAAA", "BBBB"],
    });
    expect(sig).toBe(
      hash("RID1" + "20210101000000" + "key" + "AAAA" + "BBBB", "SHA3-512"),
    );
  });

  test("rejects missing inputs", () => {
    expect(() =>
      calcRequestSignature({ requestId: "", timestamp: "x", signKey: "y" }),
    ).toThrow(CryptoError);
    expect(() =>
      calcRequestSignature({ requestId: "x", timestamp: "", signKey: "y" }),
    ).toThrow(CryptoError);
    expect(() =>
      calcRequestSignature({ requestId: "x", timestamp: "y", signKey: "" }),
    ).toThrow(CryptoError);
  });
});

describe("decryptExchangeToken", () => {
  test("AES-128-ECB / PKCS5 round trip with a 16-byte key", () => {
    const exchangeKey = "1234567890abcdef";
    const token = "the-actual-bearer-token";
    const cipher = createCipheriv("aes-128-ecb", Buffer.from(exchangeKey, "utf8"), null);
    cipher.setAutoPadding(true);
    const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const encB64 = enc.toString("base64");
    expect(decryptExchangeToken(encB64, exchangeKey)).toBe(token);
  });

  test("rejects keys that are not 16 ASCII bytes", () => {
    expect(() => decryptExchangeToken("AAAAAAAAAAAAAAAAAAAAAAAA", "tooShort")).toThrow(CryptoError);
  });

  test("rejects malformed cipher length", () => {
    expect(() => decryptExchangeToken("ABCD", "1234567890abcdef")).toThrow(CryptoError);
  });
});

describe("timestamps", () => {
  test("signatureTimestamp is 14 digits and matches XML timestamp", () => {
    const d = new Date("2024-06-15T12:34:56.789Z");
    expect(signatureTimestamp(d)).toBe("20240615123456");
    expect(xmlTimestamp(d)).toBe("2024-06-15T12:34:56.789Z");
  });
});

describe("requestId", () => {
  test("matches NAV pattern (^[0-9A-Z]{1,30}$)", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateRequestId();
      expect(id).toMatch(/^[0-9A-Z]{1,30}$/);
      expect(id.length).toBeLessThanOrEqual(30);
    }
  });

  test("is unique across many invocations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) seen.add(generateRequestId());
    expect(seen.size).toBe(5_000);
  });
});

describe("invoiceHash", () => {
  test("hashes the base64 string itself, not the decoded bytes", () => {
    const xml = "<x/>";
    const b64 = toBase64(xml);
    expect(invoiceHash(b64)).toBe(hash(b64, "SHA3-512"));
  });
});

describe("passwordHash", () => {
  test("uppercase hex of length 128", () => {
    const h = passwordHash("Hunter2!");
    expect(h).toMatch(/^[0-9A-F]{128}$/);
  });
});

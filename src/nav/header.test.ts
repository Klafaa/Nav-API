import { describe, expect, test } from "bun:test";
import { buildCommonBlocks } from "./header";
import { hash } from "./crypto";
import type { NavCredentials, SoftwareInfo } from "./types";

const credentials: NavCredentials = {
  login: "abcDEFGHabcDEFG",
  password: "Hunter2!",
  signKey: "ce-8f5e-215119fa7dd621DLMRHRLH2S",
  exchangeKey: "1234567890abcdef",
  taxNumber: "12345678",
};

const software: SoftwareInfo = {
  softwareId: "HU12345678-1234567",
  softwareName: "TestApp",
  softwareOperation: "ONLINE_SERVICE",
  softwareMainVersion: "1.0.0",
  softwareDevName: "Dev",
  softwareDevContact: "dev@example.com",
  softwareDevCountryCode: "HU",
};

describe("buildCommonBlocks", () => {
  test("produces deterministic header for fixed inputs", () => {
    const fixed = new Date("2024-01-02T03:04:05.678Z");
    const a = buildCommonBlocks(credentials, software, {
      requestId: "RID001",
      now: fixed,
    });
    const b = buildCommonBlocks(credentials, software, {
      requestId: "RID001",
      now: fixed,
    });
    expect(a.requestSignature).toBe(b.requestSignature);
    expect(a.timestamp).toBe("2024-01-02T03:04:05.678Z");
    expect(a.signatureTs).toBe("20240102030405");
    expect(a.requestSignature).toBe(
      hash("RID001" + "20240102030405" + credentials.signKey, "SHA3-512"),
    );
  });

  test("incorporates invoice hashes for manageInvoice", () => {
    const fixed = new Date("2024-01-02T03:04:05.678Z");
    const a = buildCommonBlocks(credentials, software, {
      requestId: "RID001",
      now: fixed,
      invoiceHashes: ["HASH1", "HASH2"],
    });
    expect(a.requestSignature).toBe(
      hash(
        "RID001" + "20240102030405" + credentials.signKey + "HASH1" + "HASH2",
        "SHA3-512",
      ),
    );
  });

  test("user block contains cryptoType attributes per 3.0", () => {
    const built = buildCommonBlocks(credentials, software, { now: new Date() });
    const pwd = built.userBlock["common:passwordHash"] as Record<string, unknown>;
    const sig = built.userBlock["common:requestSignature"] as Record<string, unknown>;
    expect(pwd["@_cryptoType"]).toBe("SHA-512");
    expect(sig["@_cryptoType"]).toBe("SHA3-512");
  });
});

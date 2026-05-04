/**
 * Smoke test against NAV's public test endpoint.
 *
 * We deliberately use bogus credentials so NAV will respond with one of:
 *   - INVALID_USER_CREDENTIAL (HTTP 400) – our XML parsed correctly
 *   - INVALID_REQUEST_SIGNATURE (HTTP 400) – signature is rejected
 *   - SCHEMA_VIOLATION (HTTP 400) – our XML is malformed
 *
 * The first two prove that the gateway produces well-formed, schema-valid
 * requests; only SCHEMA_VIOLATION would indicate a real bug. We assert that
 * SCHEMA_VIOLATION does NOT come back.
 */
import { describe, expect, test } from "bun:test";
import { NavClient } from "./client";
import { isNavError } from "../errors";
import type { NavCredentials, SoftwareInfo } from "./types";

const RUN_INTEGRATION = process.env.RUN_NAV_INTEGRATION === "1";

const credentials: NavCredentials = {
  login: "FAKEUSER0000000",
  password: "FakePassword1!",
  signKey: "fake-fake-fake-fake-fake-key-1234",
  exchangeKey: "1234567890abcdef",
  taxNumber: "12345678",
};

const software: SoftwareInfo = {
  softwareId: "HU12345678-1234567",
  softwareName: "NAV-Integ-Test",
  softwareOperation: "ONLINE_SERVICE",
  softwareMainVersion: "1.0.0",
  softwareDevName: "Integration Tester",
  softwareDevContact: "test@example.com",
  softwareDevCountryCode: "HU",
};

describe.skipIf(!RUN_INTEGRATION)("NAV /tokenExchange (test env)", () => {
  test("rejects bogus credentials but accepts schema", async () => {
    const client = new NavClient({
      baseUrl: "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3",
      credentials,
      software,
    });

    let caught: unknown;
    try {
      await client.tokenExchange();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    if (!isNavError(caught)) throw caught;
    expect(caught.code).not.toBe("SCHEMA_VIOLATION");
    expect(caught.code).not.toBe("INVALID_REQUEST");
    // Acceptable codes: INVALID_SECURITY_USER, INVALID_REQUEST_SIGNATURE,
    // INVALID_USER_CREDENTIAL, INVALID_REQUEST_TIMESTAMP, etc.
    console.log(`[integration] tokenExchange → ${caught.code}: ${caught.message}`);
  }, 30_000);
});

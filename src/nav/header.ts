import { ATTR_KEY } from "./xml";
import {
  HEADER_VERSION,
  NAV_NAMESPACES,
  REQUEST_VERSION,
  type NavCredentials,
  type SoftwareInfo,
} from "./types";
import {
  calcRequestSignature,
  generateRequestId,
  passwordHash,
  signatureTimestamp,
  xmlTimestamp,
} from "./crypto";

export interface BuiltHeader {
  readonly requestId: string;
  readonly timestamp: string;
  readonly signatureTs: string;
  readonly headerBlock: Record<string, unknown>;
  readonly userBlock: Record<string, unknown>;
  readonly softwareBlock: Record<string, unknown>;
  readonly requestSignature: string;
}

/**
 * Builds the three common XML blocks shared by every NAV operation:
 *  - common:header     (requestId, timestamp, requestVersion, headerVersion)
 *  - common:user       (login, passwordHash, taxNumber, requestSignature)
 *  - SoftwareType      (softwareId + descriptive metadata)
 *
 * The function returns the JS objects ready to be merged into the operation
 * request body. The {@code requestSignature} value is computed using
 * SHA3-512(requestId + signatureTimestamp + signKey + Σ invoiceHash[i]).
 */
export function buildCommonBlocks(
  credentials: NavCredentials,
  software: SoftwareInfo,
  options: {
    invoiceHashes?: readonly string[];
    requestId?: string;
    now?: Date;
  } = {},
): BuiltHeader {
  const now = options.now ?? new Date();
  const requestId = options.requestId ?? generateRequestId();
  const timestamp = xmlTimestamp(now);
  const signatureTs = signatureTimestamp(now);

  const requestSignature = calcRequestSignature({
    requestId,
    timestamp: signatureTs,
    signKey: credentials.signKey,
    invoiceHashes: options.invoiceHashes,
  });

  const headerBlock: Record<string, unknown> = {
    "common:requestId": requestId,
    "common:timestamp": timestamp,
    "common:requestVersion": REQUEST_VERSION,
    "common:headerVersion": HEADER_VERSION,
  };

  const userBlock: Record<string, unknown> = {
    "common:login": credentials.login,
    "common:passwordHash": {
      [ATTR_KEY("cryptoType")]: "SHA-512",
      "#text": passwordHash(credentials.password),
    },
    "common:taxNumber": credentials.taxNumber,
    "common:requestSignature": {
      [ATTR_KEY("cryptoType")]: "SHA3-512",
      "#text": requestSignature,
    },
  };

  const softwareBlock: Record<string, unknown> = {
    softwareId: software.softwareId,
    softwareName: software.softwareName,
    softwareOperation: software.softwareOperation,
    softwareMainVersion: software.softwareMainVersion,
    softwareDevName: software.softwareDevName,
    softwareDevContact: software.softwareDevContact,
    ...(software.softwareDevCountryCode
      ? { softwareDevCountryCode: software.softwareDevCountryCode }
      : {}),
    ...(software.softwareDevTaxNumber
      ? { softwareDevTaxNumber: software.softwareDevTaxNumber }
      : {}),
  };

  return {
    requestId,
    timestamp,
    signatureTs,
    headerBlock,
    userBlock,
    softwareBlock,
    requestSignature,
  };
}

/**
 * Returns the standard root attributes (xmlns + xmlns:common) used by every
 * NAV 3.0 request. Concrete operations override the default namespace by
 * setting `xmlns` on their own root element.
 */
export function rootAttrs(defaultNs: string = NAV_NAMESPACES.api): Record<string, string> {
  return {
    xmlns: defaultNs,
    "xmlns:common": NAV_NAMESPACES.common,
  };
}

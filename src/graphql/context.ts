import { eq } from "drizzle-orm";
import { ConfigError } from "../errors";
import { config } from "../config";
import { db, schema } from "../db";
import { NavClient } from "../nav/client";
import type { NavCredentials, SoftwareInfo } from "../nav/types";

export interface GraphQLContext {
  readonly db: typeof db;
  readonly software: SoftwareInfo;
  readonly defaultClient: NavClient | null;
  readonly clientFor: (taxNumber: string) => Promise<NavClient>;
}

function softwareFromConfig(): SoftwareInfo {
  if (!config.NAV_SOFTWARE_ID) {
    throw new ConfigError(
      "SOFTWARE_ID_MISSING",
      "NAV_SOFTWARE_ID is required (must be 18 chars matching /^[0-9A-Z\\-]{18}$/)",
    );
  }
  return {
    softwareId: config.NAV_SOFTWARE_ID,
    softwareName: config.NAV_SOFTWARE_NAME,
    softwareOperation: config.NAV_SOFTWARE_OPERATION,
    softwareMainVersion: config.NAV_SOFTWARE_MAIN_VERSION,
    softwareDevName: config.NAV_SOFTWARE_DEV_NAME,
    softwareDevContact: config.NAV_SOFTWARE_DEV_CONTACT,
    softwareDevCountryCode: config.NAV_SOFTWARE_DEV_COUNTRY_CODE,
    softwareDevTaxNumber: config.NAV_SOFTWARE_DEV_TAX_NUMBER,
  };
}

function defaultCredentials(): NavCredentials | null {
  const { NAV_LOGIN, NAV_PASSWORD, NAV_SIGN_KEY, NAV_EXCHANGE_KEY, NAV_TAX_NUMBER } = config;
  if (!NAV_LOGIN || !NAV_PASSWORD || !NAV_SIGN_KEY || !NAV_EXCHANGE_KEY || !NAV_TAX_NUMBER) {
    return null;
  }
  return {
    login: NAV_LOGIN,
    password: NAV_PASSWORD,
    signKey: NAV_SIGN_KEY,
    exchangeKey: NAV_EXCHANGE_KEY,
    taxNumber: NAV_TAX_NUMBER,
  };
}

export async function buildContext(): Promise<GraphQLContext> {
  const software = softwareFromConfig();
  const defaults = defaultCredentials();
  const defaultClient = defaults
    ? new NavClient({
        baseUrl: config.NAV_BASE_URL,
        credentials: defaults,
        software,
      })
    : null;

  const clientCache = new Map<string, NavClient>();

  const clientFor = async (taxNumber: string): Promise<NavClient> => {
    if (clientCache.has(taxNumber)) return clientCache.get(taxNumber)!;
    const rows = await db
      .select()
      .from(schema.technicalUsers)
      .where(eq(schema.technicalUsers.taxNumber, taxNumber))
      .limit(1);
    const row = rows[0];
    if (!row) {
      if (defaults && defaults.taxNumber === taxNumber && defaultClient) {
        clientCache.set(taxNumber, defaultClient);
        return defaultClient;
      }
      throw new ConfigError(
        "TECHNICAL_USER_NOT_FOUND",
        `No technical user registered for taxNumber=${taxNumber}`,
      );
    }
    const client = new NavClient({
      baseUrl: config.NAV_BASE_URL,
      credentials: {
        login: row.login,
        password: row.password,
        signKey: row.signKey,
        exchangeKey: row.exchangeKey,
        taxNumber: row.taxNumber,
      },
      software,
    });
    clientCache.set(taxNumber, client);
    return client;
  };

  return { db, software, defaultClient, clientFor };
}

import { z } from "zod";

const SoftwareOperation = z.enum(["ONLINE_SERVICE", "LOCAL_SOFTWARE"]);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  DATABASE_URL: z.string().min(1).default("./data/nav.sqlite"),

  NAV_BASE_URL: z
    .string()
    .url()
    .default("https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3"),

  NAV_LOGIN: z.string().min(6).max(15).optional(),
  NAV_PASSWORD: z.string().min(1).max(50).optional(),
  NAV_SIGN_KEY: z.string().min(1).optional(),
  NAV_EXCHANGE_KEY: z.string().min(16).optional(),
  NAV_TAX_NUMBER: z.string().regex(/^\d{8}$/).optional(),

  NAV_SOFTWARE_ID: z.string().regex(/^[0-9A-Z\-]{18}$/).optional(),
  NAV_SOFTWARE_NAME: z.string().max(50).default("NAV-Online-Szamla-Gateway"),
  NAV_SOFTWARE_OPERATION: SoftwareOperation.default("ONLINE_SERVICE"),
  NAV_SOFTWARE_MAIN_VERSION: z.string().max(15).default("1.0.0"),
  NAV_SOFTWARE_DEV_NAME: z.string().max(512).default("Unknown Developer"),
  NAV_SOFTWARE_DEV_CONTACT: z.string().max(200).default("dev@example.com"),
  NAV_SOFTWARE_DEV_COUNTRY_CODE: z.string().regex(/^[A-Z]{2}$/).default("HU"),
  NAV_SOFTWARE_DEV_TAX_NUMBER: z.string().max(50).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[config] Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const config: AppConfig = parsed.data;

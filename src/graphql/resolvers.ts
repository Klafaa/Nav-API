import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { schema } from "../db";
import {
  ConfigError,
  ValidationError,
  isNavError,
  wrapUnknown,
} from "../errors";
import { fromBase64 } from "../nav/crypto";
import { builder } from "./builder";
import type { GraphQLContext } from "./context";
import { ErrorUnion } from "./errors";
import {
  AnnulmentOperationInputType,
  InvoiceDataInputType,
  InvoiceDataType,
  InvoiceDirectionEnum,
  InvoiceOperationEnum,
  InvoiceOperationInputType,
  ManageInvoiceResultType,
  QueryInvoiceDigestResultType,
  QueryTransactionStatusResultType,
  SoftwareInfoType,
  TaxpayerType,
} from "./types";
import { buildInvoiceDataXml, type MinimalInvoiceData } from "../nav/invoiceData";

/* ============================================================
 * Result-union helpers (one per operation)
 * ============================================================ */

/**
 * Plain-object wrapper for NAV errors used in GraphQL responses.
 *
 * GraphQL execution treats `Error` instances returned from resolvers as if
 * they were thrown, so we cannot return a NavError directly. We instead
 * publish a structurally identical wrapper (no Error prototype) and use the
 * `__navErrorTag` discriminator in `resolveType`.
 */
const NAV_ERROR_TAG = Symbol.for("nav.errorWrapper");

interface NavErrorWrapper {
  readonly [NAV_ERROR_TAG]: true;
  readonly __typename: string;
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly category: string;
  readonly severity: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
  readonly path?: string;
  readonly details?: unknown;
  readonly timeoutMs?: number;
  readonly validationResultCode?: string;
  readonly invoiceIndex?: number;
  readonly batchIndex?: number;
  readonly messages?: ReadonlyArray<unknown>;
}

function wrapError(err: unknown): NavErrorWrapper {
  const ne = isNavError(err) ? err : wrapUnknown(err);
  const json = ne.toJSON() as unknown as Record<string, unknown>;
  return {
    [NAV_ERROR_TAG]: true,
    __typename: ne.name,
    name: ne.name,
    code: ne.code,
    message: ne.message,
    category: ne.category,
    severity: ne.severity,
    httpStatus: ne.httpStatus,
    requestId: ne.requestId,
    path: ne.path,
    details: (json as { details?: unknown }).details,
    timeoutMs: (ne as { timeoutMs?: number }).timeoutMs,
    validationResultCode: (json as { validationResultCode?: string })
      .validationResultCode,
    invoiceIndex: (json as { invoiceIndex?: number }).invoiceIndex,
    batchIndex: (json as { batchIndex?: number }).batchIndex,
    messages: (json as { messages?: ReadonlyArray<unknown> }).messages,
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: NavErrorWrapper };

const errorOrNull = (r: { ok: boolean; error?: NavErrorWrapper }) =>
  (r.ok ? null : r.error) as never;

const ManageInvoicePayload = builder
  .objectRef<Result<{ transactionId: string; requestId: string; timestamp: string }>>(
    "ManageInvoicePayload",
  )
  .implement({
    fields: (t) => ({
      ok: t.boolean({ resolve: (r) => r.ok }),
      result: t.field({
        type: ManageInvoiceResultType,
        nullable: true,
        resolve: (r) => (r.ok ? r.data : null),
      }),
      error: t.field({
        type: ErrorUnion,
        nullable: true,
        resolve: errorOrNull,
      }),
    }),
  });

const QueryTransactionStatusPayload = builder
  .objectRef<Result<import("../nav/types").QueryTransactionStatusResult>>(
    "QueryTransactionStatusPayload",
  )
  .implement({
    fields: (t) => ({
      ok: t.boolean({ resolve: (r) => r.ok }),
      status: t.field({
        type: QueryTransactionStatusResultType,
        nullable: true,
        resolve: (r) => (r.ok ? r.data : null),
      }),
      error: t.field({
        type: ErrorUnion,
        nullable: true,
        resolve: errorOrNull,
      }),
    }),
  });

const QueryInvoiceDigestPayload = builder
  .objectRef<Result<import("../nav/types").QueryInvoiceDigestResult>>(
    "QueryInvoiceDigestPayload",
  )
  .implement({
    fields: (t) => ({
      ok: t.boolean({ resolve: (r) => r.ok }),
      digest: t.field({
        type: QueryInvoiceDigestResultType,
        nullable: true,
        resolve: (r) => (r.ok ? r.data : null),
      }),
      error: t.field({
        type: ErrorUnion,
        nullable: true,
        resolve: errorOrNull,
      }),
    }),
  });

const QueryInvoiceDataPayload = builder
  .objectRef<Result<{ invoiceDataBase64?: string; invoiceDataXml?: string }>>(
    "QueryInvoiceDataPayload",
  )
  .implement({
    fields: (t) => ({
      ok: t.boolean({ resolve: (r) => r.ok }),
      invoice: t.field({
        type: InvoiceDataType,
        nullable: true,
        resolve: (r) => (r.ok ? r.data : null),
      }),
      error: t.field({
        type: ErrorUnion,
        nullable: true,
        resolve: errorOrNull,
      }),
    }),
  });

const QueryTaxpayerPayload = builder
  .objectRef<Result<import("../nav/types").QueryTaxpayerResult>>("QueryTaxpayerPayload")
  .implement({
    fields: (t) => ({
      ok: t.boolean({ resolve: (r) => r.ok }),
      taxpayer: t.field({
        type: TaxpayerType,
        nullable: true,
        resolve: (r) => (r.ok ? r.data : null),
      }),
      error: t.field({
        type: ErrorUnion,
        nullable: true,
        resolve: errorOrNull,
      }),
    }),
  });
type ResultWithValid =
  | { ok: true; valid: boolean }
  | { ok: false; error: NavErrorWrapper };

const QueryInvoiceCheckPayload = builder
  .objectRef<ResultWithValid>("QueryInvoiceCheckPayload")
  .implement({
    fields: (t) => ({
      ok: t.boolean({ resolve: (r) => r.ok }),
      valid: t.boolean({
        nullable: true,
        resolve: (r) => (r.ok ? r.valid : null),
      }),
      error: t.field({
        type: ErrorUnion,
        nullable: true,
        resolve: (r) => (r.ok ? null : r.error) as never,
      }),
    }),
  });

/**
 * Wraps a NAV operation in try/catch so the error always flows back via the
 * GraphQL union instead of bubbling out as a top-level GraphQL error.
 */
async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: wrapError(err) };
  }
}

/* ============================================================
 * Resolver helpers
 * ============================================================ */

async function resolveTaxNumber(
  ctx: GraphQLContext,
  taxNumber?: string | null,
): Promise<string> {
  if (taxNumber) return taxNumber;
  if (ctx.defaultClient) return config.NAV_TAX_NUMBER!;
  throw new ConfigError(
    "TAX_NUMBER_REQUIRED",
    "taxNumber is required when no default technical user is configured",
  );
}

/* ============================================================
 * QUERIES
 * ============================================================ */

builder.queryFields((t) => ({
  health: t.field({
    type: "JSON",
    description: "Liveness probe – returns gateway version, NAV environment and software info.",
    resolve: (_p, _a, ctx) => ({
      ok: true,
      version: "1.0.0",
      navEnvironment: config.NAV_BASE_URL,
      software: ctx.software,
      timestamp: new Date().toISOString(),
    }),
  }),

  software: t.field({
    type: SoftwareInfoType,
    resolve: (_p, _a, ctx) => ctx.software,
  }),

  queryTransactionStatus: t.field({
    type: QueryTransactionStatusPayload,
    args: {
      transactionId: t.arg.string({ required: true }),
      taxNumber: t.arg.string({
        required: false,
        description: "Override default technical user (8-digit core tax number)",
      }),
      returnOriginalRequest: t.arg.boolean({ required: false }),
    },
    resolve: async (_p, args, ctx) =>
      safe(async () => {
        const taxNumber = await resolveTaxNumber(ctx, args.taxNumber);
        const client = await ctx.clientFor(taxNumber);
        return client.queryTransactionStatus(args.transactionId, {
          returnOriginalRequest: args.returnOriginalRequest ?? undefined,
        });
      }),
  }),

  queryInvoiceDigest: t.field({
    type: QueryInvoiceDigestPayload,
    description:
      "Pageable digest listing of invoices in a given direction over an insDate range.",
    args: {
      page: t.arg.int({ required: true }),
      direction: t.arg({ type: InvoiceDirectionEnum, required: true }),
      dateFrom: t.arg.string({ required: true, description: "ISO-8601 UTC, inclusive" }),
      dateTo: t.arg.string({ required: true, description: "ISO-8601 UTC, inclusive" }),
      transactionId: t.arg.string({ required: false }),
      taxNumber: t.arg.string({ required: false }),
    },
    resolve: async (_p, args, ctx) =>
      safe(async () => {
        if (args.page < 1) {
          throw new ValidationError("PAGE_INVALID", "page must be >= 1");
        }
        const taxNumber = await resolveTaxNumber(ctx, args.taxNumber);
        const client = await ctx.clientFor(taxNumber);
        return client.queryInvoiceDigest({
          page: args.page,
          direction: args.direction,
          dateFrom: args.dateFrom,
          dateTo: args.dateTo,
          transactionParams: args.transactionId
            ? { transactionId: args.transactionId }
            : undefined,
        });
      }),
  }),

  queryInvoiceData: t.field({
    type: QueryInvoiceDataPayload,
    args: {
      invoiceNumber: t.arg.string({ required: true }),
      direction: t.arg({ type: InvoiceDirectionEnum, required: true }),
      batchIndex: t.arg.int({ required: false }),
      supplierTaxNumber: t.arg.string({ required: false }),
      taxNumber: t.arg.string({ required: false }),
      decode: t.arg.boolean({
        required: false,
        defaultValue: true,
        description: "Decode base64 to invoiceDataXml in the response.",
      }),
    },
    resolve: async (_p, args, ctx) =>
      safe(async () => {
        const taxNumber = await resolveTaxNumber(ctx, args.taxNumber);
        const client = await ctx.clientFor(taxNumber);
        const res = await client.queryInvoiceData({
          invoiceNumber: args.invoiceNumber,
          direction: args.direction,
          batchIndex: args.batchIndex ?? undefined,
          supplierTaxNumber: args.supplierTaxNumber ?? undefined,
        });
        return {
          invoiceDataBase64: res.invoiceDataBase64,
          invoiceDataXml:
            args.decode && res.invoiceDataBase64
              ? fromBase64(res.invoiceDataBase64)
              : undefined,
        };
      }),
  }),

  queryInvoiceCheck: t.field({
    type: QueryInvoiceCheckPayload,
    description: "Returns true if the invoice exists in NAV's database for the given user.",
    args: {
      invoiceNumber: t.arg.string({ required: true }),
      direction: t.arg({ type: InvoiceDirectionEnum, required: true }),
      batchIndex: t.arg.int({ required: false }),
      supplierTaxNumber: t.arg.string({ required: false }),
      taxNumber: t.arg.string({ required: false }),
    },
    resolve: async (_p, args, ctx): Promise<ResultWithValid> => {
      try {
        const taxNumber = await resolveTaxNumber(ctx, args.taxNumber);
        const client = await ctx.clientFor(taxNumber);
        const res = await client.queryInvoiceCheck({
          invoiceNumber: args.invoiceNumber,
          direction: args.direction,
          batchIndex: args.batchIndex ?? undefined,
          supplierTaxNumber: args.supplierTaxNumber ?? undefined,
        });
        return { ok: true, valid: res.invoiceCheckResult };
      } catch (err) {
        return { ok: false, error: wrapError(err) };
      }
    },
  }),

  queryTaxpayer: t.field({
    type: QueryTaxpayerPayload,
    args: {
      taxNumber: t.arg.string({ required: true, description: "Target taxpayer (8 digits)" }),
      asTaxNumber: t.arg.string({
        required: false,
        description: "Tax number of the technical user issuing the query",
      }),
    },
    resolve: async (_p, args, ctx) =>
      safe(async () => {
        const issuer = await resolveTaxNumber(ctx, args.asTaxNumber);
        const client = await ctx.clientFor(issuer);
        return client.queryTaxpayer(args.taxNumber);
      }),
  }),
}));

/* ============================================================
 * MUTATIONS
 * ============================================================ */

builder.mutationFields((t) => ({
  manageInvoice: t.field({
    type: ManageInvoicePayload,
    description:
      "Submit one or more invoice operations (CREATE / MODIFY / STORNO). Max 100 per batch.",
    args: {
      taxNumber: t.arg.string({ required: false }),
      operations: t.arg({
        type: [InvoiceOperationInputType],
        required: true,
      }),
    },
    resolve: async (_p, args, ctx) =>
      safe(async () => {
        const taxNumber = await resolveTaxNumber(ctx, args.taxNumber);
        const client = await ctx.clientFor(taxNumber);
        const result = await client.manageInvoice(
          args.operations.map((op) => ({
            index: op.index,
            operation: op.operation,
            invoiceDataXml: op.invoiceDataXml ?? undefined,
            invoiceDataBase64: op.invoiceDataBase64 ?? undefined,
            completenessIndicator: op.completenessIndicator ?? undefined,
            electronicInvoiceHash: op.electronicInvoiceHash ?? undefined,
          })),
        );
        await ctx.db.insert(schema.transactions).values({
          id: randomUUID(),
          transactionId: result.transactionId,
          requestId: result.requestId,
          operation: "manageInvoice",
          status: "PENDING",
          technicalUserId: taxNumber,
          requestTimestamp: result.timestamp,
        });
        for (const op of args.operations) {
          await ctx.db.insert(schema.invoiceOps).values({
            id: randomUUID(),
            transactionId: result.transactionId,
            indexInBatch: op.index,
            operation: op.operation,
            invoiceDataBase64: op.invoiceDataBase64 ?? null,
            electronicInvoiceHash: op.electronicInvoiceHash ?? null,
            completenessIndicator: op.completenessIndicator ?? false,
          });
        }
        return result;
      }),
  }),

  submitInvoice: t.field({
    type: ManageInvoicePayload,
    description:
      "Convenience mutation: build an InvoiceData XML from structured input and submit it as a single CREATE/MODIFY/STORNO operation.",
    args: {
      taxNumber: t.arg.string({ required: false }),
      operation: t.arg({
        type: InvoiceOperationEnum,
        required: true,
        defaultValue: "CREATE",
      }),
      data: t.arg({ type: InvoiceDataInputType, required: true }),
    },
    resolve: async (_p, args, ctx) =>
      safe(async () => {
        const taxNumber = await resolveTaxNumber(ctx, args.taxNumber);
        const client = await ctx.clientFor(taxNumber);
        const xml = buildInvoiceDataXml(args.data as unknown as MinimalInvoiceData);
        const result = await client.manageInvoice([
          {
            index: 1,
            operation: args.operation,
            invoiceDataXml: xml,
            completenessIndicator: args.data.completenessIndicator ?? false,
          },
        ]);
        await ctx.db.insert(schema.transactions).values({
          id: randomUUID(),
          transactionId: result.transactionId,
          requestId: result.requestId,
          operation: "manageInvoice",
          status: "PENDING",
          technicalUserId: taxNumber,
          requestTimestamp: result.timestamp,
        });
        await ctx.db.insert(schema.invoiceOps).values({
          id: randomUUID(),
          transactionId: result.transactionId,
          indexInBatch: 1,
          operation: args.operation,
          invoiceNumber: args.data.invoiceNumber,
          completenessIndicator: args.data.completenessIndicator ?? false,
        });
        return result;
      }),
  }),

  manageAnnulment: t.field({
    type: ManageInvoicePayload,
    description: "Submit one or more technical annulments (érvénytelenítés).",
    args: {
      taxNumber: t.arg.string({ required: false }),
      operations: t.arg({ type: [AnnulmentOperationInputType], required: true }),
    },
    resolve: async (_p, args, ctx) =>
      safe(async () => {
        const taxNumber = await resolveTaxNumber(ctx, args.taxNumber);
        const client = await ctx.clientFor(taxNumber);
        const result = await client.manageAnnulment(
          args.operations.map((op) => ({
            index: op.index,
            operation: op.operation,
            annulmentReference: op.annulmentReference,
            annulmentTimestamp: op.annulmentTimestamp,
            annulmentCode: op.annulmentCode,
            annulmentReason: op.annulmentReason,
          })),
        );
        await ctx.db.insert(schema.transactions).values({
          id: randomUUID(),
          transactionId: result.transactionId,
          requestId: result.requestId,
          operation: "manageAnnulment",
          status: "PENDING",
          technicalUserId: taxNumber,
          requestTimestamp: result.timestamp,
        });
        return result;
      }),
  }),

  registerTechnicalUser: t.field({
    type: "JSON",
    description:
      "Persist a NAV technical user. Multiple users per gateway are supported; resolvers select by taxNumber.",
    args: {
      taxNumber: t.arg.string({ required: true }),
      login: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
      signKey: t.arg.string({ required: true }),
      exchangeKey: t.arg.string({ required: true }),
      label: t.arg.string({ required: false }),
    },
    resolve: async (_p, args, ctx) => {
      if (!/^\d{8}$/.test(args.taxNumber)) {
        throw new ValidationError("TAX_NUMBER_INVALID", "taxNumber must be 8 digits");
      }
      if (Buffer.byteLength(args.exchangeKey, "utf8") !== 16) {
        throw new ValidationError(
          "EXCHANGE_KEY_INVALID",
          "exchangeKey must be exactly 16 ASCII bytes",
        );
      }
      const id = randomUUID();
      await ctx.db
        .insert(schema.technicalUsers)
        .values({
          id,
          taxNumber: args.taxNumber,
          login: args.login,
          password: args.password,
          signKey: args.signKey,
          exchangeKey: args.exchangeKey,
          label: args.label ?? null,
        })
        .onConflictDoNothing();
      return { id, taxNumber: args.taxNumber };
    },
  }),

  deleteTechnicalUser: t.boolean({
    args: { taxNumber: t.arg.string({ required: true }) },
    resolve: async (_p, args, ctx) => {
      await ctx.db
        .delete(schema.technicalUsers)
        .where(eq(schema.technicalUsers.taxNumber, args.taxNumber));
      return true;
    },
  }),
}));

export {};

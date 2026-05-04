import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Drizzle schema for the NAV gateway.
 *
 * We persist:
 *  - `technicalUsers`: NAV credentials per tax number (allows multi-tenant).
 *  - `transactions`:   every manageInvoice / manageAnnulment submission.
 *  - `invoiceOps`:     individual invoice operations within a transaction.
 *  - `auditLog`:       structured log of every NAV request/response.
 */

const now = () => sql`CURRENT_TIMESTAMP`;

export const technicalUsers = sqliteTable(
  "technical_users",
  {
    id: text("id").primaryKey(),
    taxNumber: text("tax_number").notNull(),
    login: text("login").notNull(),
    /** Stored encrypted at rest in production – the gateway just keeps as-is. */
    password: text("password").notNull(),
    signKey: text("sign_key").notNull(),
    exchangeKey: text("exchange_key").notNull(),
    label: text("label"),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
  },
  (t) => ({
    taxNumberIdx: index("idx_tech_users_tax_number").on(t.taxNumber),
    loginIdx: index("idx_tech_users_login").on(t.login),
  }),
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),                 // gateway uuid
    transactionId: text("transaction_id").notNull().unique(),
    requestId: text("request_id").notNull(),
    operation: text("operation").notNull(),       // manageInvoice | manageAnnulment
    status: text("status").notNull().default("PENDING"), // PENDING | DONE | FAILED
    technicalUserId: text("technical_user_id").notNull(),
    requestTimestamp: text("request_timestamp").notNull(),
    finishedAt: text("finished_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => ({
    statusIdx: index("idx_tx_status").on(t.status),
    userIdx: index("idx_tx_user").on(t.technicalUserId),
  }),
);

export const invoiceOps = sqliteTable(
  "invoice_ops",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id").notNull(),
    indexInBatch: integer("index_in_batch").notNull(),
    operation: text("operation").notNull(),       // CREATE | MODIFY | STORNO | ANNUL
    invoiceNumber: text("invoice_number"),
    invoiceDataBase64: text("invoice_data_base64"),
    electronicInvoiceHash: text("electronic_invoice_hash"),
    completenessIndicator: integer("completeness_indicator", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => ({
    txIdx: index("idx_inv_op_tx").on(t.transactionId),
    invNumIdx: index("idx_inv_op_inv_num").on(t.invoiceNumber),
  }),
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    operation: text("operation").notNull(),
    requestId: text("request_id").notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    success: integer("success", { mode: "boolean" }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => ({
    reqIdx: index("idx_audit_request_id").on(t.requestId),
    opIdx: index("idx_audit_operation").on(t.operation),
  }),
);

export type TechnicalUser = typeof technicalUsers.$inferSelect;
export type NewTechnicalUser = typeof technicalUsers.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type InvoiceOp = typeof invoiceOps.$inferSelect;
export type NewInvoiceOp = typeof invoiceOps.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

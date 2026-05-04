/**
 * NAV Online Számla 3.0 – domain types used by the gateway.
 *
 * These are intentionally narrowed to the subset of the official XSDs we
 * actually produce/consume from the GraphQL surface. They are NOT a full
 * 1:1 port of the XSD: a complete invoiceData document allows hundreds of
 * optional elements; the gateway accepts the most common shapes and lets
 * advanced consumers pass a pre-built XML string instead of a structured
 * object (see `manageInvoice` mutation).
 */

export const NAV_NAMESPACES = {
  api: "http://schemas.nav.gov.hu/OSA/3.0/api",
  data: "http://schemas.nav.gov.hu/OSA/3.0/data",
  base: "http://schemas.nav.gov.hu/OSA/3.0/base",
  annul: "http://schemas.nav.gov.hu/OSA/3.0/annul",
  common: "http://schemas.nav.gov.hu/NTCA/1.0/common",
} as const;

export const REQUEST_VERSION = "3.0" as const;
export const HEADER_VERSION = "1.0" as const;

export type SoftwareOperation = "ONLINE_SERVICE" | "LOCAL_SOFTWARE";

export interface SoftwareInfo {
  readonly softwareId: string;
  readonly softwareName: string;
  readonly softwareOperation: SoftwareOperation;
  readonly softwareMainVersion: string;
  readonly softwareDevName: string;
  readonly softwareDevContact: string;
  readonly softwareDevCountryCode?: string;
  readonly softwareDevTaxNumber?: string;
}

/**
 * Credentials for a NAV technical user. All five fields are mandatory and
 * must come from the production / test environment registration.
 */
export interface NavCredentials {
  readonly login: string;
  readonly password: string;
  readonly signKey: string;
  readonly exchangeKey: string;
  readonly taxNumber: string; // 8-digit Hungarian tax number
}

export type ManageInvoiceOperation =
  | "CREATE"
  | "MODIFY"
  | "STORNO";

export type ManageAnnulmentOperation = "ANNUL";

export type AnnulmentCode =
  | "ERRATIC_DATA"
  | "ERRATIC_INVOICE_NUMBER"
  | "ERRATIC_INVOICE_ISSUE_DATE"
  | "ERRATIC_ELECTRONIC_HASH_VALUE";

export type InvoiceQueryDirection = "INBOUND" | "OUTBOUND";

export type InvoiceCategory = "NORMAL" | "SIMPLIFIED" | "AGGREGATE";

export type RequestStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "SAVED"
  | "FINISHED"
  | "NOTIFIED"
  | "ABORTED";

export type InvoiceStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "SAVED"
  | "DONE"
  | "ABORTED";

export interface InvoiceOperationInput {
  readonly index: number;            // 1..100 within a single batch
  readonly operation: ManageInvoiceOperation;
  /**
   * Either a pre-built invoiceData XML (will be base64-encoded for you) or a
   * raw base64 string already produced by the caller. We accept both shapes
   * to ease integration; callers building the XML themselves should pass
   * `invoiceDataXml` so the gateway can compute the hash correctly.
   */
  readonly invoiceDataXml?: string;
  readonly invoiceDataBase64?: string;
  /** Set true if the entire electronic invoice is included (3.0 §1.6.4). */
  readonly completenessIndicator?: boolean;
  /** Optional pre-computed electronicInvoiceHash; if omitted we compute it. */
  readonly electronicInvoiceHash?: string;
}

export interface AnnulmentOperationInput {
  readonly index: number;
  readonly operation: ManageAnnulmentOperation;
  readonly annulmentReference: string;
  readonly annulmentTimestamp: string; // ISO-8601
  readonly annulmentCode: AnnulmentCode;
  readonly annulmentReason: string;
}

export interface ManageInvoiceResult {
  readonly transactionId: string;
  readonly requestId: string;
  readonly timestamp: string;
}

export interface QueryTransactionStatusResult {
  readonly transactionId: string;
  readonly requestStatus: RequestStatus;
  readonly processingResults: ReadonlyArray<{
    readonly index: number;
    readonly batchIndex?: number;
    readonly invoiceStatus: InvoiceStatus;
    readonly originalRequestVersion?: string;
    readonly compressedContentIndicator?: boolean;
    readonly technicalValidationMessages: ReadonlyArray<{
      readonly validationResultCode: "ERROR" | "WARN" | "INFO";
      readonly validationErrorCode?: string;
      readonly message?: string;
    }>;
    readonly businessValidationMessages: ReadonlyArray<{
      readonly validationResultCode: "ERROR" | "WARN" | "INFO";
      readonly validationErrorCode?: string;
      readonly message?: string;
      readonly pointer?: { tag?: string; value?: string; line?: number };
    }>;
  }>;
  readonly annulmentData?: ReadonlyArray<{
    readonly index: number;
    readonly annulmentVerificationStatus: "NOT_VERIFIABLE" | "VERIFICATION_PENDING" | "VERIFICATION_DONE" | "VERIFICATION_REJECTED";
    readonly annulmentDecisionDate?: string;
    readonly annulmentDecisionUser?: string;
  }>;
}

export interface QueryInvoiceDigestResult {
  readonly currentPage: number;
  readonly availablePage: number;
  readonly invoiceDigests: ReadonlyArray<{
    readonly invoiceNumber: string;
    readonly batchIndex?: number;
    readonly invoiceOperation: ManageInvoiceOperation;
    readonly invoiceCategory?: InvoiceCategory;
    readonly invoiceIssueDate?: string;
    readonly supplierTaxNumber?: string;
    readonly supplierName?: string;
    readonly customerTaxNumber?: string;
    readonly customerName?: string;
    readonly insDate?: string;
    readonly completenessIndicator?: boolean;
  }>;
}

export interface QueryTaxpayerResult {
  readonly taxpayerValidity: boolean;
  readonly infoDate?: string;
  readonly taxpayerData?: {
    readonly taxpayerName?: string;
    readonly taxpayerShortName?: string;
    readonly incorporation?: "ORGANIZATION" | "SELF_EMPLOYED" | "TAXABLE_PERSON";
    readonly vatGroupMembership?: string;
    readonly taxNumberDetail?: { taxpayerId: string; vatCode?: string; countyCode?: string };
  };
}

export type NavOperationName =
  | "tokenExchange"
  | "manageInvoice"
  | "manageAnnulment"
  | "queryTransactionStatus"
  | "queryTransactionList"
  | "queryInvoiceData"
  | "queryInvoiceCheck"
  | "queryInvoiceDigest"
  | "queryInvoiceChainDigest"
  | "queryTaxpayer";

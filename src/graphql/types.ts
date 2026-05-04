import { builder } from "./builder";
import type {
  AnnulmentCode,
  InvoiceQueryDirection,
  ManageInvoiceOperation,
  QueryInvoiceDigestResult,
  QueryTaxpayerResult,
  QueryTransactionStatusResult,
} from "../nav/types";

export const InvoiceOperationEnum = builder.enumType("InvoiceOperation", {
  values: ["CREATE", "MODIFY", "STORNO"] as const satisfies readonly ManageInvoiceOperation[],
});

export const AnnulmentOperationEnum = builder.enumType("AnnulmentOperation", {
  values: ["ANNUL"] as const,
});

export const AnnulmentCodeEnum = builder.enumType("AnnulmentCode", {
  values: [
    "ERRATIC_DATA",
    "ERRATIC_INVOICE_NUMBER",
    "ERRATIC_INVOICE_ISSUE_DATE",
    "ERRATIC_ELECTRONIC_HASH_VALUE",
  ] as const satisfies readonly AnnulmentCode[],
});

export const InvoiceDirectionEnum = builder.enumType("InvoiceDirection", {
  values: ["INBOUND", "OUTBOUND"] as const satisfies readonly InvoiceQueryDirection[],
});

export const InvoiceCategoryEnum = builder.enumType("InvoiceCategory", {
  values: ["NORMAL", "SIMPLIFIED", "AGGREGATE"] as const,
});

export const RequestStatusEnum = builder.enumType("RequestStatus", {
  values: [
    "RECEIVED",
    "PROCESSING",
    "SAVED",
    "FINISHED",
    "NOTIFIED",
    "ABORTED",
  ] as const,
});

export const InvoiceStatusEnum = builder.enumType("InvoiceStatus", {
  values: ["RECEIVED", "PROCESSING", "SAVED", "DONE", "ABORTED"] as const,
});

export const SoftwareInfoType = builder.objectRef<{
  softwareId: string;
  softwareName: string;
  softwareOperation: string;
  softwareMainVersion: string;
  softwareDevName: string;
  softwareDevContact: string;
  softwareDevCountryCode?: string;
  softwareDevTaxNumber?: string;
}>("SoftwareInfo").implement({
  fields: (t) => ({
    softwareId: t.exposeString("softwareId"),
    softwareName: t.exposeString("softwareName"),
    softwareOperation: t.exposeString("softwareOperation"),
    softwareMainVersion: t.exposeString("softwareMainVersion"),
    softwareDevName: t.exposeString("softwareDevName"),
    softwareDevContact: t.exposeString("softwareDevContact"),
    softwareDevCountryCode: t.exposeString("softwareDevCountryCode", { nullable: true }),
    softwareDevTaxNumber: t.exposeString("softwareDevTaxNumber", { nullable: true }),
  }),
});

/* ----- manageInvoice ----- */

export const InvoiceOperationInputType = builder.inputType("InvoiceOperationInput", {
  fields: (t) => ({
    index: t.int({ required: true, description: "1..100 within a batch" }),
    operation: t.field({ type: InvoiceOperationEnum, required: true }),
    invoiceDataXml: t.string({
      required: false,
      description:
        "Pre-built invoiceData XML. Pass either this OR invoiceDataBase64. The gateway base64-encodes it before submission.",
    }),
    invoiceDataBase64: t.string({
      required: false,
      description: "Base64-encoded invoiceData (alternative to invoiceDataXml).",
    }),
    completenessIndicator: t.boolean({
      required: false,
      description:
        "True if the data report IS the electronic invoice (3.0 §1.6.4). Forces SHA3-512 electronicInvoiceHash and rejects mergedItemIndicator.",
    }),
    electronicInvoiceHash: t.string({
      required: false,
      description: "Optional pre-computed SHA3-512 hash of the base64 invoiceData.",
    }),
  }),
});

export const ManageInvoiceResultType = builder
  .objectRef<{ transactionId: string; requestId: string; timestamp: string }>(
    "ManageInvoiceResult",
  )
  .implement({
    fields: (t) => ({
      transactionId: t.exposeString("transactionId"),
      requestId: t.exposeString("requestId"),
      timestamp: t.exposeString("timestamp"),
    }),
  });

/* ----- annulment ----- */

export const AnnulmentOperationInputType = builder.inputType("AnnulmentOperationInput", {
  fields: (t) => ({
    index: t.int({ required: true }),
    operation: t.field({ type: AnnulmentOperationEnum, required: true, defaultValue: "ANNUL" }),
    annulmentReference: t.string({ required: true, description: "Original invoiceNumber" }),
    annulmentTimestamp: t.string({
      required: true,
      description: "ISO-8601 UTC timestamp when the annulment was issued",
    }),
    annulmentCode: t.field({ type: AnnulmentCodeEnum, required: true }),
    annulmentReason: t.string({ required: true, description: "Free-text reason (max 1024)" }),
  }),
});

/* ----- queryTransactionStatus ----- */

export const TechnicalValidationMessageType = builder
  .objectRef<{
    validationResultCode: string;
    validationErrorCode?: string;
    message?: string;
  }>("TechnicalValidationMessage")
  .implement({
    fields: (t) => ({
      validationResultCode: t.exposeString("validationResultCode"),
      validationErrorCode: t.string({
        nullable: true,
        resolve: (m) => m.validationErrorCode ?? null,
      }),
      message: t.string({ nullable: true, resolve: (m) => m.message ?? null }),
    }),
  });

export const BusinessValidationMessageType = builder
  .objectRef<{
    validationResultCode: string;
    validationErrorCode?: string;
    message?: string;
    pointer?: { tag?: string; value?: string; line?: number };
  }>("BusinessValidationMessage")
  .implement({
    fields: (t) => ({
      validationResultCode: t.exposeString("validationResultCode"),
      validationErrorCode: t.string({
        nullable: true,
        resolve: (m) => m.validationErrorCode ?? null,
      }),
      message: t.string({ nullable: true, resolve: (m) => m.message ?? null }),
      tag: t.string({ nullable: true, resolve: (m) => m.pointer?.tag ?? null }),
      value: t.string({ nullable: true, resolve: (m) => m.pointer?.value ?? null }),
      line: t.int({ nullable: true, resolve: (m) => m.pointer?.line ?? null }),
    }),
  });

export const ProcessingResultType = builder
  .objectRef<QueryTransactionStatusResult["processingResults"][number]>(
    "ProcessingResult",
  )
  .implement({
    fields: (t) => ({
      index: t.exposeInt("index"),
      batchIndex: t.int({ nullable: true, resolve: (p) => p.batchIndex ?? null }),
      invoiceStatus: t.field({
        type: InvoiceStatusEnum,
        resolve: (p) => p.invoiceStatus,
      }),
      compressedContentIndicator: t.boolean({
        nullable: true,
        resolve: (p) => p.compressedContentIndicator ?? null,
      }),
      originalRequestVersion: t.string({
        nullable: true,
        resolve: (p) => p.originalRequestVersion ?? null,
      }),
      technicalValidationMessages: t.field({
        type: [TechnicalValidationMessageType],
        resolve: (p) => [...p.technicalValidationMessages],
      }),
      businessValidationMessages: t.field({
        type: [BusinessValidationMessageType],
        resolve: (p) => [...p.businessValidationMessages],
      }),
    }),
  });

export const QueryTransactionStatusResultType = builder
  .objectRef<QueryTransactionStatusResult>("QueryTransactionStatusResult")
  .implement({
    fields: (t) => ({
      transactionId: t.exposeString("transactionId"),
      requestStatus: t.field({
        type: RequestStatusEnum,
        resolve: (r) => r.requestStatus,
      }),
      processingResults: t.field({
        type: [ProcessingResultType],
        resolve: (r) => [...r.processingResults],
      }),
    }),
  });

/* ----- queryInvoiceDigest ----- */

export const InvoiceDigestType = builder
  .objectRef<QueryInvoiceDigestResult["invoiceDigests"][number]>("InvoiceDigest")
  .implement({
    fields: (t) => ({
      invoiceNumber: t.exposeString("invoiceNumber"),
      batchIndex: t.int({ nullable: true, resolve: (d) => d.batchIndex ?? null }),
      invoiceOperation: t.field({
        type: InvoiceOperationEnum,
        resolve: (d) => d.invoiceOperation,
      }),
      invoiceCategory: t.field({
        type: InvoiceCategoryEnum,
        nullable: true,
        resolve: (d) => d.invoiceCategory ?? null,
      }),
      invoiceIssueDate: t.string({ nullable: true, resolve: (d) => d.invoiceIssueDate ?? null }),
      supplierTaxNumber: t.string({ nullable: true, resolve: (d) => d.supplierTaxNumber ?? null }),
      supplierName: t.string({ nullable: true, resolve: (d) => d.supplierName ?? null }),
      customerTaxNumber: t.string({ nullable: true, resolve: (d) => d.customerTaxNumber ?? null }),
      customerName: t.string({ nullable: true, resolve: (d) => d.customerName ?? null }),
      insDate: t.string({ nullable: true, resolve: (d) => d.insDate ?? null }),
      completenessIndicator: t.boolean({
        nullable: true,
        resolve: (d) => d.completenessIndicator ?? null,
      }),
    }),
  });

export const QueryInvoiceDigestResultType = builder
  .objectRef<QueryInvoiceDigestResult>("QueryInvoiceDigestResult")
  .implement({
    fields: (t) => ({
      currentPage: t.exposeInt("currentPage"),
      availablePage: t.exposeInt("availablePage"),
      invoiceDigests: t.field({
        type: [InvoiceDigestType],
        resolve: (r) => [...r.invoiceDigests],
      }),
    }),
  });

/* ----- queryTaxpayer ----- */

export const TaxpayerType = builder
  .objectRef<QueryTaxpayerResult>("Taxpayer")
  .implement({
    fields: (t) => ({
      taxpayerValidity: t.exposeBoolean("taxpayerValidity"),
      infoDate: t.string({ nullable: true, resolve: (r) => r.infoDate ?? null }),
      taxpayerName: t.string({
        nullable: true,
        resolve: (r) => r.taxpayerData?.taxpayerName ?? null,
      }),
      taxpayerShortName: t.string({
        nullable: true,
        resolve: (r) => r.taxpayerData?.taxpayerShortName ?? null,
      }),
      incorporation: t.string({
        nullable: true,
        resolve: (r) => r.taxpayerData?.incorporation ?? null,
      }),
      vatGroupMembership: t.string({
        nullable: true,
        resolve: (r) => r.taxpayerData?.vatGroupMembership ?? null,
      }),
      taxpayerId: t.string({
        nullable: true,
        resolve: (r) => r.taxpayerData?.taxNumberDetail?.taxpayerId ?? null,
      }),
      vatCode: t.string({
        nullable: true,
        resolve: (r) => r.taxpayerData?.taxNumberDetail?.vatCode ?? null,
      }),
      countyCode: t.string({
        nullable: true,
        resolve: (r) => r.taxpayerData?.taxNumberDetail?.countyCode ?? null,
      }),
    }),
  });

/* ----- queryInvoiceData ----- */

export const InvoiceDataType = builder
  .objectRef<{ invoiceDataBase64?: string; invoiceDataXml?: string }>("InvoiceData")
  .implement({
    fields: (t) => ({
      invoiceDataBase64: t.string({
        nullable: true,
        resolve: (r) => r.invoiceDataBase64 ?? null,
      }),
      invoiceDataXml: t.string({
        nullable: true,
        resolve: (r) => r.invoiceDataXml ?? null,
      }),
    }),
  });

/* ----- shared result wrappers (success | error union) ----- */

export interface ResultWrapper<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
}

/* ----- structured (helper) invoice input ----- */

export const CustomerVatStatusEnum = builder.enumType("CustomerVatStatus", {
  values: ["DOMESTIC", "OTHER", "PRIVATE_PERSON"] as const,
});

export const PaymentMethodEnum = builder.enumType("PaymentMethod", {
  values: ["TRANSFER", "CASH", "CARD", "VOUCHER", "OTHER"] as const,
});

export const InvoiceAppearanceEnum = builder.enumType("InvoiceAppearance", {
  values: ["PAPER", "ELECTRONIC", "EDI", "UNKNOWN"] as const,
});

export const AddressInputType = builder.inputType("AddressInput", {
  fields: (t) => ({
    countryCode: t.string({ required: true }),
    postalCode: t.string({ required: true }),
    city: t.string({ required: true }),
    streetName: t.string({ required: true }),
    publicPlaceCategory: t.string({ required: true }),
    number: t.string({ required: false }),
    additionalAddressDetail: t.string({ required: false }),
  }),
});

export const SupplierInputType = builder.inputType("SupplierInput", {
  fields: (t) => ({
    taxNumberMain: t.string({ required: true, description: "8-digit core tax number" }),
    taxNumberVat: t.string({ required: true, description: "Single VAT code digit" }),
    taxNumberCounty: t.string({ required: false }),
    name: t.string({ required: true }),
    address: t.field({ type: AddressInputType, required: true }),
    bankAccountNumber: t.string({ required: false }),
  }),
});

export const CustomerInputType = builder.inputType("CustomerInput", {
  fields: (t) => ({
    customerVatStatus: t.field({ type: CustomerVatStatusEnum, required: true }),
    name: t.string({ required: false }),
    address: t.field({ type: AddressInputType, required: false }),
    customerTaxNumberMain: t.string({ required: false }),
    customerTaxNumberVat: t.string({ required: false }),
    customerTaxNumberCounty: t.string({ required: false }),
  }),
});

export const InvoiceLineInputType = builder.inputType("InvoiceLineInput", {
  fields: (t) => ({
    lineNumber: t.int({ required: true }),
    lineDescription: t.string({ required: true }),
    quantity: t.float({ required: true }),
    unitOfMeasure: t.string({ required: true }),
    unitPrice: t.float({ required: true }),
    lineNetAmount: t.float({ required: true }),
    vatPercentage: t.float({ required: true }),
    lineVatAmount: t.float({ required: true }),
    lineGrossAmountNormal: t.float({ required: true }),
  }),
});

export const InvoiceDataInputType = builder.inputType("InvoiceDataInput", {
  fields: (t) => ({
    invoiceNumber: t.string({ required: true }),
    invoiceIssueDate: t.string({ required: true, description: "YYYY-MM-DD" }),
    invoiceDeliveryDate: t.string({ required: true, description: "YYYY-MM-DD" }),
    paymentDate: t.string({ required: false }),
    currencyCode: t.string({ required: true, description: "ISO 4217" }),
    exchangeRate: t.float({ required: true }),
    paymentMethod: t.field({ type: PaymentMethodEnum, required: false }),
    invoiceAppearance: t.field({ type: InvoiceAppearanceEnum, required: false }),
    invoiceCategory: t.field({ type: InvoiceCategoryEnum, required: false }),
    completenessIndicator: t.boolean({ required: false }),
    supplier: t.field({ type: SupplierInputType, required: true }),
    customer: t.field({ type: CustomerInputType, required: true }),
    lines: t.field({ type: [InvoiceLineInputType], required: true }),
    summaryNetAmount: t.float({ required: true }),
    summaryVatAmount: t.float({ required: true }),
    summaryGrossAmount: t.float({ required: true }),
  }),
});

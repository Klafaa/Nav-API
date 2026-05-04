/**
 * Tiny helper that builds a minimal Online Számla 3.0 `InvoiceData` XML
 * document. It covers the majority of the simple "domestic outgoing
 * normal VAT invoice" use case so callers don't have to assemble the XSD
 * by hand for trivial integrations.
 *
 * For complex cases (advance invoices, modification chains, aggregate
 * invoices, vatExemption / vatOutOfScope nuances, conventionalInvoiceInfo,
 * advanceData, productCodes, etc.) the gateway accepts a pre-built
 * `invoiceDataXml` string in `manageInvoice.operations[].invoiceDataXml`,
 * so external libraries (e.g. `nav-online-invoice-bundler`) remain usable.
 */

import { buildXml } from "./xml";
import { NAV_NAMESPACES } from "./types";

export type CustomerVatStatus = "DOMESTIC" | "OTHER" | "PRIVATE_PERSON";

export type PaymentMethod =
  | "TRANSFER"
  | "CASH"
  | "CARD"
  | "VOUCHER"
  | "OTHER";

export type InvoiceAppearance = "PAPER" | "ELECTRONIC" | "EDI" | "UNKNOWN";

export interface MinimalAddress {
  readonly countryCode: string;
  readonly postalCode: string;
  readonly city: string;
  readonly streetName: string;
  readonly publicPlaceCategory: string;
  readonly number?: string;
  readonly additionalAddressDetail?: string;
}

export interface MinimalSupplier {
  readonly taxNumberMain: string;     // 8 digits
  readonly taxNumberVat: string;      // 1 digit
  readonly taxNumberCounty?: string;  // 2 digits
  readonly name: string;
  readonly address: MinimalAddress;
  readonly bankAccountNumber?: string;
}

export interface MinimalCustomer {
  readonly customerVatStatus: CustomerVatStatus;
  readonly name?: string;
  readonly address?: MinimalAddress;
  readonly customerTaxNumberMain?: string;
  readonly customerTaxNumberVat?: string;
  readonly customerTaxNumberCounty?: string;
}

export interface MinimalLine {
  readonly lineNumber: number;
  readonly lineDescription: string;
  readonly quantity: number;
  readonly unitOfMeasure: string;
  readonly unitPrice: number;          // net per unit, in invoice currency
  readonly lineNetAmount: number;
  readonly vatPercentage: number;      // e.g. 0.27
  readonly lineVatAmount: number;
  readonly lineGrossAmountNormal: number;
}

export interface MinimalInvoiceData {
  readonly invoiceNumber: string;
  readonly invoiceIssueDate: string;        // YYYY-MM-DD
  readonly invoiceDeliveryDate: string;     // YYYY-MM-DD
  readonly paymentDate?: string;            // YYYY-MM-DD
  readonly currencyCode: string;            // ISO 4217, e.g. "HUF"
  readonly exchangeRate: number;            // 1.0 for HUF
  readonly paymentMethod?: PaymentMethod;
  readonly invoiceAppearance?: InvoiceAppearance;
  readonly invoiceCategory?: "NORMAL" | "SIMPLIFIED" | "AGGREGATE";
  readonly completenessIndicator?: boolean;
  readonly supplier: MinimalSupplier;
  readonly customer: MinimalCustomer;
  readonly lines: ReadonlyArray<MinimalLine>;
  readonly summaryNetAmount: number;
  readonly summaryVatAmount: number;
  readonly summaryGrossAmount: number;
}

const fmt = (n: number, decimals = 2) =>
  Number.isInteger(n) && decimals === 0
    ? n.toString()
    : n.toFixed(decimals);

function addressBlock(a: MinimalAddress): Record<string, unknown> {
  const detailedAddress: Record<string, unknown> = {
    countryCode: a.countryCode,
    postalCode: a.postalCode,
    city: a.city,
    streetName: a.streetName,
    publicPlaceCategory: a.publicPlaceCategory,
    ...(a.number ? { number: a.number } : {}),
    ...(a.additionalAddressDetail
      ? { additionalAddressDetail: a.additionalAddressDetail }
      : {}),
  };
  return { detailedAddress };
}

/**
 * Build a 3.0-compliant `InvoiceData` XML string. This is suitable for the
 * `invoiceDataXml` field of `InvoiceOperationInput`.
 */
export function buildInvoiceDataXml(input: MinimalInvoiceData): string {
  const customerInfo: Record<string, unknown> = {
    customerVatStatus: input.customer.customerVatStatus,
    ...(input.customer.customerVatStatus !== "PRIVATE_PERSON" &&
    input.customer.customerTaxNumberMain
      ? {
          customerVatData: {
            customerTaxNumber: {
              taxpayerId: input.customer.customerTaxNumberMain,
              ...(input.customer.customerTaxNumberVat
                ? { vatCode: input.customer.customerTaxNumberVat }
                : {}),
              ...(input.customer.customerTaxNumberCounty
                ? { countyCode: input.customer.customerTaxNumberCounty }
                : {}),
            },
          },
        }
      : {}),
    ...(input.customer.name ? { customerName: input.customer.name } : {}),
    ...(input.customer.address
      ? { customerAddress: addressBlock(input.customer.address) }
      : {}),
  };

  const supplierInfo: Record<string, unknown> = {
    supplierTaxNumber: {
      taxpayerId: input.supplier.taxNumberMain,
      vatCode: input.supplier.taxNumberVat,
      ...(input.supplier.taxNumberCounty
        ? { countyCode: input.supplier.taxNumberCounty }
        : {}),
    },
    supplierName: input.supplier.name,
    supplierAddress: addressBlock(input.supplier.address),
    ...(input.supplier.bankAccountNumber
      ? { supplierBankAccountNumber: input.supplier.bankAccountNumber }
      : {}),
  };

  const invoiceLines = input.lines.map((l) => ({
    lineNumber: l.lineNumber,
    lineExpressionIndicator: true,
    lineDescription: l.lineDescription,
    quantity: fmt(l.quantity, 6),
    unitOfMeasure: l.unitOfMeasure,
    unitPrice: fmt(l.unitPrice, 6),
    unitPriceHUF: fmt(l.unitPrice * input.exchangeRate, 6),
    lineAmountsNormal: {
      lineNetAmountData: {
        lineNetAmount: fmt(l.lineNetAmount),
        lineNetAmountHUF: fmt(l.lineNetAmount * input.exchangeRate),
      },
      lineVatRate: { vatPercentage: fmt(l.vatPercentage, 4) },
      lineVatData: {
        lineVatAmount: fmt(l.lineVatAmount),
        lineVatAmountHUF: fmt(l.lineVatAmount * input.exchangeRate),
      },
      lineGrossAmountData: {
        lineGrossAmountNormal: fmt(l.lineGrossAmountNormal),
        lineGrossAmountNormalHUF: fmt(
          l.lineGrossAmountNormal * input.exchangeRate,
        ),
      },
    },
  }));

  const body: Record<string, unknown> = {
    invoiceNumber: input.invoiceNumber,
    invoiceIssueDate: input.invoiceIssueDate,
    completenessIndicator: input.completenessIndicator ?? false,
    invoiceMain: {
      invoice: {
        invoiceHead: {
          supplierInfo,
          customerInfo,
          invoiceDetail: {
            invoiceCategory: input.invoiceCategory ?? "NORMAL",
            invoiceDeliveryDate: input.invoiceDeliveryDate,
            currencyCode: input.currencyCode,
            exchangeRate: fmt(input.exchangeRate, 6),
            ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
            ...(input.paymentDate ? { paymentDate: input.paymentDate } : {}),
            invoiceAppearance: input.invoiceAppearance ?? "ELECTRONIC",
          },
        },
        invoiceLines: {
          mergedItemIndicator: false,
          line: invoiceLines,
        },
        invoiceSummary: {
          summaryNormal: {
            summaryByVatRate: {
              vatRate: { vatPercentage: fmt(input.lines[0]?.vatPercentage ?? 0, 4) },
              vatRateNetData: {
                vatRateNetAmount: fmt(input.summaryNetAmount),
                vatRateNetAmountHUF: fmt(input.summaryNetAmount * input.exchangeRate),
              },
              vatRateVatData: {
                vatRateVatAmount: fmt(input.summaryVatAmount),
                vatRateVatAmountHUF: fmt(input.summaryVatAmount * input.exchangeRate),
              },
              vatRateGrossData: {
                vatRateGrossAmount: fmt(input.summaryGrossAmount),
                vatRateGrossAmountHUF: fmt(input.summaryGrossAmount * input.exchangeRate),
              },
            },
            invoiceNetAmount: fmt(input.summaryNetAmount),
            invoiceNetAmountHUF: fmt(input.summaryNetAmount * input.exchangeRate),
            invoiceVatAmount: fmt(input.summaryVatAmount),
            invoiceVatAmountHUF: fmt(input.summaryVatAmount * input.exchangeRate),
          },
          summaryGrossData: {
            invoiceGrossAmount: fmt(input.summaryGrossAmount),
            invoiceGrossAmountHUF: fmt(input.summaryGrossAmount * input.exchangeRate),
          },
        },
      },
    },
  };

  return buildXml("InvoiceData", body, {
    xmlns: NAV_NAMESPACES.data,
    "xmlns:common": NAV_NAMESPACES.common,
    "xmlns:base": NAV_NAMESPACES.base,
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  });
}

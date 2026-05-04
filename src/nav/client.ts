import {
  AuthError,
  CryptoError,
  NavGeneralError,
  NavValidationError,
  NetworkError,
  TimeoutError,
  ValidationError,
  wrapUnknown,
  type NavValidationMessage,
} from "../errors";
import {
  decryptExchangeToken,
  invoiceHash,
  toBase64,
} from "./crypto";
import { buildCommonBlocks, rootAttrs } from "./header";
import {
  type AnnulmentOperationInput,
  type InvoiceOperationInput,
  type InvoiceQueryDirection,
  type ManageInvoiceResult,
  type NavCredentials,
  type NavOperationName,
  type QueryInvoiceDigestResult,
  type QueryTaxpayerResult,
  type QueryTransactionStatusResult,
  type RequestStatus,
  type SoftwareInfo,
  NAV_NAMESPACES,
} from "./types";
import {
  ATTR_KEY,
  asArray,
  asBoolean,
  asNumber,
  asString,
  buildXml,
  parseXml,
  pick,
} from "./xml";

const TOKEN_TTL_MS = 4 * 60 * 1000; // NAV exchange tokens are valid for 5 minutes; refresh at 4.

interface CachedToken {
  readonly token: string;
  readonly validTo: number;
}

export interface NavClientOptions {
  readonly baseUrl: string;
  readonly credentials: NavCredentials;
  readonly software: SoftwareInfo;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onAudit?: (record: AuditRecord) => void | Promise<void>;
}

export interface AuditRecord {
  readonly operation: NavOperationName;
  readonly requestId: string;
  readonly timestamp: string;
  readonly httpStatus?: number;
  readonly durationMs: number;
  readonly success: boolean;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 70_000;

export class NavClient {
  private readonly opts: Required<Omit<NavClientOptions, "onAudit" | "fetchImpl">> & {
    fetchImpl: typeof fetch;
    onAudit?: (record: AuditRecord) => void | Promise<void>;
  };
  private tokenCache: CachedToken | null = null;
  private tokenInflight: Promise<string> | null = null;

  constructor(options: NavClientOptions) {
    if (!options.baseUrl) throw new ValidationError("CFG_BASE_URL", "baseUrl is required");
    this.opts = {
      baseUrl: options.baseUrl.replace(/\/+$/, ""),
      credentials: options.credentials,
      software: options.software,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: options.fetchImpl ?? fetch,
      onAudit: options.onAudit,
    };
  }

  /* =====================================================================
   * Public operations
   * ===================================================================== */

  async tokenExchange(): Promise<{ token: string; validTo: number; rawValidToUtc: string }> {
    const { credentials, software } = this.opts;
    const built = buildCommonBlocks(credentials, software);
    const xml = buildXml(
      "TokenExchangeRequest",
      {
        "common:header": built.headerBlock,
        "common:user": built.userBlock,
        software: built.softwareBlock,
      },
      rootAttrs(),
    );

    const responseXml = await this.post("/tokenExchange", xml, "tokenExchange", built.requestId);
    const parsed = parseXml<any>(responseXml);
    const root = parsed.TokenExchangeResponse ?? Object.values(parsed)[0];
    if (!root) throw new ValidationError("RES_EMPTY", "Empty tokenExchange response");

    const encryptedToken = asString(root.encodedExchangeToken);
    const validToString = asString(root.tokenValidityTo);
    if (!encryptedToken) {
      throw new ValidationError("RES_NO_TOKEN", "tokenExchange response is missing encodedExchangeToken");
    }
    const token = decryptExchangeToken(encryptedToken, credentials.exchangeKey);
    const validTo = validToString ? Date.parse(validToString) : Date.now() + 5 * 60 * 1000;
    return { token, validTo, rawValidToUtc: validToString ?? "" };
  }

  /**
   * Returns a cached or freshly-requested exchange token. Concurrent callers
   * share the same in-flight request to avoid hammering NAV.
   */
  async getExchangeToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.validTo - Date.now() > 30_000) {
      return this.tokenCache.token;
    }
    if (this.tokenInflight) return this.tokenInflight;
    this.tokenInflight = (async () => {
      try {
        const { token, validTo } = await this.tokenExchange();
        const expiry = Math.min(validTo, Date.now() + TOKEN_TTL_MS);
        this.tokenCache = { token, validTo: expiry };
        return token;
      } finally {
        this.tokenInflight = null;
      }
    })();
    return this.tokenInflight;
  }

  async manageInvoice(
    operations: readonly InvoiceOperationInput[],
  ): Promise<ManageInvoiceResult> {
    if (operations.length === 0) {
      throw new ValidationError("INV_EMPTY", "manageInvoice requires at least one operation");
    }
    if (operations.length > 100) {
      throw new ValidationError(
        "INV_TOO_MANY",
        `manageInvoice supports at most 100 operations per batch (got ${operations.length})`,
      );
    }

    const exchangeToken = await this.getExchangeToken();

    const opsWithHash = operations.map((op) => {
      if (!op.invoiceDataXml && !op.invoiceDataBase64) {
        throw new ValidationError(
          "INV_NO_DATA",
          `invoiceOperation[${op.index}] must contain either invoiceDataXml or invoiceDataBase64`,
        );
      }
      const base64 = op.invoiceDataBase64 ?? toBase64(op.invoiceDataXml!);
      const hashValue = op.electronicInvoiceHash ?? invoiceHash(base64, "SHA3-512");
      return { op, base64, hashValue };
    });

    const built = buildCommonBlocks(this.opts.credentials, this.opts.software, {
      invoiceHashes: opsWithHash.map((o) => o.hashValue),
    });

    const xml = buildXml(
      "ManageInvoiceRequest",
      {
        "common:header": built.headerBlock,
        "common:user": built.userBlock,
        software: built.softwareBlock,
        exchangeToken,
        invoiceOperations: {
          compressedContent: false,
          invoiceOperation: opsWithHash.map(({ op, base64, hashValue }) => {
            const block: Record<string, unknown> = {
              index: op.index,
              invoiceOperation: op.operation,
              invoiceData: base64,
              completenessIndicator: op.completenessIndicator ?? false,
            };
            if (op.completenessIndicator || op.electronicInvoiceHash) {
              block.electronicInvoiceHash = {
                [ATTR_KEY("cryptoType")]: "SHA3-512",
                "#text": hashValue,
              };
            }
            return block;
          }),
        },
      },
      rootAttrs(),
    );

    const responseXml = await this.post("/manageInvoice", xml, "manageInvoice", built.requestId);
    const parsed = parseXml<any>(responseXml);
    const root = parsed.ManageInvoiceResponse ?? Object.values(parsed)[0];
    const transactionId = asString(root?.transactionId);
    if (!transactionId) {
      throw new ValidationError("RES_NO_TXID", "manageInvoice response is missing transactionId");
    }
    return {
      transactionId,
      requestId: built.requestId,
      timestamp: built.timestamp,
    };
  }

  async manageAnnulment(
    operations: readonly AnnulmentOperationInput[],
  ): Promise<ManageInvoiceResult> {
    if (operations.length === 0) {
      throw new ValidationError("ANN_EMPTY", "manageAnnulment requires at least one operation");
    }

    const exchangeToken = await this.getExchangeToken();

    const annulmentXmls = operations.map((op) => {
      const xml = buildXml(
        "InvoiceAnnulment",
        {
          annulmentReference: op.annulmentReference,
          annulmentTimestamp: op.annulmentTimestamp,
          annulmentCode: op.annulmentCode,
          annulmentReason: op.annulmentReason,
        },
        { xmlns: NAV_NAMESPACES.annul },
      );
      const base64 = toBase64(xml);
      const hashValue = invoiceHash(base64, "SHA3-512");
      return { op, base64, hashValue };
    });

    const built = buildCommonBlocks(this.opts.credentials, this.opts.software, {
      invoiceHashes: annulmentXmls.map((o) => o.hashValue),
    });

    const xml = buildXml(
      "ManageAnnulmentRequest",
      {
        "common:header": built.headerBlock,
        "common:user": built.userBlock,
        software: built.softwareBlock,
        exchangeToken,
        annulmentOperations: {
          annulmentOperation: annulmentXmls.map(({ op, base64 }) => ({
            index: op.index,
            annulmentOperation: op.operation,
            invoiceAnnulment: base64,
          })),
        },
      },
      rootAttrs(),
    );

    const responseXml = await this.post(
      "/manageAnnulment",
      xml,
      "manageAnnulment",
      built.requestId,
    );
    const parsed = parseXml<any>(responseXml);
    const root = parsed.ManageAnnulmentResponse ?? Object.values(parsed)[0];
    const transactionId = asString(root?.transactionId);
    if (!transactionId) {
      throw new ValidationError(
        "RES_NO_TXID",
        "manageAnnulment response is missing transactionId",
      );
    }
    return {
      transactionId,
      requestId: built.requestId,
      timestamp: built.timestamp,
    };
  }

  async queryTransactionStatus(
    transactionId: string,
    options: { returnOriginalRequest?: boolean } = {},
  ): Promise<QueryTransactionStatusResult> {
    if (!transactionId) {
      throw new ValidationError("TX_REQUIRED", "transactionId is required");
    }
    const built = buildCommonBlocks(this.opts.credentials, this.opts.software);
    const xml = buildXml(
      "QueryTransactionStatusRequest",
      {
        "common:header": built.headerBlock,
        "common:user": built.userBlock,
        software: built.softwareBlock,
        transactionId,
        ...(options.returnOriginalRequest !== undefined
          ? { returnOriginalRequest: options.returnOriginalRequest }
          : {}),
      },
      rootAttrs(),
    );

    const responseXml = await this.post(
      "/queryTransactionStatus",
      xml,
      "queryTransactionStatus",
      built.requestId,
    );
    const parsed = parseXml<any>(responseXml);
    const root = parsed.QueryTransactionStatusResponse ?? Object.values(parsed)[0];
    const processingResults = asArray<any>(
      pick(root, "processingResults", "processingResult"),
    );
    return {
      transactionId,
      requestStatus:
        (asString(pick(root, "processingResults", "originalRequestVersion")) as RequestStatus) ??
        "FINISHED",
      processingResults: processingResults.map((pr) => {
        const tech = asArray<any>(pick(pr, "technicalValidationMessages"));
        const biz = asArray<any>(pick(pr, "businessValidationMessages"));
        return {
          index: asNumber(pr.index) ?? 0,
          batchIndex: asNumber(pr.batchIndex),
          invoiceStatus: (asString(pr.invoiceStatus) as any) ?? "PROCESSING",
          originalRequestVersion: asString(pr.originalRequestVersion),
          compressedContentIndicator: asBoolean(pr.compressedContentIndicator),
          technicalValidationMessages: tech.map((m) => ({
            validationResultCode: (asString(m.validationResultCode) as any) ?? "ERROR",
            validationErrorCode: asString(m.validationErrorCode),
            message: asString(m.message),
          })),
          businessValidationMessages: biz.map((m) => ({
            validationResultCode: (asString(m.validationResultCode) as any) ?? "ERROR",
            validationErrorCode: asString(m.validationErrorCode),
            message: asString(m.message),
            pointer: m.pointer
              ? {
                  tag: asString(m.pointer.tag),
                  value: asString(m.pointer.value),
                  line: asNumber(m.pointer.line),
                }
              : undefined,
          })),
        };
      }),
    };
  }

  async queryInvoiceData(params: {
    invoiceNumber: string;
    direction: InvoiceQueryDirection;
    batchIndex?: number;
    supplierTaxNumber?: string;
  }): Promise<{ invoiceDataBase64?: string; auditInfo?: Record<string, unknown> }> {
    const built = buildCommonBlocks(this.opts.credentials, this.opts.software);
    const xml = buildXml(
      "QueryInvoiceDataRequest",
      {
        "common:header": built.headerBlock,
        "common:user": built.userBlock,
        software: built.softwareBlock,
        invoiceNumberQuery: {
          invoiceNumber: params.invoiceNumber,
          invoiceDirection: params.direction,
          ...(params.batchIndex !== undefined ? { batchIndex: params.batchIndex } : {}),
          ...(params.supplierTaxNumber
            ? { supplierTaxNumber: params.supplierTaxNumber }
            : {}),
        },
      },
      rootAttrs(),
    );
    const responseXml = await this.post(
      "/queryInvoiceData",
      xml,
      "queryInvoiceData",
      built.requestId,
    );
    const parsed = parseXml<any>(responseXml);
    const root = parsed.QueryInvoiceDataResponse ?? Object.values(parsed)[0];
    return {
      invoiceDataBase64: asString(root?.invoiceDataResult?.invoiceData),
      auditInfo: root?.invoiceDataResult?.auditData,
    };
  }

  async queryInvoiceCheck(params: {
    invoiceNumber: string;
    direction: InvoiceQueryDirection;
    batchIndex?: number;
    supplierTaxNumber?: string;
  }): Promise<{ invoiceCheckResult: boolean }> {
    const built = buildCommonBlocks(this.opts.credentials, this.opts.software);
    const xml = buildXml(
      "QueryInvoiceCheckRequest",
      {
        "common:header": built.headerBlock,
        "common:user": built.userBlock,
        software: built.softwareBlock,
        invoiceNumberQuery: {
          invoiceNumber: params.invoiceNumber,
          invoiceDirection: params.direction,
          ...(params.batchIndex !== undefined ? { batchIndex: params.batchIndex } : {}),
          ...(params.supplierTaxNumber
            ? { supplierTaxNumber: params.supplierTaxNumber }
            : {}),
        },
      },
      rootAttrs(),
    );
    const responseXml = await this.post(
      "/queryInvoiceCheck",
      xml,
      "queryInvoiceCheck",
      built.requestId,
    );
    const parsed = parseXml<any>(responseXml);
    const root = parsed.QueryInvoiceCheckResponse ?? Object.values(parsed)[0];
    return { invoiceCheckResult: asBoolean(root?.invoiceCheckResult) ?? false };
  }

  async queryInvoiceDigest(params: {
    page: number;
    direction: InvoiceQueryDirection;
    dateFrom: string;
    dateTo: string;
    transactionParams?: { transactionId: string; index?: number; invoiceOperation?: string };
  }): Promise<QueryInvoiceDigestResult> {
    if (params.page < 1) {
      throw new ValidationError("PAGE_INVALID", "page must be >= 1");
    }
    const built = buildCommonBlocks(this.opts.credentials, this.opts.software);
    const xml = buildXml(
      "QueryInvoiceDigestRequest",
      {
        "common:header": built.headerBlock,
        "common:user": built.userBlock,
        software: built.softwareBlock,
        page: params.page,
        invoiceDirection: params.direction,
        invoiceQueryParams: {
          mandatoryQueryParams: {
            insDate: {
              dateTimeFrom: params.dateFrom,
              dateTimeTo: params.dateTo,
            },
          },
          ...(params.transactionParams
            ? {
                additionalQueryParams: {
                  transactionParams: {
                    transactionId: params.transactionParams.transactionId,
                    ...(params.transactionParams.index !== undefined
                      ? { index: params.transactionParams.index }
                      : {}),
                    ...(params.transactionParams.invoiceOperation
                      ? { invoiceOperation: params.transactionParams.invoiceOperation }
                      : {}),
                  },
                },
              }
            : {}),
        },
      },
      rootAttrs(),
    );
    const responseXml = await this.post(
      "/queryInvoiceDigest",
      xml,
      "queryInvoiceDigest",
      built.requestId,
    );
    const parsed = parseXml<any>(responseXml);
    const root = parsed.QueryInvoiceDigestResponse ?? Object.values(parsed)[0];
    const result = root?.invoiceDigestResult ?? {};
    const digests = asArray<any>(result.invoiceDigest);
    return {
      currentPage: asNumber(result.currentPage) ?? params.page,
      availablePage: asNumber(result.availablePage) ?? 0,
      invoiceDigests: digests.map((d) => ({
        invoiceNumber: asString(d.invoiceNumber) ?? "",
        batchIndex: asNumber(d.batchIndex),
        invoiceOperation: (asString(d.invoiceOperation) as any) ?? "CREATE",
        invoiceCategory: asString(d.invoiceCategory) as any,
        invoiceIssueDate: asString(d.invoiceIssueDate),
        supplierTaxNumber: asString(d.supplierTaxNumber),
        supplierName: asString(d.supplierName),
        customerTaxNumber: asString(d.customerTaxNumber),
        customerName: asString(d.customerName),
        insDate: asString(d.insDate),
        completenessIndicator: asBoolean(d.completenessIndicator),
      })),
    };
  }

  async queryTaxpayer(taxNumber: string): Promise<QueryTaxpayerResult> {
    if (!/^\d{8}$/.test(taxNumber)) {
      throw new ValidationError(
        "TAX_NUMBER_INVALID",
        "taxNumber must be exactly 8 digits (Hungarian core tax number)",
      );
    }
    const built = buildCommonBlocks(this.opts.credentials, this.opts.software);
    const xml = buildXml(
      "QueryTaxpayerRequest",
      {
        "common:header": built.headerBlock,
        "common:user": built.userBlock,
        software: built.softwareBlock,
        taxNumber,
      },
      rootAttrs(),
    );
    const responseXml = await this.post(
      "/queryTaxpayer",
      xml,
      "queryTaxpayer",
      built.requestId,
    );
    const parsed = parseXml<any>(responseXml);
    const root = parsed.QueryTaxpayerResponse ?? Object.values(parsed)[0];
    return {
      taxpayerValidity: asBoolean(root?.taxpayerValidity) ?? false,
      infoDate: asString(root?.infoDate),
      taxpayerData: root?.taxpayerData
        ? {
            taxpayerName: asString(root.taxpayerData.taxpayerName),
            taxpayerShortName: asString(root.taxpayerData.taxpayerShortName),
            incorporation: asString(root.taxpayerData.incorporation) as any,
            vatGroupMembership: asString(root.taxpayerData.vatGroupMembership),
            taxNumberDetail: root.taxpayerData.taxNumberDetail
              ? {
                  taxpayerId: asString(root.taxpayerData.taxNumberDetail.taxpayerId) ?? "",
                  vatCode: asString(root.taxpayerData.taxNumberDetail.vatCode),
                  countyCode: asString(root.taxpayerData.taxNumberDetail.countyCode),
                }
              : undefined,
          }
        : undefined,
    };
  }

  /* =====================================================================
   * Low-level transport
   * ===================================================================== */

  private async post(
    path: string,
    body: string,
    operation: NavOperationName,
    requestId: string,
  ): Promise<string> {
    const url = `${this.opts.baseUrl}${path}`;
    const start = performance.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);

    let response: Response;
    try {
      response = await this.opts.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/xml; charset=UTF-8",
          Accept: "application/xml",
          "User-Agent": `${this.opts.software.softwareName}/${this.opts.software.softwareMainVersion}`,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        const e = new TimeoutError(
          `NAV ${operation} timed out after ${this.opts.timeoutMs}ms`,
          this.opts.timeoutMs,
        );
        await this.audit(operation, requestId, undefined, performance.now() - start, e);
        throw e;
      }
      const e = new NetworkError(
        `Network error while calling NAV ${operation}: ${(err as Error).message}`,
        err,
      );
      await this.audit(operation, requestId, undefined, performance.now() - start, e);
      throw e;
    }
    clearTimeout(timer);

    let responseText: string;
    try {
      responseText = await response.text();
    } catch (err) {
      const e = wrapUnknown(err, `Failed to read NAV ${operation} response body`);
      await this.audit(operation, requestId, response.status, performance.now() - start, e);
      throw e;
    }

    if (!response.ok) {
      const navError = this.parseGeneralError(responseText, response.status, requestId);
      await this.audit(operation, requestId, response.status, performance.now() - start, navError);
      if (response.status === 401) {
        throw new AuthError(navError.code, navError.message);
      }
      throw navError;
    }

    const navError = this.detectInlineGeneralError(responseText, response.status, requestId);
    if (navError) {
      await this.audit(operation, requestId, response.status, performance.now() - start, navError);
      throw navError;
    }

    await this.audit(operation, requestId, response.status, performance.now() - start);
    return responseText;
  }

  /**
   * Parse a GeneralExceptionResponse / GeneralErrorResponse body.
   *
   * NAV returns one of two shapes:
   *
   *  <GeneralExceptionResponse>
   *    <funcCode>ERROR</funcCode>
   *    <errorCode>INVALID_USER_CREDENTIAL</errorCode>
   *    <message>Hibás felhasználói kredenciálok.</message>
   *  </GeneralExceptionResponse>
   *
   *  <GeneralErrorResponse>
   *    <result>
   *      <funcCode>ERROR</funcCode>
   *      <errorCode>...</errorCode>
   *      <message>...</message>
   *      <notifications>...</notifications>
   *    </result>
   *    <technicalValidationMessages>...</technicalValidationMessages>
   *  </GeneralErrorResponse>
   */
  private parseGeneralError(
    responseText: string,
    httpStatus: number,
    requestId: string,
  ): NavGeneralError | NavValidationError {
    let parsed: any;
    try {
      parsed = parseXml<any>(responseText);
    } catch {
      return new NavGeneralError(
        "NAV_HTTP_ERROR",
        `NAV returned HTTP ${httpStatus} with non-XML body: ${responseText.slice(0, 500)}`,
        { httpStatus, requestId },
      );
    }

    const root =
      parsed.GeneralExceptionResponse ??
      parsed.GeneralErrorResponse ??
      Object.values(parsed)[0];
    const result = root?.result ?? root;

    const techMessages = collectValidationMessages(root, "technicalValidationMessages");
    if (techMessages.length > 0) {
      return new NavValidationError(
        asString(result?.message) ?? `NAV technical validation failed (HTTP ${httpStatus})`,
        {
          code: asString(result?.errorCode) ?? "TECHNICAL_VALIDATION_FAILED",
          requestId: asString(result?.requestId) ?? requestId,
          messages: techMessages,
        },
      );
    }

    return new NavGeneralError(
      asString(result?.errorCode) ?? "NAV_GENERAL_ERROR",
      asString(result?.message) ?? `NAV returned HTTP ${httpStatus}`,
      {
        httpStatus,
        requestId: asString(result?.requestId) ?? requestId,
        details: {
          funcCode: asString(result?.funcCode),
          notifications: result?.notifications,
        },
      },
    );
  }

  /**
   * Some operations return `200 OK` even when the request was rejected,
   * but contain a result/funcCode = ERROR plus validation messages.
   */
  private detectInlineGeneralError(
    responseText: string,
    httpStatus: number,
    requestId: string,
  ): NavGeneralError | NavValidationError | null {
    if (!responseText.includes("<funcCode>ERROR</funcCode>")) return null;
    return this.parseGeneralError(responseText, httpStatus, requestId);
  }

  private async audit(
    operation: NavOperationName,
    requestId: string,
    httpStatus: number | undefined,
    durationMs: number,
    error?: { code: string; message: string },
  ): Promise<void> {
    if (!this.opts.onAudit) return;
    try {
      await this.opts.onAudit({
        operation,
        requestId,
        timestamp: new Date().toISOString(),
        httpStatus,
        durationMs,
        success: !error,
        ...(error ? { errorCode: error.code, errorMessage: error.message } : {}),
      });
    } catch {
      // never let auditing break the flow
    }
  }
}

function collectValidationMessages(root: any, key: string): NavValidationMessage[] {
  const list = asArray<any>(pick(root, key));
  const out: NavValidationMessage[] = [];
  for (const m of list) {
    if (!m) continue;
    out.push({
      tag: asString(m.tag) ?? asString(m.pointer?.tag),
      value: asString(m.value) ?? asString(m.pointer?.value),
      code: asString(m.validationErrorCode) ?? "VALIDATION_FAILED",
      message: asString(m.message) ?? "",
      type: (asString(m.validationResultCode) as NavValidationMessage["type"]) ?? "ERROR",
      lineNumber: asNumber(m.lineNumber) ?? asNumber(m.pointer?.line),
      pointer: asString(m.pointer?.tag),
    });
  }
  return out;
}

// re-export for consumers that just want the client.
export { CryptoError };

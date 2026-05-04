/**
 * Strict, typed error hierarchy for the NAV gateway.
 *
 * Designed to match the NAV Online Számla 3.0 fault model:
 *  - GeneralExceptionResponse (HTTP 4xx/5xx) -> NavGeneralError
 *  - GeneralErrorResponse (200 OK with funcCode = ERROR) -> NavGeneralError
 *  - Per-invoice technicalValidationMessages / businessValidationMessages -> NavValidationError
 *  - Local schema/business validation errors -> ValidationError
 *  - Crypto, network and configuration errors are first-class citizens.
 *
 * Every error is JSON-serializable (toJSON) so it can flow through the
 * GraphQL layer as a discriminated union member.
 */

export type ErrorSeverity = "ERROR" | "WARN" | "INFO" | "FATAL";

export type ErrorCategory =
  | "CONFIG"
  | "CRYPTO"
  | "NETWORK"
  | "TIMEOUT"
  | "PARSE"
  | "VALIDATION"
  | "NAV_GENERAL"
  | "NAV_BUSINESS"
  | "NAV_TECHNICAL"
  | "AUTH"
  | "RATE_LIMIT"
  | "INTERNAL";

export interface SerializedError {
  readonly name: string;
  readonly category: ErrorCategory;
  readonly code: string;
  readonly message: string;
  readonly severity: ErrorSeverity;
  readonly httpStatus?: number;
  readonly requestId?: string;
  readonly path?: string;
  readonly details?: unknown;
  readonly cause?: SerializedError | string;
}

export abstract class NavError extends Error {
  abstract readonly category: ErrorCategory;
  abstract readonly code: string;
  readonly severity: ErrorSeverity = "ERROR";
  readonly httpStatus?: number;
  readonly requestId?: string;
  readonly path?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: {
      cause?: unknown;
      requestId?: string;
      httpStatus?: number;
      path?: string;
      details?: unknown;
      severity?: ErrorSeverity;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    if (options?.requestId) this.requestId = options.requestId;
    if (options?.httpStatus) this.httpStatus = options.httpStatus;
    if (options?.path) this.path = options.path;
    if (options?.details !== undefined) this.details = options.details;
    if (options?.severity) (this as { severity: ErrorSeverity }).severity = options.severity;
  }

  toJSON(): SerializedError {
    const cause = (this.cause as Error | undefined);
    return {
      name: this.name,
      category: this.category,
      code: this.code,
      message: this.message,
      severity: this.severity,
      ...(this.httpStatus !== undefined ? { httpStatus: this.httpStatus } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(this.path ? { path: this.path } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(cause
        ? {
            cause:
              cause instanceof NavError
                ? cause.toJSON()
                : `${cause.name ?? "Error"}: ${cause.message ?? String(cause)}`,
          }
        : {}),
    };
  }
}

/* ---------- Local errors ---------- */

export class ConfigError extends NavError {
  readonly category = "CONFIG" as const;
  readonly code: string;
  constructor(code: string, message: string, details?: unknown) {
    super(message, { details });
    this.code = code;
  }
}

export class CryptoError extends NavError {
  readonly category = "CRYPTO" as const;
  readonly code: string;
  constructor(code: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.code = code;
  }
}

export class NetworkError extends NavError {
  readonly category = "NETWORK" as const;
  readonly code: string;
  constructor(message: string, cause?: unknown, code = "NETWORK_FAILURE") {
    super(message, { cause });
    this.code = code;
  }
}

export class TimeoutError extends NavError {
  readonly category = "TIMEOUT" as const;
  readonly code = "REQUEST_TIMEOUT";
  constructor(message: string, public readonly timeoutMs: number) {
    super(message, { details: { timeoutMs } });
  }
}

export class ParseError extends NavError {
  readonly category = "PARSE" as const;
  readonly code: string;
  constructor(code: string, message: string, details?: unknown) {
    super(message, { details });
    this.code = code;
  }
}

export class ValidationError extends NavError {
  readonly category = "VALIDATION" as const;
  readonly code: string;
  constructor(code: string, message: string, details?: unknown) {
    super(message, { details });
    this.code = code;
  }
}

export class AuthError extends NavError {
  readonly category = "AUTH" as const;
  readonly code: string;
  constructor(code: string, message: string) {
    super(message, { httpStatus: 401 });
    this.code = code;
  }
}

/* ---------- NAV-side errors ---------- */

/**
 * Returned when NAV responds with a GeneralExceptionResponse OR a
 * GeneralErrorResponse where funcCode = ERROR.
 *
 * For example:
 *   - INVALID_REQUEST_SIGNATURE
 *   - INVALID_USER_CREDENTIAL
 *   - INVALID_REQUEST_TIMESTAMP
 *   - INVALID_OPERATION
 *   - SCHEMA_VIOLATION
 *   - OPERATION_FAILED
 */
export class NavGeneralError extends NavError {
  readonly category: ErrorCategory;
  constructor(
    public readonly code: string,
    message: string,
    options: {
      requestId?: string;
      httpStatus?: number;
      severity?: ErrorSeverity;
      details?: unknown;
      isBusiness?: boolean;
    } = {},
  ) {
    super(message, options);
    this.category = options.isBusiness ? "NAV_BUSINESS" : "NAV_GENERAL";
  }
}

export interface NavValidationMessage {
  readonly tag?: string;
  readonly value?: string;
  readonly code: string;
  readonly message: string;
  readonly type: "BLOCKER" | "WARN" | "INFO" | "ERROR";
  readonly lineNumber?: number;
  readonly pointer?: string;
}

/**
 * Per-invoice business or technical validation aggregate. Returned when
 * any of the NAV responses contain processingResults / validationResultCode
 * other than DONE.
 */
export class NavValidationError extends NavError {
  readonly category = "NAV_BUSINESS" as const;
  readonly code: string;
  readonly invoiceIndex?: number;
  readonly batchIndex?: number;
  readonly validationResultCode?: string;
  readonly messages: ReadonlyArray<NavValidationMessage>;

  constructor(
    message: string,
    options: {
      code?: string;
      requestId?: string;
      validationResultCode?: string;
      invoiceIndex?: number;
      batchIndex?: number;
      messages?: ReadonlyArray<NavValidationMessage>;
    } = {},
  ) {
    super(message, { requestId: options.requestId });
    this.code = options.code ?? "VALIDATION_FAILED";
    if (options.invoiceIndex !== undefined) this.invoiceIndex = options.invoiceIndex;
    if (options.batchIndex !== undefined) this.batchIndex = options.batchIndex;
    if (options.validationResultCode) this.validationResultCode = options.validationResultCode;
    this.messages = options.messages ?? [];
  }

  override toJSON(): SerializedError & {
    invoiceIndex?: number;
    batchIndex?: number;
    validationResultCode?: string;
    messages: ReadonlyArray<NavValidationMessage>;
  } {
    return {
      ...super.toJSON(),
      ...(this.invoiceIndex !== undefined ? { invoiceIndex: this.invoiceIndex } : {}),
      ...(this.batchIndex !== undefined ? { batchIndex: this.batchIndex } : {}),
      ...(this.validationResultCode
        ? { validationResultCode: this.validationResultCode }
        : {}),
      messages: this.messages,
    };
  }
}

/* ---------- Helpers ---------- */

export function isNavError(err: unknown): err is NavError {
  return err instanceof NavError;
}

/**
 * Wrap any unknown thrown value into an InternalError with stack preservation.
 */
export class InternalError extends NavError {
  readonly category = "INTERNAL" as const;
  readonly code = "INTERNAL_ERROR";
}

export function wrapUnknown(err: unknown, message = "Unexpected internal error"): NavError {
  if (err instanceof NavError) return err;
  if (err instanceof Error) return new InternalError(`${message}: ${err.message}`, { cause: err });
  return new InternalError(`${message}: ${String(err)}`);
}

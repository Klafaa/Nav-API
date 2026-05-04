import {
  type NavError,
  type NavValidationMessage,
} from "../errors";
import { builder } from "./builder";

/**
 * Wrapper shape produced by the resolver layer (see resolvers.ts → wrapError).
 * Using a plain object instead of an `Error` instance ensures graphql-js does
 * not promote it to a top-level GraphQL error when returned from a resolver.
 */
export interface NavErrorShape {
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
  readonly messages?: ReadonlyArray<NavValidationMessage>;
}

const isShape = (typename: string) => (v: unknown): boolean =>
  typeof v === "object" && v !== null && (v as { __typename?: string }).__typename === typename;

/**
 * GraphQL representations of every error type that may bubble up from the NAV
 * layer. We expose them as both:
 *   - structured fields on the Error interface (for normal handling), and
 *   - a discriminated union (`NavOperationError`) returned in result types
 *     so clients can `... on NavValidationError { messages { ... } }`.
 */

const SeverityEnum = builder.enumType("ErrorSeverity", {
  values: ["INFO", "WARN", "ERROR", "FATAL"] as const,
});

const CategoryEnum = builder.enumType("ErrorCategory", {
  values: [
    "CONFIG",
    "CRYPTO",
    "NETWORK",
    "TIMEOUT",
    "PARSE",
    "VALIDATION",
    "NAV_GENERAL",
    "NAV_BUSINESS",
    "NAV_TECHNICAL",
    "AUTH",
    "RATE_LIMIT",
    "INTERNAL",
  ] as const,
});

const ValidationMessageType = builder
  .objectRef<NavValidationMessage>("NavValidationMessage")
  .implement({
    description: "Per-field validation message returned by NAV.",
    fields: (t) => ({
      tag: t.string({ nullable: true, resolve: (m) => m.tag ?? null }),
      value: t.string({ nullable: true, resolve: (m) => m.value ?? null }),
      code: t.string({ resolve: (m) => m.code }),
      message: t.string({ resolve: (m) => m.message }),
      type: t.string({ resolve: (m) => m.type }),
      lineNumber: t.int({
        nullable: true,
        resolve: (m) => m.lineNumber ?? null,
      }),
      pointer: t.string({ nullable: true, resolve: (m) => m.pointer ?? null }),
    }),
  });

const ErrorInterface = builder.interfaceRef<NavErrorShape>("NavError").implement({
  fields: (t) => ({
    name: t.string({ resolve: (e) => e.name }),
    code: t.string({ resolve: (e) => e.code }),
    message: t.string({ resolve: (e) => e.message }),
    category: t.field({
      type: CategoryEnum,
      resolve: (e) => e.category as never,
    }),
    severity: t.field({
      type: SeverityEnum,
      resolve: (e) => e.severity as never,
    }),
    requestId: t.string({ nullable: true, resolve: (e) => e.requestId ?? null }),
    httpStatus: t.int({ nullable: true, resolve: (e) => e.httpStatus ?? null }),
    path: t.string({ nullable: true, resolve: (e) => e.path ?? null }),
  }),
});

const ConfigErrorRef = builder.objectRef<NavErrorShape>("ConfigError");
const ValidationErrorRef = builder.objectRef<NavErrorShape>("ValidationError");
const CryptoErrorRef = builder.objectRef<NavErrorShape>("CryptoError");
const NetworkErrorRef = builder.objectRef<NavErrorShape>("NetworkError");
const TimeoutErrorRef = builder.objectRef<NavErrorShape>("TimeoutError");
const ParseErrorRef = builder.objectRef<NavErrorShape>("ParseError");
const AuthErrorRef = builder.objectRef<NavErrorShape>("AuthError");
const NavGeneralErrorRef = builder.objectRef<NavErrorShape>("NavGeneralError");
const NavValidationErrorRef = builder.objectRef<NavErrorShape>("NavValidationError");
const InternalErrorRef = builder.objectRef<NavErrorShape>("InternalError");

builder.objectType(ConfigErrorRef, {
  interfaces: [ErrorInterface],
  fields: () => ({}),
  isTypeOf: isShape("ConfigError"),
});
builder.objectType(ValidationErrorRef, {
  interfaces: [ErrorInterface],
  fields: () => ({}),
  isTypeOf: isShape("ValidationError"),
});
builder.objectType(CryptoErrorRef, {
  interfaces: [ErrorInterface],
  fields: () => ({}),
  isTypeOf: isShape("CryptoError"),
});
builder.objectType(NetworkErrorRef, {
  interfaces: [ErrorInterface],
  fields: () => ({}),
  isTypeOf: isShape("NetworkError"),
});
builder.objectType(TimeoutErrorRef, {
  interfaces: [ErrorInterface],
  isTypeOf: isShape("TimeoutError"),
  fields: (t) => ({
    timeoutMs: t.int({ resolve: (e) => e.timeoutMs ?? 0 }),
  }),
});
builder.objectType(ParseErrorRef, {
  interfaces: [ErrorInterface],
  fields: () => ({}),
  isTypeOf: isShape("ParseError"),
});
builder.objectType(AuthErrorRef, {
  interfaces: [ErrorInterface],
  fields: () => ({}),
  isTypeOf: isShape("AuthError"),
});
builder.objectType(NavGeneralErrorRef, {
  interfaces: [ErrorInterface],
  isTypeOf: isShape("NavGeneralError"),
  fields: (t) => ({
    details: t.field({
      type: "JSON",
      nullable: true,
      resolve: (e) => (e.details ?? null) as unknown,
    }),
  }),
});
builder.objectType(NavValidationErrorRef, {
  interfaces: [ErrorInterface],
  isTypeOf: isShape("NavValidationError"),
  fields: (t) => ({
    validationResultCode: t.string({
      nullable: true,
      resolve: (e) => e.validationResultCode ?? null,
    }),
    invoiceIndex: t.int({ nullable: true, resolve: (e) => e.invoiceIndex ?? null }),
    batchIndex: t.int({ nullable: true, resolve: (e) => e.batchIndex ?? null }),
    messages: t.field({
      type: [ValidationMessageType],
      resolve: (e) => [...(e.messages ?? [])] as NavValidationMessage[],
    }),
  }),
});
builder.objectType(InternalErrorRef, {
  interfaces: [ErrorInterface],
  fields: () => ({}),
  isTypeOf: isShape("InternalError"),
});

const NAMED_TYPES: Record<string, unknown> = {
  ConfigError: ConfigErrorRef,
  ValidationError: ValidationErrorRef,
  CryptoError: CryptoErrorRef,
  NetworkError: NetworkErrorRef,
  TimeoutError: TimeoutErrorRef,
  ParseError: ParseErrorRef,
  AuthError: AuthErrorRef,
  NavGeneralError: NavGeneralErrorRef,
  NavValidationError: NavValidationErrorRef,
  InternalError: InternalErrorRef,
};

export const ErrorUnion = builder.unionType("NavOperationError", {
  types: [
    ConfigErrorRef,
    ValidationErrorRef,
    CryptoErrorRef,
    NetworkErrorRef,
    TimeoutErrorRef,
    ParseErrorRef,
    AuthErrorRef,
    NavGeneralErrorRef,
    NavValidationErrorRef,
    InternalErrorRef,
  ],
  resolveType: (value) => {
    const tn = (value as { __typename?: string }).__typename;
    if (tn && NAMED_TYPES[tn]) return tn;
    return "InternalError";
  },
});

export { ErrorInterface };

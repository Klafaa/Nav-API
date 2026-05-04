# NAV Online Számla 3.0 GraphQL Gateway

Type-safe gateway between your application and the Hungarian Tax Authority's
**Online Számla 3.0** REST/XML API. The server speaks **GraphQL** to your
clients and **NAV's strictly-validated XML protocol** to NAV, with a robust
error-handling pipeline that surfaces every NAV-side validation rule as a
discriminated union in your GraphQL schema.

Built with:

| Layer    | Technology                                                              |
| -------- | ----------------------------------------------------------------------- |
| Runtime  | [Bun](https://bun.com) v1.3+                                            |
| HTTP     | [Elysia](https://elysiajs.com)                                          |
| GraphQL  | [Pothos](https://pothos-graphql.dev) + [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) |
| ORM      | [Drizzle](https://orm.drizzle.team) + Bun SQLite                        |
| XML      | [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) |
| Crypto   | Node `crypto` (SHA‑512, SHA3‑512, AES-128-ECB)                          |
| Validate | [Zod](https://zod.dev)                                                  |

## Features

- **Full coverage of every Online Számla 3.0 endpoint:**
  - `tokenExchange` (with automatic 4‑minute caching)
  - `manageInvoice` (CREATE / MODIFY / STORNO, up to 100 ops/batch)
  - `manageAnnulment` (technical érvénytelenítés)
  - `queryTransactionStatus`
  - `queryInvoiceData` (with optional base64 → XML decoding)
  - `queryInvoiceCheck`
  - `queryInvoiceDigest` (paged listing)
  - `queryTaxpayer`
- **Correct cryptography & signing per spec §1.5:**
  - `passwordHash` → SHA-512 with `cryptoType="SHA-512"`
  - `requestSignature` → SHA3-512 of `requestId + timestamp + signKey [+ Σ invoiceHash]`
  - `electronicInvoiceHash` → SHA3-512 with `cryptoType="SHA3-512"`
  - `encodedExchangeToken` → AES-128-ECB / PKCS5 with the technical user's exchange key
- **Strict, typed error model.** Every NAV failure mode (`GeneralExceptionResponse`,
  `GeneralErrorResponse`, `technicalValidationMessages`, `businessValidationMessages`,
  network, timeout, parse, crypto, config) is a distinct GraphQL type accessible
  through a `NavOperationError` union, so clients can pattern-match exhaustively.
- **Multi-tenant by default.** Register multiple technical users via
  `registerTechnicalUser` and pick the right one per request using `taxNumber`.
- **Audit log** of every NAV call (HTTP status, latency, requestId, error code).
- **Defensive timeouts** (70 s default) and **never-throwing GraphQL fields** –
  errors flow through the result union, not as top-level GraphQL errors.
- **Built-in GraphiQL** at `http://localhost:4000/graphql` for exploration.

## Quick start

```bash
bun install
cp .env.example .env
# fill NAV_SOFTWARE_ID and (optionally) the default technical user
bun run db:generate     # generate migrations from src/db/schema.ts
bun run db:migrate      # apply them to ./data/nav.sqlite
bun run dev             # start at http://localhost:4000
```

Open <http://localhost:4000/graphql> for GraphiQL.

## Environment

| Variable                       | Required        | Description                                                                            |
| ------------------------------ | --------------- | -------------------------------------------------------------------------------------- |
| `PORT`                         | no  (4000)      | Server port                                                                            |
| `DATABASE_URL`                 | no  (sqlite)    | Drizzle/SQLite path. Use `:memory:` for tests.                                         |
| `NAV_BASE_URL`                 | no  (test env)  | NAV root, e.g. `https://api.onlineszamla.nav.gov.hu/invoiceService/v3`                 |
| `NAV_SOFTWARE_ID`              | **yes**         | Exactly 18 chars matching `[0-9A-Z\-]{18}` – the software ID NAV registered for you    |
| `NAV_SOFTWARE_NAME`            | no              | ≤ 50 chars                                                                             |
| `NAV_SOFTWARE_OPERATION`       | no              | `ONLINE_SERVICE` (default) \| `LOCAL_SOFTWARE`                                         |
| `NAV_SOFTWARE_MAIN_VERSION`    | no              | e.g. `1.0.0`                                                                           |
| `NAV_SOFTWARE_DEV_NAME`        | no              | Developer / company                                                                    |
| `NAV_SOFTWARE_DEV_CONTACT`     | no              | Contact email                                                                          |
| `NAV_SOFTWARE_DEV_COUNTRY_CODE`| no  (`HU`)      | ISO-3166-1 α-2                                                                         |
| `NAV_SOFTWARE_DEV_TAX_NUMBER`  | no              | Developer tax number                                                                   |
| `NAV_LOGIN`                    | no              | Default technical-user login (6–15 chars).                                             |
| `NAV_PASSWORD`                 | no              | Default technical-user password (≤ 50 chars).                                          |
| `NAV_SIGN_KEY`                 | no              | Default `signatureKey` (used in requestSignature).                                     |
| `NAV_EXCHANGE_KEY`             | no              | Default `exchangeKey` – **must be exactly 16 ASCII bytes** (used to decrypt the token).|
| `NAV_TAX_NUMBER`               | no              | Default 8-digit core tax number.                                                       |

If you don't set the `NAV_LOGIN/...` block, every GraphQL call **must** pass an
explicit `taxNumber` and the technical user must be registered via the
`registerTechnicalUser` mutation.

## GraphQL surface

```graphql
type Query {
  health: JSON!
  software: SoftwareInfo!

  queryTaxpayer(taxNumber: String!, asTaxNumber: String): QueryTaxpayerPayload!
  queryInvoiceCheck(invoiceNumber: String!, direction: InvoiceDirection!, ...): QueryInvoiceCheckPayload!
  queryInvoiceData(invoiceNumber: String!, direction: InvoiceDirection!, ...): QueryInvoiceDataPayload!
  queryInvoiceDigest(page: Int!, direction: InvoiceDirection!, dateFrom: String!, dateTo: String!, ...): QueryInvoiceDigestPayload!
  queryTransactionStatus(transactionId: String!, ...): QueryTransactionStatusPayload!
}

type Mutation {
  manageInvoice(operations: [InvoiceOperationInput!]!, taxNumber: String): ManageInvoicePayload!
  manageAnnulment(operations: [AnnulmentOperationInput!]!, taxNumber: String): ManageInvoicePayload!
  registerTechnicalUser(taxNumber: String!, login: String!, password: String!, signKey: String!, exchangeKey: String!, label: String): JSON!
  deleteTechnicalUser(taxNumber: String!): Boolean!
}
```

### Result + error union pattern

Every NAV-bound field returns a `*Payload` with three discriminator fields:

```graphql
type ManageInvoicePayload {
  ok: Boolean!
  result: ManageInvoiceResult           # present when ok = true
  error: NavOperationError              # present when ok = false
}

union NavOperationError =
  | ConfigError
  | ValidationError
  | CryptoError
  | NetworkError
  | TimeoutError
  | ParseError
  | AuthError
  | NavGeneralError
  | NavValidationError
  | InternalError

interface NavError {
  name: String!
  code: String!
  message: String!
  category: ErrorCategory!
  severity: ErrorSeverity!
  requestId: String
  httpStatus: Int
  path: String
}
```

Example:

```graphql
mutation Submit($ops: [InvoiceOperationInput!]!) {
  manageInvoice(operations: $ops) {
    ok
    result { transactionId requestId timestamp }
    error {
      __typename
      ... on NavError { code message category severity httpStatus }
      ... on NavValidationError {
        validationResultCode
        invoiceIndex
        messages { code message tag value type lineNumber }
      }
      ... on TimeoutError { timeoutMs }
      ... on NavGeneralError { details }
    }
  }
}
```

### Submitting an invoice

```graphql
mutation {
  manageInvoice(operations: [{
    index: 1
    operation: CREATE
    invoiceDataXml: "<InvoiceData xmlns=\"http://schemas.nav.gov.hu/OSA/3.0/data\">...</InvoiceData>"
    completenessIndicator: false
  }]) {
    ok
    result { transactionId }
    error { __typename ... on NavError { code message } }
  }
}
```

The gateway:

1. Base64-encodes your `invoiceDataXml`.
2. Computes `electronicInvoiceHash = SHA3-512(base64)`.
3. Computes `requestSignature = SHA3-512(requestId + timestamp + signKey + Σ invoiceHash)`.
4. Encloses everything in the schema-valid `ManageInvoiceRequest` envelope.
5. Caches the exchange token (≤ 4 min) so subsequent submits don't need a
   round-trip to `tokenExchange`.

### Querying status

```graphql
query Status($id: String!) {
  queryTransactionStatus(transactionId: $id) {
    ok
    status {
      transactionId
      requestStatus
      processingResults {
        index
        invoiceStatus
        technicalValidationMessages { validationResultCode validationErrorCode message }
        businessValidationMessages { validationResultCode validationErrorCode message tag value line }
      }
    }
    error { __typename ... on NavError { code message } }
  }
}
```

## Development

```bash
bun run dev          # hot-reload server
bun run typecheck    # strict TypeScript
bun test             # 20+ unit tests for crypto, XML, header
bun run db:generate  # regenerate drizzle migrations after schema change
RUN_NAV_INTEGRATION=1 bun test src/nav/integration.test.ts   # against NAV test env
```

## Architecture

```
src/
├── config.ts                # Zod-validated env config
├── errors.ts                # Strict, typed error hierarchy
├── nav/
│   ├── crypto.ts            # SHA-512, SHA3-512, AES-128-ECB, request signature
│   ├── types.ts             # NAV domain types, namespaces, enums
│   ├── xml.ts               # fast-xml-parser builder/parser
│   ├── header.ts            # common:header / common:user / SoftwareType blocks
│   ├── client.ts            # NavClient – every operation, GeneralError mapping
│   └── *.test.ts            # Unit + integration tests
├── db/
│   ├── schema.ts            # technical_users, transactions, invoice_ops, audit_log
│   ├── index.ts             # Drizzle + Bun SQLite client
│   └── migrate.ts
├── graphql/
│   ├── builder.ts           # Pothos SchemaTypes + scalars
│   ├── errors.ts            # Error interface + 10 concrete object types + union
│   ├── types.ts             # Domain object/input types
│   ├── context.ts           # Multi-tenant NavClient resolution
│   ├── resolvers.ts         # Query / Mutation resolvers (always return Result<T>)
│   └── schema.ts            # Final SDL
├── server.ts                # Elysia + Yoga + GraphiQL
└── index.ts                 # Boot + signal handling
```

## Compliance with the 3.0 specification

This gateway implements the relevant **Online Számla 3.0 §1.5** requirements
verified against the official [`nav-gov-hu/Online-Invoice`](https://github.com/nav-gov-hu/Online-Invoice)
schemas (`invoiceApi.xsd`, `common.xsd`, `invoiceBase.xsd`, `invoiceAnnulment.xsd`):

- ✅ All requests use `requestVersion=3.0`, `headerVersion=1.0`.
- ✅ `passwordHash` carries `cryptoType="SHA-512"`.
- ✅ `requestSignature` carries `cryptoType="SHA3-512"`.
- ✅ `electronicInvoiceHash` carries `cryptoType="SHA3-512"` (3.0 §1.6.4).
- ✅ XML declaration: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`.
- ✅ `header/timestamp` is UTC ISO-8601 with millisecond precision and `Z` suffix.
- ✅ Signature timestamp is computed from the same instant in `YYYYMMDDhhmmss` UTC.
- ✅ `requestId`: 1–30 chars matching `[0-9A-Z]+`, monotonically increasing.
- ✅ `software/*` block carries the full mandatory subset.
- ✅ Default `xmlns="http://schemas.nav.gov.hu/OSA/3.0/api"` plus
  `xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common"`.
- ✅ `manageInvoice` rejects > 100 operations per batch (server-side limit).
- ✅ `completenessIndicator=true` forces SHA3-512 hash and the gateway computes
  it over the base64 invoice data so NAV's server-side hash check passes.
- ✅ Exchange token decoded with **AES-128/ECB/PKCS5Padding** using the technical
  user's exchange key (validated to be 16 bytes ASCII).
- ✅ `GeneralExceptionResponse` and `GeneralErrorResponse` (HTTP 4xx **or**
  HTTP 200 with `funcCode = ERROR`) parsed and mapped to `NavGeneralError`.
- ✅ `technicalValidationMessages` and `businessValidationMessages` aggregated
  into `NavValidationError.messages`.

## License

MIT (see SPDX header in source files).

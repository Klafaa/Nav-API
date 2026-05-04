import { Elysia } from "elysia";
import { createYoga } from "graphql-yoga";
import { config } from "./config";
import { ensureSchema } from "./db";
import { buildContext } from "./graphql/context";
import { schema } from "./graphql/schema";
import { isNavError } from "./errors";

export async function createServer() {
  await ensureSchema();
  const ctx = await buildContext();

  const yoga = createYoga({
    schema,
    context: () => ctx,
    graphqlEndpoint: "/graphql",
    landingPage: false,
    graphiql: {
      title: "NAV Online Számla 3.0 GraphQL Gateway",
      defaultQuery: `# Welcome to the NAV gateway.
# Try the queries below:

query Health {
  health
}

query Software {
  software {
    softwareId
    softwareName
    softwareOperation
    softwareMainVersion
  }
}

query Taxpayer {
  queryTaxpayer(taxNumber: "12345678") {
    ok
    taxpayer {
      taxpayerValidity
      taxpayerName
      incorporation
    }
    error {
      __typename
      ... on NavError { code message category severity }
      ... on NavValidationError { messages { code message tag } }
    }
  }
}
`,
    },
    maskedErrors: false,
    plugins: [
      {
        onExecute() {
          return {
            onExecuteDone(payload: { result: unknown }) {
              const r = payload.result as { errors?: Array<any> } | undefined;
              if (!r?.errors) return;
              for (const err of r.errors) {
                const original = (err.originalError ?? err) as unknown;
                if (isNavError(original)) {
                  err.extensions = {
                    ...(err.extensions ?? {}),
                    ...(original.toJSON() as unknown as Record<string, unknown>),
                  };
                }
              }
            },
          };
        },
      },
    ],
  });

  const app = new Elysia()
    .get("/", () => ({
      name: "nav-online-szamla-api",
      graphql: "/graphql",
      health: "/healthz",
      version: "1.0.0",
    }))
    .get("/healthz", () => ({ ok: true, ts: new Date().toISOString() }))
    .all("/graphql", ({ request }) => yoga.fetch(request))
    .all("/graphql/*", ({ request }) => yoga.fetch(request))
    .listen(config.PORT);

  return app;
}

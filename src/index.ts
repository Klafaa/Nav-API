import { createServer } from "./server";
import { config } from "./config";

const app = await createServer();

const banner = `
╔══════════════════════════════════════════════════════════════════╗
║   NAV Online Számla 3.0 GraphQL Gateway                          ║
║                                                                  ║
║   Listening on:    http://localhost:${String(config.PORT).padEnd(28)} ║
║   GraphiQL:        http://localhost:${String(config.PORT)}/graphql${" ".repeat(Math.max(0, 21 - String(config.PORT).length))} ║
║   NAV environment: ${config.NAV_BASE_URL.padEnd(46)} ║
║   Software ID:     ${(config.NAV_SOFTWARE_ID ?? "(not configured)").padEnd(46)} ║
╚══════════════════════════════════════════════════════════════════╝
`.trim();
console.log(banner);

const shutdown = async (signal: string) => {
  console.log(`\n[server] received ${signal}, shutting down…`);
  try {
    await app.stop();
  } catch (err) {
    console.error("[server] error during shutdown", err);
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

import { app } from "./app.ts";
import { env } from "./config/env.ts";
import { prisma } from "./db/prisma.ts";
import { redis } from "./db/redis.ts";

const startServer = async () => {
  await prisma.$connect();
  await redis.ping();
  const server = app.listen(env.PORT, () => {
    console.log(`♟️  Chess server running on port ${env.PORT}`);
  });

  server.on("error", (err) => {
    console.error("HTTP server failed", err);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => {
      console.error("Shutdown exceeded 10 secs");
      process.exit(1);
    }, 10000);
    timeout.unref();
    console.log("Stopping HTTP server");
    server.close(() => {
      console.log("HTTP server closed");
      Promise.all([prisma.$disconnect(), redis.quit()])
        .then(() => {
          clearTimeout(timeout);
          console.log("Database and redis connection closed");
        })
        .catch((err) => {
          console.error("Shutdown failed", err);
          process.exit(1);
        });
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

startServer().catch((err) => {
  console.error("Server startup failed:", err);
  process.exit(1);
});

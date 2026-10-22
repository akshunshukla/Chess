import { app } from "./app.ts";
import { env } from "./config/env.ts";
import { prisma } from "./db/prisma.ts";
import { redis } from "./db/redis.ts";
import { attachWebSocketServer } from "./ws/index.ts";
import { recoverGames, recoverMatchmaking } from "./game/index.ts";

const startServer = async () => {
  await prisma.$connect();
  await redis.ping();
  await recoverGames();
  await recoverMatchmaking();
  const server = app.listen(env.PORT, () => {
    console.log(`♟️  Chess server running on port ${env.PORT}`);
  });
  const { wss, pauseMatchmaking, stopMatchmaking } = attachWebSocketServer(server);
  server.on("error", (err) => {
    console.error("HTTP server failed", err);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    pauseMatchmaking();
    const timeout = setTimeout(() => {
      console.error("Shutdown exceeded 10 secs");
      process.exit(1);
    }, 10000);
    timeout.unref();
    console.log("Stopping HTTP server");
    const httpClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    const wsClosed = new Promise<void>((resolve, reject) => {
      wss.close((error) => (error ? reject(error) : resolve()));
    });
    for (const socket of wss.clients)
      socket.close(1001, "Server shutting down");
    Promise.all([httpClosed, wsClosed])
      .then(() => stopMatchmaking())
      .then(() => Promise.all([prisma.$disconnect(), redis.quit()]))
      .then(() => {
        clearTimeout(timeout);
        console.log("Shutdown complete");
      })
      .catch((error) => {
        console.error("Shutdown failed:", error);
        process.exit(1);
      });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

startServer().catch((err) => {
  console.error("Server startup failed:", err);
  process.exit(1);
});

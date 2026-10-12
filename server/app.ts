import Fastify from "fastify";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { RoomService, RoomError } from "./rooms.js";
import { RoomStore } from "./store.js";

export async function createApp(
  options: {
    dbPath?: string;
    logger?: boolean;
    dev?: boolean;
    tick?: boolean;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 8192,
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  const store = new RoomStore(
    options.dbPath ?? resolve(process.env.DATA_DIR ?? "./data", "rooms.sqlite"),
  );
  const service = new RoomService(store);
  await app.register(rateLimit, {
    max: 240,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({ error: "操作太频繁，请稍后再试" }),
  });
  await app.register(websocket, {
    options: { maxPayload: 4096, perMessageDeflate: false },
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Permissions-Policy",
      "microphone=(), camera=(), geolocation=()",
    );
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store");
    const origin = request.headers.origin;
    if (origin) {
      const allowed =
        process.env.PUBLIC_ORIGIN ?? `${request.protocol}://${request.host}`;
      let matches = origin === allowed;
      if (!process.env.PUBLIC_ORIGIN) {
        try {
          matches = new URL(origin).host === request.host;
        } catch {
          matches = false;
        }
      }
      if (!matches) throw new RoomError("来源地址不匹配", 403);
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 400;
    if (status >= 500) request.log.error(err);
    reply.code(status).send({
      error: status >= 500 ? "服务暂时不可用，请稍后重试" : err.message,
    });
  });
  const bearer = (header?: string) =>
    header?.startsWith("Bearer ") ? header.slice(7) : "";
  app.get("/api/health", async () => ({ ok: true, version: "1.0.0" }));
  app.post(
    "/api/rooms",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => service.create(request.body),
  );
  app.post(
    "/api/practice",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => service.createPractice(request.body),
  );
  app.post<{ Params: { code: string } }>(
    "/api/rooms/:code/join",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) =>
      service.join(request.params.code.toUpperCase(), request.body),
  );
  app.get<{ Params: { code: string } }>("/api/rooms/:code", async (request) => {
    const { room, member } = service.authenticate(
      request.params.code.toUpperCase(),
      bearer(request.headers.authorization),
    );
    return { room: service.view(room, member.id) };
  });
  app.post<{ Params: { code: string } }>(
    "/api/rooms/:code/action",
    async (request) => ({
      room: service.action(
        request.params.code.toUpperCase(),
        bearer(request.headers.authorization),
        request.body,
      ),
    }),
  );
  app.get("/ws", { websocket: true }, (socket, request) => {
    let unsubscribe: (() => void) | undefined;
    let alive = true;
    const authTimeout = setTimeout(() => socket.close(1008, "认证超时"), 5000);
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 25_000);
    socket.on("pong", () => {
      alive = true;
    });
    socket.on("message", (raw) => {
      try {
        if (unsubscribe) return;
        const message = JSON.parse(raw.toString()) as {
          type?: string;
          code?: string;
          token?: string;
        };
        if (
          message.type !== "subscribe" ||
          typeof message.code !== "string" ||
          typeof message.token !== "string"
        )
          throw new RoomError("无效连接");
        unsubscribe = service.subscribe(
          message.code.toUpperCase(),
          message.token,
          socket,
        );
        clearTimeout(authTimeout);
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "连接失败",
          }),
        );
        socket.close(1008, "认证失败");
      }
    });
    socket.on("close", () => {
      clearTimeout(authTimeout);
      clearInterval(heartbeat);
      unsubscribe?.();
    });
    socket.on("error", (error) =>
      request.log.warn({ error: error.message }, "websocket error"),
    );
  });
  let vite: { close(): Promise<void> } | undefined;
  if (options.dev) {
    const { createServer } = await import("vite");
    const devServer = await createServer({
      // Fastify's websocket router owns upgrades on the game server. Vite
      // uses a separate development-only socket to avoid upgrade/reload loops.
      server: {
        middlewareMode: true,
        hmr: {
          port: Number(
            process.env.HMR_PORT ?? Number(process.env.PORT ?? 8080) + 1,
          ),
        },
      },
      appType: "spa",
    });
    vite = devServer;
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/"))
        return reply.code(404).send({ error: "接口不存在" });
      reply.hijack();
      devServer.middlewares(request.raw, reply.raw, () => {
        reply.raw.statusCode = 404;
        reply.raw.end();
      });
    });
  } else if (existsSync(resolve("dist/index.html"))) {
    await app.register(staticFiles, {
      root: resolve("dist"),
      wildcard: false,
      index: false,
    });
    app.get("/", async (_request, reply) =>
      reply.header("Cache-Control", "no-cache").sendFile("index.html"),
    );
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.includes("."))
        return reply.code(404).send({ error: "地址不存在" });
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    });
  }
  const timer =
    options.tick === false
      ? undefined
      : setInterval(() => {
          try {
            service.tick();
          } catch (error) {
            app.log.error(error, "room tick failed");
          }
        }, 500);
  timer?.unref();
  app.addHook("preClose", async () => {
    clearInterval(timer);
    service.close();
    await vite?.close();
  });
  app.addHook("onClose", async () => {
    store.close();
  });
  return { app, service };
}

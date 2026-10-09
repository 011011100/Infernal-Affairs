import { createApp } from "./app.js";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const { app } = await createApp({ dev: process.argv.includes("--dev") });
try {
  await app.listen({
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });

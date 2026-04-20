import { config } from "dotenv";
import { existsSync } from "node:fs";

export function loadEnv() {
  if (existsSync(".env.local")) config({ path: ".env.local" });
  else config();
}

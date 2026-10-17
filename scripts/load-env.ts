/**
 * Loads .env.local, then .env - the Next.js order: real environment variables
 * beat both, and .env.local beats .env (dotenv never overrides a set value).
 *
 * Every script imports this first. It replaced `import "dotenv/config"`, which
 * reads .env only: the laptop setup copies just .env.local, so the worker
 * started there with no keys at all and failed without a word in the database.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

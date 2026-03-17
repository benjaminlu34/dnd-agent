const requiredAtRuntime = ["DATABASE_URL"] as const;

function readEnv(name: string) {
  return process.env[name]?.trim();
}

export function getEnv(name: string) {
  const value = readEnv(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function hasEnv(name: string) {
  return Boolean(readEnv(name));
}

export function assertRuntimeEnv() {
  for (const key of requiredAtRuntime) {
    getEnv(key);
  }
}

export const env = {
  appUrl: readEnv("APP_URL") ?? "http://localhost:3000",
  databaseUrl: readEnv("DATABASE_URL") ?? "",
  directUrl: readEnv("DIRECT_URL") ?? "",
  openRouterApiKey: readEnv("OPENROUTER_API_KEY") ?? "",
  openRouterModel: readEnv("OPENROUTER_MODEL") ?? "anthropic/claude-3.5-sonnet",
  openRouterSiteName: readEnv("OPENROUTER_SITE_NAME") ?? "AI Solo RPG Engine",
};

const requiredAtRuntime = ["DATABASE_URL"] as const;

function readEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    return value;
  }

  const hasMatchingDoubleQuotes = value.startsWith("\"") && value.endsWith("\"");
  const hasMatchingSingleQuotes = value.startsWith("'") && value.endsWith("'");

  if (hasMatchingDoubleQuotes || hasMatchingSingleQuotes) {
    return value.slice(1, -1).trim();
  }

  return value;
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
  openRouterApiKey2: readEnv("OPENROUTER_API_KEY_2") ?? "",
  openRouterModel: readEnv("OPENROUTER_MODEL") ?? "anthropic/claude-3.5-sonnet",
  openRouterPlannerModel: readEnv("OPENROUTER_PLANNER_MODEL") ?? "",
  openRouterBackupRendererModel: readEnv("OPENROUTER_BACKUP_RENDERER_MODEL") ?? "",
  openRouterCompressionModel: readEnv("OPENROUTER_COMPRESSION_MODEL") ?? "",
  openRouterSiteName: readEnv("OPENROUTER_SITE_NAME") ?? "AI Solo RPG Engine",
};

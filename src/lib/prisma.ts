import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

declare global {
  var prisma: PrismaClient | undefined;
}

const runtimeUrl = env.directUrl || env.databaseUrl;

export const prisma =
  global.prisma ??
  new PrismaClient({
    datasourceUrl: runtimeUrl,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

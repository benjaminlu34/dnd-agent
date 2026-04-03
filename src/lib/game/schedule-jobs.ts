import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { dmClient, logBackendDiagnostic } from "@/lib/ai/provider";
import { parseCampaignRuntimeStateJson, parseFactionResourcesJson } from "@/lib/game/json-contracts";
import { prisma } from "@/lib/prisma";

const SCHEDULE_LEASE_TTL_MS = 40_000;
const SCHEDULE_LEASE_HEARTBEAT_MS = 10_000;
const MAX_SCHEDULE_ATTEMPTS = 3;

let wakePromise: Promise<void> | null = null;

function dayStartTimeForDay(dayNumber: number) {
  return (dayNumber - 1) * 1440;
}

async function claimScheduleJob() {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + SCHEDULE_LEASE_TTL_MS);
  const leaseOwnerId = `sched_${randomUUID()}`;
  const candidates = await prisma.scheduleGenerationJob.findMany({
    where: {
      OR: [
        { status: "pending" },
        {
          status: "processing",
          leaseExpiresAt: {
            lt: now,
          },
        },
      ],
      attempts: {
        lt: MAX_SCHEDULE_ATTEMPTS,
      },
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: 8,
  });

  for (const candidate of candidates) {
    const claimed = await prisma.scheduleGenerationJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: "pending" },
          {
            status: "processing",
            leaseExpiresAt: {
              lt: now,
            },
          },
        ],
      },
      data: {
        status: "processing",
        leaseOwnerId,
        leaseExpiresAt,
        attempts: {
          increment: 1,
        },
      },
    });

    if (claimed.count === 1) {
      return prisma.scheduleGenerationJob.findUnique({
        where: { id: candidate.id },
        include: {
          campaign: true,
        },
      });
    }
  }

  return null;
}

async function buildScheduleInput(campaignId: string, dayStartTime: number) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      module: true,
      locationNodes: {
        orderBy: { name: "asc" },
      },
      factions: {
        orderBy: { name: "asc" },
      },
      npcs: {
        orderBy: { name: "asc" },
      },
      information: {
        where: {
          isDiscovered: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 24,
      },
    },
  });

  if (!campaign) {
    return null;
  }

  const state = parseCampaignRuntimeStateJson(campaign.stateJson);
  return {
    campaign: {
      id: campaign.id,
      title: state.customTitle ?? campaign.module.title,
      premise: campaign.module.premise,
      tone: campaign.module.tone,
      setting: campaign.module.setting,
      currentLocationId: state.currentLocationId ?? campaign.locationNodes[0]?.id ?? "",
      dayStartTime,
      locations: campaign.locationNodes.map((location) => ({
        id: location.id,
        name: location.name,
        type: location.type,
        state: location.state,
        controllingFactionId: location.controllingFactionId,
      })),
      factions: campaign.factions.map((faction) => ({
        id: faction.id,
        name: faction.name,
        type: faction.type,
        agenda: faction.agenda,
        pressureClock: faction.pressureClock,
        resources: parseFactionResourcesJson(faction.resources),
      })),
      npcs: campaign.npcs.map((npc) => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
        factionId: npc.factionId,
        currentLocationId: npc.currentLocationId,
        state: npc.state,
        threatLevel: npc.threatLevel,
      })),
      discoveredInformation: campaign.information.map((information) => ({
        id: information.id,
        title: information.title,
        summary: information.summary,
        truthfulness: information.truthfulness,
        locationId: information.locationId,
        factionId: information.factionId,
      })),
    },
  };
}

function startScheduleLeaseHeartbeat(input: {
  jobId: string;
  leaseOwnerId: string;
}) {
  const timer = setInterval(() => {
    void prisma.scheduleGenerationJob.updateMany({
      where: {
        id: input.jobId,
        status: "processing",
        leaseOwnerId: input.leaseOwnerId,
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + SCHEDULE_LEASE_TTL_MS),
      },
    }).catch((error) => {
      console.error("[schedule-jobs] Failed to renew lease heartbeat.", error);
      logBackendDiagnostic("schedule_jobs.lease_heartbeat_failed", {
        jobId: input.jobId,
        leaseOwnerId: input.leaseOwnerId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, SCHEDULE_LEASE_HEARTBEAT_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => clearInterval(timer);
}

async function completeScheduleJob(input: {
  jobId: string;
  leaseOwnerId: string;
  campaignId: string;
  dayNumber: number;
  dayStartTime: number;
}) {
  const dayEndTime = input.dayStartTime + 1439;
  const existing = await prisma.scheduleGenerationJob.findUnique({
    where: { id: input.jobId },
  });

  if (!existing || existing.leaseOwnerId !== input.leaseOwnerId) {
    return;
  }

  const stopHeartbeat = startScheduleLeaseHeartbeat({
    jobId: input.jobId,
    leaseOwnerId: input.leaseOwnerId,
  });

  try {

    const existingEvents = await prisma.worldEvent.count({
      where: {
        campaignId: input.campaignId,
        triggerTime: {
          gte: input.dayStartTime,
          lte: dayEndTime,
        },
      },
    });
    const existingMoves = await prisma.factionMove.count({
      where: {
        campaignId: input.campaignId,
        scheduledAtTime: {
          gte: input.dayStartTime,
          lte: dayEndTime,
        },
      },
    });

    if (existingEvents > 0 || existingMoves > 0) {
      await prisma.$transaction([
        prisma.scheduleGenerationJob.update({
          where: { id: input.jobId },
          data: {
            status: "completed",
            leaseOwnerId: null,
            leaseExpiresAt: null,
            completedAt: new Date(),
          },
        }),
        prisma.campaign.update({
          where: { id: input.campaignId },
          data: {
            generatedThroughDay: {
              set: input.dayNumber,
            },
          },
        }),
      ]);
      return;
    }

    const scheduleInput = await buildScheduleInput(input.campaignId, input.dayStartTime);
    if (!scheduleInput) {
      throw new Error("Schedule job campaign context no longer exists.");
    }

    const schedule = await dmClient.generateDailyWorldSchedule(scheduleInput);

    await prisma.$transaction(async (tx) => {
      const stillOwned = await tx.scheduleGenerationJob.findUnique({
        where: { id: input.jobId },
        select: {
          leaseOwnerId: true,
        },
      });

      if (!stillOwned || stillOwned.leaseOwnerId !== input.leaseOwnerId) {
        return;
      }

      for (const event of schedule.worldEvents) {
        await tx.worldEvent.create({
          data: {
            id: `wevt_${randomUUID()}`,
            campaignId: input.campaignId,
            locationId: event.locationId,
            triggerTime: event.triggerTime,
            triggerCondition: event.triggerCondition
              ? (event.triggerCondition as unknown as Prisma.JsonObject)
              : Prisma.JsonNull,
            description: event.description,
            payload: event.payload as unknown as Prisma.JsonObject,
            isProcessed: false,
            isCancelled: false,
            cancellationReason: null,
            cascadeDepth: event.cascadeDepth ?? 0,
          },
        });
      }

      for (const move of schedule.factionMoves) {
        await tx.factionMove.create({
          data: {
            id: `fmove_${randomUUID()}`,
            campaignId: input.campaignId,
            factionId: move.factionId,
            scheduledAtTime: move.scheduledAtTime,
            description: move.description,
            payload: move.payload as unknown as Prisma.JsonObject,
            isExecuted: false,
            isCancelled: false,
            cancellationReason: null,
            cascadeDepth: move.cascadeDepth ?? 0,
          },
        });
      }

      await tx.scheduleGenerationJob.update({
        where: { id: input.jobId },
        data: {
          status: "completed",
          leaseOwnerId: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
        },
      });

      await tx.campaign.update({
        where: { id: input.campaignId },
        data: {
          generatedThroughDay: Math.max(scheduleInput.campaign.dayStartTime / 1440 + 1, input.dayNumber),
          degradedAt: null,
          infrastructureFailureCode: null,
        },
      });
    });
  } finally {
    stopHeartbeat();
  }
}

async function failScheduleJob(input: {
  jobId: string;
  campaignId: string;
  error: unknown;
}) {
  const job = await prisma.scheduleGenerationJob.findUnique({
    where: { id: input.jobId },
  });

  if (!job) {
    return;
  }

  const lastError = input.error instanceof Error ? input.error.message : String(input.error);

  if (job.attempts >= MAX_SCHEDULE_ATTEMPTS) {
    await prisma.$transaction([
      prisma.scheduleGenerationJob.update({
        where: { id: input.jobId },
        data: {
          status: "failed",
          leaseOwnerId: null,
          leaseExpiresAt: null,
          lastError,
          infrastructureFailureCode: "SCHEDULE_JOB_EXHAUSTED",
        },
      }),
      prisma.campaign.update({
        where: { id: input.campaignId },
        data: {
          degradedAt: new Date(),
          infrastructureFailureCode: "SCHEDULE_JOB_EXHAUSTED",
        },
      }),
    ]);
    return;
  }

  await prisma.scheduleGenerationJob.update({
    where: { id: input.jobId },
    data: {
      status: "pending",
      leaseOwnerId: null,
      leaseExpiresAt: null,
      lastError,
    },
  });
}

export async function processScheduleGenerationJobs(options?: { limit?: number }) {
  const limit = options?.limit ?? 2;

  for (let index = 0; index < limit; index += 1) {
    const job = await claimScheduleJob();
    if (!job) {
      return;
    }

    try {
      if (job.campaign.generatedThroughDay >= job.dayNumber) {
        await prisma.scheduleGenerationJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            leaseOwnerId: null,
            leaseExpiresAt: null,
            completedAt: new Date(),
          },
        });
        continue;
      }

      await completeScheduleJob({
        jobId: job.id,
        leaseOwnerId: job.leaseOwnerId ?? "",
        campaignId: job.campaignId,
        dayNumber: job.dayNumber,
        dayStartTime: job.dayStartTime || dayStartTimeForDay(job.dayNumber),
      });
    } catch (error) {
      await failScheduleJob({
        jobId: job.id,
        campaignId: job.campaignId,
        error,
      });
    }
  }
}

export function wakeScheduleGenerationJobs() {
  if (!wakePromise) {
    wakePromise = Promise.resolve()
      .then(() => processScheduleGenerationJobs({ limit: 2 }))
      .finally(() => {
        wakePromise = null;
      });
  }

  return wakePromise;
}

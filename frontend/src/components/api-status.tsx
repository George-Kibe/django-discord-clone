import { connection } from "next/server";

import { createApiClient } from "@/lib/api/client";

import { StatusPill } from "./status-pill";

type Readiness = "ready" | "degraded" | "unreachable";

async function checkReadiness(): Promise<Readiness> {
  try {
    const { data, response } = await createApiClient().GET("/api/health/ready", {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return response.ok && data?.status === "ok" ? "ready" : "degraded";
  } catch {
    return "unreachable";
  }
}

/** Server-rendered check that the frontend can reach the API over the internal network. */
export async function ApiStatus() {
  await connection();
  const readiness = await checkReadiness();
  return (
    <StatusPill label="API" state={readiness === "ready" ? "ok" : "error"} detail={readiness} />
  );
}

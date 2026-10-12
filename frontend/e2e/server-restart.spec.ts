import { execSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { live, newUser, send, sharedServer } from "./realtime-helpers";

/**
 * Restarts the API container mid-session. Runs in its own Playwright project after the main
 * suite (playwright.config.ts) so it can't disturb tests running in parallel.
 */
const repoRoot = path.resolve(__dirname, "../..");

function dockerAvailable(): boolean {
  try {
    execSync("docker compose ps --services", { cwd: repoRoot, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("clients reconnect after the API restarts, without losing or duplicating messages", async ({
  browser,
}) => {
  test.skip(!dockerAvailable(), "needs the Docker Compose stack on this machine");
  test.setTimeout(120_000);
  const owner = await newUser(browser, "rs_owner");
  const guest = await newUser(browser, "rs_guest");
  await sharedServer(owner.page, guest.page, "Restart Club");
  await send(guest.page, "before restart");
  await expect(live(owner.page, "message-list")).toContainText("before restart");

  execSync("docker compose restart api", { cwd: repoRoot, stdio: "ignore" });
  await expect
    .poll(async () => (await owner.page.request.get("/api/health/ready")).status(), {
      timeout: 60_000,
    })
    .toBe(200);

  // Both clients come back on their own; then messages flow both ways again.
  await expect(live(owner.page, "connection-banner")).toBeHidden({ timeout: 45_000 });
  await expect(live(guest.page, "connection-banner")).toBeHidden({ timeout: 45_000 });
  await send(guest.page, "after restart");
  await expect(live(owner.page, "message-list")).toContainText("after restart", {
    timeout: 20_000,
  });
  for (const text of ["before restart", "after restart"]) {
    await expect(live(owner.page, "message").filter({ hasText: text })).toHaveCount(1);
  }
  await owner.context.close();
  await guest.context.close();
});

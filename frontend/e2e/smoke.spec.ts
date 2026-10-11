import { expect, test } from "@playwright/test";

test("landing page renders with healthy API and WebSocket", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Discord Clone" })).toBeVisible();
  await expect(page.getByTestId("status-api")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("status-websocket")).toHaveAttribute("data-state", "ok");
});

test("API is served on the same origin", async ({ request }) => {
  const response = await request.get("/api/health/ready");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ status: "ok" });
});

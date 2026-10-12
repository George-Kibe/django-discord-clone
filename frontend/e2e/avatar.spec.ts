import { expect, test } from "@playwright/test";

import { png } from "./fixtures";
import { signUpAndLogin } from "./helpers";

// Always remove the avatar, even if an assertion failed, so runs never strand Cloudinary assets.
test.afterEach(async ({ page }) => {
  const csrf = (await page.context().cookies()).find((c) => c.name === "csrftoken")?.value ?? "";
  await page.request.delete("/api/v1/users/me/avatar", { headers: { "X-CSRFToken": csrf } });
});

test("upload, crop and remove an avatar (real Cloudinary)", async ({ page, request }) => {
  await signUpAndLogin(page, request, "avatar");
  // Needs real Cloudinary credentials (dev .env); skipped in CI where uploads aren't configured.
  const probe = await page.request.post("/api/v1/media/sign", {
    data: { purpose: "avatar", filename: "probe.png", size: 10 },
    headers: {
      "X-CSRFToken":
        (await page.context().cookies()).find((c) => c.name === "csrftoken")?.value ?? "",
    },
  });
  test.skip(probe.status() === 503, "Cloudinary is not configured");

  await page.goto("/settings/profile");
  await page.getByTestId("avatar-input").setInputFiles({
    name: "me.png",
    mimeType: "image/png",
    buffer: png(256),
  });
  await expect(page.getByRole("dialog", { name: "Crop your avatar" })).toBeVisible();
  await page.getByTestId("save-avatar").click();
  await expect(page.getByText("Avatar updated")).toBeVisible({ timeout: 20_000 });

  const avatar = page.getByTestId("profile-avatar").locator('img[src*="res.cloudinary.com"]');
  // Cloudinary renders the transformation on first request, which can take a few seconds.
  await expect(avatar).toBeVisible({ timeout: 20_000 });
  expect(await avatar.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Clean up so test runs don't accumulate assets.
  await page.getByTestId("remove-avatar").click();
  await expect(page.getByText("Avatar removed")).toBeVisible();
  await expect(page.getByTestId("profile-avatar").locator("img")).toHaveCount(0);
});

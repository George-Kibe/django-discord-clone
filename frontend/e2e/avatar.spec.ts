import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";

import { signUpAndLogin } from "./helpers";

/** Minimal valid PNG (solid colour) so the test needs no fixture files. */
function png(size: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x58)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
  await expect(avatar).toBeVisible();
  expect(await avatar.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // Clean up so test runs don't accumulate assets.
  await page.getByTestId("remove-avatar").click();
  await expect(page.getByText("Avatar removed")).toBeVisible();
  await expect(page.getByTestId("profile-avatar").locator("img")).toHaveCount(0);
});

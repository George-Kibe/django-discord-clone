import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signUpAndLogin } from "./helpers";
import { apiPost, live, newUser, send, sharedServer } from "./realtime-helpers";

/** Pre-launch checks across the app: CSP, themes, mobile layout, remaining Phase 6 UI. */

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}

/** Collects Content-Security-Policy violations reported by the browser. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(message.text()))
      violations.push(message.text());
  });
  return violations;
}

test("CSP is enforced without breaking the app", async ({ page, request }) => {
  const violations = watchCsp(page);
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  await signUpAndLogin(page, request, "csp");
  // Create a server with the full dialog: icon-less but with description, topic and public.
  await page.getByTestId("add-server").click();
  const dialog = page.getByRole("dialog", { name: "Add a server" });
  const name = `Open Lab ${Date.now().toString(36)}`;
  await dialog.getByLabel("Server name").fill(name);
  await dialog.getByLabel("Description (optional)").fill("Chemistry study sessions");
  await dialog.getByLabel("Topic").click();
  await page.getByRole("option", { name: "Science" }).click();
  await dialog.getByLabel(/Public server/).click();
  await dialog.getByRole("button", { name: "Create server" }).click();
  await expect(live(page, "channel-title")).toHaveText("general");
  await send(page, "hello **csp**");
  await expect(live(page, "message").last()).toHaveAttribute("data-pending", "false");

  await page.goto("/discover");
  await page.getByTestId("discover-search").fill(name);
  const card = page.getByTestId("discover-server").filter({ hasText: name });
  await expect(card).toContainText("Chemistry study sessions");
  await expect(card).toContainText("Science");
  for (const path of ["/settings/profile", "/settings/account", "/settings/notifications"]) {
    await page.goto(path);
    await page.locator("main").first().waitFor();
  }
  expect(violations).toEqual([]);
});

test("light and system themes, accessible in light mode", async ({ browser }) => {
  const owner = await newUser(browser, "theme_owner");
  const guest = await newUser(browser, "theme_guest");
  await sharedServer(owner.page, guest.page, "Bright");
  const page = owner.page;
  await expect(page.locator("html")).toHaveClass(/dark/); // the default

  await page.getByTestId("user-menu").filter({ visible: true }).click();
  await page.getByTestId("theme-menu").click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/); // remembered

  await send(guest.page, `hi @${owner.user.username} there`);
  await expect(live(page, "message").last()).toHaveAttribute("data-mentioned", "true");
  await expectNoViolations(page);
  for (const path of ["/channels/me", "/settings/account", "/discover"]) {
    await page.goto(path);
    await page.locator("main").first().waitFor();
    await expectNoViolations(page);
  }

  // "Match system" follows the OS preference (the account menu lives in the sidebar).
  await page.goto("/channels/me");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByTestId("user-menu").filter({ visible: true }).click();
  await page.getByTestId("theme-menu").click();
  await page.getByRole("menuitemradio", { name: "Match system" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light/);
  for (const user of [owner, guest]) await user.context.close();
});

test("server mute and category reordering", async ({ browser }) => {
  const owner = await newUser(browser, "mute_owner");
  const guest = await newUser(browser, "mute_guest");
  const { serverId } = await sharedServer(owner.page, guest.page, "Quiet Place");
  const page = owner.page;

  // Categories: "Text Channels" exists; add another and move it up.
  await apiPost(page, `/api/v1/servers/${serverId}/categories`, { name: "Archive" });
  const headings = page.getByRole("navigation", { name: "Channels" }).getByRole("button", {
    expanded: true,
  });
  await expect(headings).toHaveText([/Text Channels/i, /Archive/i]);
  await page.getByRole("button", { name: "Archive options" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(headings).toHaveText([/Archive/i, /Text Channels/i]);
  // The guest's sidebar follows live.
  const guestHeadings = guest.page
    .getByRole("navigation", { name: "Channels" })
    .getByRole("button", { expanded: true });
  await expect(guestHeadings).toHaveText([/Archive/i, /Text Channels/i]);

  // Mute the server: new messages no longer mark it unread.
  await page.goto("/channels/me");
  await page.goto(`/channels/${serverId}`);
  await page.getByTestId("server-menu").click();
  await page.getByRole("menuitem", { name: "Mute server" }).click();
  await expect(page.getByText("Server muted.")).toBeVisible();
  await page.goto("/channels/me");
  await send(guest.page, "anyone around?");
  const icon = page.getByTestId("server-list").getByRole("link", { name: /Quiet Place/ });
  await expect(icon).toHaveAttribute("data-unread", "false");
  await page.goto(`/channels/${serverId}`);
  await page.getByTestId("server-menu").click();
  await expect(page.getByRole("menuitem", { name: "Unmute server" })).toBeVisible();
  for (const user of [owner, guest]) await user.context.close();
});

test.describe("mobile (360 px)", () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test("chat, drawers and DMs work on a small phone", async ({ browser }) => {
    const owner = await newUser(browser, "mob_owner");
    const guest = await newUser(browser, "mob_guest");
    const { serverId } = await sharedServer(owner.page, guest.page, "Pocket");
    const mobile = await browser.newContext({
      viewport: { width: 360, height: 740 },
      isMobile: true,
      hasTouch: true,
      storageState: await guest.context.storageState(),
    });
    const page = await mobile.newPage();
    await page.goto(`/channels/${serverId}`);
    await expect(live(page, "channel-title")).toHaveText("general", { timeout: 30_000 });
    // No horizontal scrolling at 360 px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await send(page, "typed on a phone");
    await expect(live(owner.page, "message-list")).toContainText("typed on a phone");
    // The channel list lives in a drawer.
    await page.getByRole("button", { name: "Open channels" }).filter({ visible: true }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "general" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Home drawer → new DM.
    await page.goto("/channels/me");
    await page.getByRole("button", { name: "Open navigation" }).filter({ visible: true }).click();
    await page.getByRole("dialog").getByTestId("new-dm").click();
    const picker = page.getByRole("dialog", { name: "New message" });
    await picker.getByLabel("Find people").fill(owner.user.username);
    await picker.getByRole("checkbox", { name: new RegExp(owner.user.username) }).click();
    await picker.getByRole("button", { name: "Open conversation" }).click();
    await expect(live(page, "channel-title")).toHaveText(owner.user.username, { timeout: 30_000 });
    await send(page, "dm from mobile");
    await expect(live(page, "message").last()).toHaveAttribute("data-pending", "false");
    await expectNoViolations(page);
    await mobile.close();
    for (const user of [owner, guest]) await user.context.close();
  });
});

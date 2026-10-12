import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signUpAndLogin } from "./helpers";
import { apiPost, messageAction, newUser, send, sharedServer } from "./realtime-helpers";

/** WCAG 2.2 AA automated checks (NFR-UX-02). Manual keyboard/screen-reader passes happen in Phase 7. */
async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal") // Next.js dev-tools badge (dev only)
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary).toEqual([]);
}

test("public pages are accessible", async ({ page }) => {
  for (const path of ["/", "/login", "/register", "/forgot-password"]) {
    await page.goto(path);
    await page.locator("main").waitFor();
    await expectNoViolations(page);
  }
  // Error states too.
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your password.")).toBeVisible();
  await expectNoViolations(page);
});

test("signed-in pages are accessible", async ({ page, request }) => {
  await signUpAndLogin(page, request, "a11y");
  await expectNoViolations(page);
  for (const [path, ready] of [
    ["/settings/profile", "Display name"],
    ["/settings/account", "New email"],
  ] as const) {
    await page.goto(path);
    await page.getByLabel(ready).waitFor();
    await expectNoViolations(page);
  }
});

test("messaging UI is accessible (Phase 5)", async ({ browser }) => {
  const owner = await newUser(browser, "a11y_owner");
  const guest = await newUser(browser, "a11y_guest");
  const { url } = await sharedServer(owner.page, guest.page, "Accessible");
  const page = owner.page;

  await page.goto("/settings/notifications");
  await page.getByLabel(/Desktop notifications/).waitFor();
  await expectNoViolations(page);

  // A channel with a reply, a reaction and a mention, plus the open inbox and emoji picker.
  await page.goto(url);
  await send(guest.page, `hello @${owner.user.username} welcome`);
  await expect(page.getByTestId("inbox-count")).toHaveText("1");
  await page.getByTestId("inbox-button").click();
  await page.getByTestId("inbox-list").waitFor();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await messageAction(page.getByTestId("message").filter({ visible: true }).last(), "Add reaction");
  await page.getByTestId("emoji-picker").waitFor();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");

  // A DM conversation with the search panel open.
  const dm = await apiPost<{ id: string }>(page, "/api/v1/dms", {
    user_ids: [(await (await guest.page.request.get("/api/v1/users/me")).json()).id],
  });
  await page.goto(`/channels/me/${dm.id}`);
  await page.getByTestId("composer").filter({ visible: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Search messages" }).filter({ visible: true }).click();
  await page.getByTestId("search-panel").waitFor();
  await expectNoViolations(page);
  await owner.context.close();
  await guest.context.close();
});

test("community UI is accessible (Phase 6)", async ({ browser }) => {
  const owner = await newUser(browser, "a11y6_owner");
  const guest = await newUser(browser, "a11y6_guest");
  const { serverId } = await sharedServer(owner.page, guest.page, "Accessible Six");
  const page = owner.page;

  // A poll in the channel, and the poll dialog.
  await apiPost(
    page,
    `/api/v1/channels/${(await (await page.request.get(`/api/v1/servers/${serverId}/channels`)).json())[0].id}/messages`,
    {
      content: "",
      poll: { question: "Best day?", options: ["Mon", "Tue"], duration_minutes: 60 },
    },
  );
  await page.getByTestId("poll").filter({ visible: true }).waitFor();
  await page.getByTestId("create-poll").filter({ visible: true }).click();
  await page.getByRole("dialog", { name: "Create a poll" }).waitFor();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");

  // Channel permissions editor.
  await page.getByRole("link", { name: "general" }).hover();
  await page.getByRole("button", { name: "Edit #general" }).click();
  await page.getByRole("tab", { name: "Permissions" }).click();
  await page.getByTestId("channel-permissions").waitFor();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");

  // Server settings: members (moderation), bans, audit log.
  await page.goto(`/servers/${serverId}/settings`);
  for (const tab of ["Members", "Bans", "Audit log"]) {
    await page.getByRole("tab", { name: tab }).click();
    await page.getByRole("tabpanel").waitFor();
    await expectNoViolations(page);
  }

  // Discovery.
  await page.goto("/discover");
  await page.getByTestId("discover-search").waitFor();
  await expectNoViolations(page);
  await owner.context.close();
  await guest.context.close();
});

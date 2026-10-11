import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { signUpAndLogin } from "./helpers";

/** Next keeps recently visited pages mounted but hidden (<Activity>); only look at the live one. */
const live = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === "csrftoken")?.value ?? "";
}

async function createServer(page: Page, name: string) {
  await page.getByTestId("add-server").click();
  const dialog = page.getByRole("dialog", { name: "Add a server" });
  await dialog.getByLabel("Server name").fill(name);
  await dialog.getByRole("button", { name: "Create server" }).click();
  await expect(live(page, "channel-title")).toHaveText("general");
  await expect(page.getByTestId("server-menu")).toContainText(name);
}

async function send(page: Page, text: string) {
  await live(page, "composer").fill(text);
  await live(page, "composer").press("Enter");
}

async function newUser(browser: Browser, prefix: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = await signUpAndLogin(page, page.request, prefix);
  return { context, page, user };
}

test.describe("servers, channels & messages (Phase 3)", () => {
  test("create a server, invite a friend and chat", async ({ page, request, browser }) => {
    const owner = await signUpAndLogin(page, request, "owner");
    await createServer(page, "Study Group");

    // Markdown renders safely; edit + delete own messages.
    await send(page, "hello **world** <img src=x onerror=alert(1)>");
    const first = live(page, "message").last();
    await expect(first).toHaveAttribute("data-pending", "false");
    await expect(first.locator("strong")).toHaveText("world");
    await expect(first.locator("img")).toHaveCount(0);
    await first.hover();
    await first.getByRole("button", { name: "Edit message" }).click();
    await first.getByRole("textbox", { name: "Edit message" }).fill("hello everyone");
    await first.getByRole("textbox", { name: "Edit message" }).press("Enter");
    await expect(first).toContainText("hello everyone");
    await expect(first).toContainText("(edited)");

    await send(page, "this one goes away");
    const doomed = live(page, "message").last();
    await expect(doomed).toHaveAttribute("data-pending", "false");
    await doomed.hover();
    page.once("dialog", (d) => void d.accept());
    await doomed.getByRole("button", { name: "Delete message" }).click();
    await expect(page.getByText("this one goes away")).toHaveCount(0);

    // Invite link from the server menu.
    await page.getByTestId("server-menu").click();
    await page.getByRole("menuitem", { name: "Invite people" }).click();
    await page.getByRole("button", { name: "Create invite link" }).click();
    const link = await page.getByTestId("invite-link").inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9]{8}$/);
    await page.keyboard.press("Escape");

    // A second user accepts the invite and sees the history.
    const friend = await newUser(browser, "friend");
    await friend.page.goto(new URL(link).pathname);
    await expect(friend.page.getByTestId("invite-server-name")).toHaveText("Study Group");
    await friend.page.getByRole("button", { name: "Accept invite" }).click();
    await expect(live(friend.page, "channel-title")).toHaveText("general");
    await expect(friend.page.getByText("hello everyone")).toBeVisible();

    // Members don't get management actions.
    await friend.page.getByTestId("server-menu").click();
    await expect(friend.page.getByRole("menuitem", { name: "Create channel" })).toHaveCount(0);
    await expect(friend.page.getByRole("menuitem", { name: "Leave server" })).toBeVisible();
    await friend.page.keyboard.press("Escape");

    // The friend replies; the owner sees it without reloading (polling until Phase 4 real-time).
    await send(friend.page, "hi from your friend");
    await expect(page.getByText("hi from your friend")).toBeVisible({ timeout: 15_000 });

    // Member list + profile card (Phase 3 refreshes members on focus/interval; reload to be quick).
    await page.reload();
    const members = page.getByTestId("member-list");
    await expect(members).toContainText(owner.username);
    await expect(members).toContainText(friend.user.username);
    await members.getByRole("button", { name: new RegExp(friend.user.username) }).click();
    await expect(page.getByTestId("profile-card")).toContainText(`@${friend.user.username}`);
    await expect(page.getByTestId("mutual-servers")).toContainText("Study Group");
    await page.keyboard.press("Escape");

    await friend.context.close();
  });

  test("channels and categories", async ({ page, request }) => {
    await signUpAndLogin(page, request, "chan");
    await createServer(page, "Channels Inc");
    await page.getByRole("button", { name: "Create channel in Text Channels" }).click();
    await page.getByRole("dialog").getByLabel("Channel name").fill("Off Topic");
    await page.getByRole("dialog").getByRole("button", { name: "Create channel" }).click();
    await expect(live(page, "channel-title")).toHaveText("off-topic");
    await expect(
      page.getByRole("navigation", { name: "Channels" }).getByRole("link", { name: "off-topic" }),
    ).toBeVisible();

    await page.getByTestId("server-menu").click();
    await page.getByRole("menuitem", { name: "Create category" }).click();
    await page.getByRole("dialog").getByLabel("Category name").fill("Projects");
    await page.getByRole("dialog").getByRole("button", { name: "Create category" }).click();
    await expect(page.getByRole("button", { name: "Projects", exact: true })).toBeVisible();

    const nav = page.locator('nav[aria-label="Channels"]');
    // CSS query: the modal dialog marks the sidebar aria-hidden, which hides it from role queries.
    const names = () => nav.locator("a").allInnerTexts();
    expect(await names()).toEqual(["general", "off-topic"]);

    // Reorder: move off-topic above general.
    await nav.getByRole("listitem").filter({ hasText: "off-topic" }).hover();
    await page.getByRole("button", { name: "Edit #off-topic" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Move up" }).click();
    await expect.poll(names).toEqual(["off-topic", "general"]);

    // Move it into Projects.
    await page.getByRole("dialog").getByRole("combobox", { name: "Category" }).click();
    await page.getByRole("option", { name: "Projects" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(nav.locator("section").filter({ hasText: "Projects" })).toContainText("off-topic");

    // Rename, then delete the category (its channel survives).
    await page.getByRole("button", { name: "Projects options" }).click();
    await page.getByRole("menuitem", { name: "Rename category" }).click();
    await page.getByRole("dialog").getByLabel("Category name").fill("Work");
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("button", { name: "Work", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Work options" }).click();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("menuitem", { name: "Delete category" }).click();
    await expect(page.getByRole("button", { name: "Work", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "off-topic" })).toBeVisible();
  });

  test("scrolling up loads older history", async ({ page, request }) => {
    test.setTimeout(90_000); // seeds 120 messages first
    await signUpAndLogin(page, request, "history");
    await createServer(page, "Long History");
    const channelId = page.url().split("/").at(-1)!;
    const token = await csrf(page);
    for (let i = 1; i <= 120; i++) {
      const response = await page.request.post(`/api/v1/channels/${channelId}/messages`, {
        data: { content: `history message ${i}` },
        headers: { "X-CSRFToken": token },
      });
      expect(response.ok()).toBeTruthy();
    }
    await page.reload();
    await expect(page.getByText("history message 120")).toBeVisible();
    await expect(page.getByText("history message 1", { exact: true })).toHaveCount(0);

    const list = live(page, "message-list");
    // Keep scrolling to the top until the very first message has been loaded.
    await expect(async () => {
      await list.evaluate((el) => (el.scrollTop = 0));
      await expect(page.getByText("history message 1", { exact: true })).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 20_000 });
    await expect(async () => {
      await list.evaluate((el) => (el.scrollTop = 0));
      await expect(page.getByText("Welcome to #general!")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
  });

  test("invalid invite and accessibility", async ({ page, request }) => {
    await page.goto("/invite/notareal1");
    await expect(page.getByTestId("invite-invalid")).toBeVisible();

    await signUpAndLogin(page, request, "a11yserver");
    await createServer(page, "Accessible");
    await send(page, "checking **contrast** and `labels`");
    await expect(live(page, "message")).toHaveCount(1);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .exclude("nextjs-portal")
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      ),
    ).toEqual([]);
  });
});

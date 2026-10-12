import { expect, test, type Page } from "@playwright/test";

import { PASSWORD } from "./helpers";
import { apiPost, live, messageAction, newUser, send, sharedServer } from "./realtime-helpers";

/** Community features (Phase 6). */

const message = (page: Page, text: string) =>
  live(page, "message").filter({ has: page.locator("p", { hasText: text }) });

test.describe("community features (Phase 6)", () => {
  test("discover a public server and join it", async ({ browser }) => {
    const owner = await newUser(browser, "dc_owner");
    const visitor = await newUser(browser, "dc_visitor");
    const name = `Astronomy ${Date.now().toString(36)}`;
    const server = await apiPost<{ id: string }>(owner.page, "/api/v1/servers", {
      name,
      description: "Stargazing and telescopes",
      is_public: true,
    });

    await visitor.page.getByRole("link", { name: "Discover servers" }).click();
    await visitor.page.getByTestId("discover-search").fill("stargazing telescopes".split(" ")[0]);
    const card = visitor.page.getByTestId("discover-server").filter({ hasText: name });
    await expect(card).toContainText("1 member");
    await card.getByRole("button", { name: `Join ${name}` }).click();
    await expect(visitor.page).toHaveURL(new RegExp(`/channels/${server.id}`), { timeout: 30_000 });
    await expect(live(visitor.page, "channel-title")).toHaveText("general");
    for (const user of [owner, visitor]) await user.context.close();
  });

  test("polls: vote, live results, end", async ({ browser }) => {
    const owner = await newUser(browser, "pl_owner");
    const guest = await newUser(browser, "pl_guest");
    await sharedServer(owner.page, guest.page, "Polling");

    await live(owner.page, "create-poll").click();
    const dialog = owner.page.getByRole("dialog", { name: "Create a poll" });
    await dialog.getByLabel("Question").fill("When should we study?");
    await dialog.getByLabel("Answer 1").fill("Morning");
    await dialog.getByLabel("Answer 2").fill("Evening");
    await dialog.getByRole("button", { name: "Post poll" }).click();

    const guestPoll = live(guest.page, "poll").filter({ hasText: "When should we study?" });
    await guestPoll.getByRole("radio", { name: /Evening/ }).click();
    await expect(guestPoll.getByRole("radio", { name: /Evening/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const ownerPoll = live(owner.page, "poll").filter({ hasText: "When should we study?" });
    await expect(ownerPoll.getByTestId("poll-total")).toHaveText("1 voter");
    await ownerPoll.getByRole("radio", { name: /Evening/ }).click();
    await expect(guestPoll.getByTestId("poll-total")).toHaveText("2 voters");
    await expect(guestPoll.getByRole("radio", { name: /Evening/ })).toContainText("2 votes · 100%");

    await ownerPoll.getByRole("button", { name: "End poll" }).click();
    await expect(guestPoll).toHaveAttribute("data-closed", "true");
    await expect(guestPoll).toContainText("Poll closed");
    await expect(guestPoll.getByRole("radio", { name: /Morning/ })).toBeDisabled();
    for (const user of [owner, guest]) await user.context.close();
  });

  test("moderation: kick, ban, audit log, report", async ({ browser }) => {
    const owner = await newUser(browser, "md_owner");
    const guest = await newUser(browser, "md_guest");
    const { serverId } = await sharedServer(owner.page, guest.page, "Moderated");

    // The guest reports one of the owner's messages.
    await send(owner.page, "please behave");
    await messageAction(message(guest.page, "please behave"), "Report message");
    await guest.page.getByLabel("What's wrong with it?").fill("testing reports");
    await guest.page.getByRole("button", { name: "Send report" }).click();
    await expect(guest.page.getByText("Thanks, our staff will take a look.")).toBeVisible();

    // Kick: the guest is taken out of the server live.
    await owner.page.goto(`/servers/${serverId}/settings`);
    await owner.page.getByRole("tab", { name: "Members" }).click();
    const row = owner.page.getByTestId("settings-member").filter({ hasText: guest.user.username });
    await row.getByRole("button", { name: "Kick" }).click();
    await owner.page.getByLabel(/Reason/).fill("cooling off");
    await owner.page.getByRole("dialog").getByRole("button", { name: "Kick" }).click();
    await expect(row).toHaveCount(0);
    await expect(guest.page).toHaveURL(/\/channels\/me$/, { timeout: 20_000 });

    // Ban (via an invite they can no longer use), then unban.
    await apiPost(owner.page, `/api/v1/servers/${serverId}/bans`, {
      user_id: (await (await guest.page.request.get("/api/v1/users/me")).json()).id,
      reason: "spam",
    });
    const invite = await apiPost<{ code: string }>(
      owner.page,
      `/api/v1/servers/${serverId}/invites`,
    );
    await guest.page.goto(`/invite/${invite.code}`);
    await guest.page.getByRole("button", { name: "Accept invite" }).click();
    await expect(guest.page.getByText("You're banned from this server.")).toBeVisible();

    await owner.page.getByRole("tab", { name: "Bans" }).click();
    await expect(owner.page.getByTestId("bans")).toContainText("Reason: spam");
    await owner.page.getByRole("button", { name: "Unban" }).click();
    await expect(owner.page.getByText("Nobody is banned.")).toBeVisible();

    await owner.page.getByRole("tab", { name: "Audit log" }).click();
    const log = owner.page.getByTestId("audit-log");
    await expect(log).toContainText("Member unbanned");
    await expect(log).toContainText("Member banned");
    await expect(log).toContainText("Member kicked");
    await expect(log).toContainText("reason: cooling off");
    for (const user of [owner, guest]) await user.context.close();
  });

  test("private channel via channel permissions", async ({ browser }) => {
    const owner = await newUser(browser, "pc_owner");
    const guest = await newUser(browser, "pc_guest");
    const { serverId } = await sharedServer(owner.page, guest.page, "Private Club");
    const staff = await apiPost<{ id: string }>(
      owner.page,
      `/api/v1/servers/${serverId}/channels`,
      {
        name: "staff",
      },
    );
    await expect(guest.page.getByRole("link", { name: "staff" })).toBeVisible();

    await owner.page.getByRole("link", { name: "staff" }).hover();
    await owner.page.getByRole("button", { name: "Edit #staff" }).click();
    await owner.page.getByRole("tab", { name: "Permissions" }).click();
    await owner.page.getByLabel(/Private channel/).click();
    await expect(owner.page.getByLabel(/Private channel/)).toBeChecked();

    // The guest loses the channel live; the owner (owner bypass) keeps it.
    await expect(guest.page.getByRole("link", { name: "staff" })).toHaveCount(0);
    await owner.page.keyboard.press("Escape"); // the open dialog hides the sidebar from a11y queries
    await expect(owner.page.getByRole("link", { name: "staff" })).toBeVisible();
    expect(staff.id).toBeTruthy();
    for (const user of [owner, guest]) await user.context.close();
  });

  test("transcript export arrives in the inbox and downloads as PDF", async ({ browser }) => {
    const owner = await newUser(browser, "ex_owner");
    const guest = await newUser(browser, "ex_guest");
    await sharedServer(owner.page, guest.page, "Exports");
    await send(owner.page, "lecture notes, part one");
    await expect(message(owner.page, "lecture notes, part one")).toHaveAttribute(
      "data-pending",
      "false",
    );

    await live(owner.page, "export-button").click();
    await owner.page.getByRole("dialog").getByRole("button", { name: "Export PDF" }).click();
    await expect(owner.page.getByText("Preparing your transcript.")).toBeVisible();
    await expect(owner.page.getByTestId("inbox-count")).toHaveText("1", { timeout: 30_000 });
    await owner.page.getByTestId("inbox-button").click();
    const entry = owner.page.getByTestId("notification").first();
    await expect(entry).toContainText("Your transcript of #general is ready");
    const [download] = await Promise.all([owner.page.waitForEvent("download"), entry.click()]);
    expect(download.suggestedFilename()).toMatch(/^transcript-.*\.pdf$/);
    const path = await download.path();
    const bytes = await import("node:fs/promises").then((fs) => fs.readFile(path));
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    // Members without Export Transcripts don't get the button.
    await expect(live(guest.page, "export-button")).toHaveCount(0);
    for (const user of [owner, guest]) await user.context.close();
  });

  test("download personal data and delete the account", async ({ browser }) => {
    const owner = await newUser(browser, "ac_owner");
    const leaver = await newUser(browser, "ac_leaver");
    await sharedServer(owner.page, leaver.page, "Goodbyes");
    await send(leaver.page, "farewell everyone");
    await expect(message(owner.page, "farewell everyone")).toBeVisible();

    const exported = await leaver.page.request.get("/api/v1/users/me/export");
    const data = await exported.json();
    expect(data.messages.map((m: { content: string }) => m.content)).toContain("farewell everyone");

    await leaver.page.goto("/settings/account");
    await leaver.page.getByTestId("delete-account").click();
    await leaver.page.getByRole("dialog").getByLabel("Password").fill(PASSWORD);
    await leaver.page.getByRole("button", { name: "Delete my account" }).click();
    await expect(leaver.page).toHaveURL(/\/login/);

    // Their message stays, attributed to "Deleted User".
    await owner.page.reload();
    await expect(message(owner.page, "farewell everyone")).toContainText("Deleted User");
    // Owners have to hand over their servers first.
    await owner.page.goto("/settings/account");
    await owner.page.getByTestId("delete-account").click();
    await owner.page.getByRole("dialog").getByLabel("Password").fill(PASSWORD);
    await owner.page.getByRole("button", { name: "Delete my account" }).click();
    await expect(owner.page.getByRole("dialog")).toContainText("Transfer ownership");
    for (const user of [owner, leaver]) await user.context.close();
  });
});

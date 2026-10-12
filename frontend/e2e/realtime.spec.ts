import { expect, test } from "@playwright/test";

import { live, memberRow, newUser, send, sharedServer } from "./realtime-helpers";

test.describe("real-time (Phase 4)", () => {
  test("messages, typing, presence and unread state are live", async ({ browser }) => {
    const owner = await newUser(browser, "rt_owner");
    const guest = await newUser(browser, "rt_guest");
    const { serverId } = await sharedServer(owner.page, guest.page, "Live Room");

    // Presence: each sees the other online.
    await expect(memberRow(owner.page, guest.user.username)).toHaveAttribute(
      "data-presence",
      "online",
    );
    await expect(memberRow(guest.page, owner.user.username)).toHaveAttribute(
      "data-presence",
      "online",
    );

    // Typing indicator, then the message replaces it, with no reload.
    await live(guest.page, "composer").pressSequentially("hel");
    await expect(live(owner.page, "typing-indicator")).toContainText(
      `${guest.user.username} is typing…`,
    );
    await live(guest.page, "composer").pressSequentially("lo from the guest");
    await live(guest.page, "composer").press("Enter");
    await expect(live(owner.page, "message-list")).toContainText("hello from the guest");
    await expect(live(owner.page, "typing-indicator")).toHaveText("");
    await expect(
      live(owner.page, "message").filter({ hasText: "hello from the guest" }),
    ).toHaveCount(1);

    // Edits and deletes propagate.
    await send(owner.page, "typo here");
    const mine = live(owner.page, "message").filter({ hasText: "typo here" });
    await expect(mine).toHaveAttribute("data-pending", "false");
    await expect(live(guest.page, "message-list")).toContainText("typo here");
    await mine.hover();
    await mine.getByRole("button", { name: "Edit message" }).click();
    const editor = owner.page.getByRole("textbox", { name: "Edit message" });
    await editor.fill("fixed now");
    await editor.press("Enter");
    await expect(live(guest.page, "message-list")).toContainText("fixed now");
    const fixed = live(owner.page, "message").filter({ hasText: "fixed now" });
    await fixed.hover();
    owner.page.once("dialog", (d) => void d.accept());
    await fixed.getByRole("button", { name: "Delete message" }).click();
    await expect(live(guest.page, "message-list")).not.toContainText("fixed now");

    // Unread: the owner moves to a new channel; the guest posts in #general.
    await owner.page.getByTestId("server-menu").click();
    await owner.page.getByRole("menuitem", { name: "Create channel" }).click();
    await owner.page.getByRole("dialog").getByLabel("Channel name").fill("random");
    await owner.page.getByRole("dialog").getByRole("button", { name: "Create channel" }).click();
    await expect(live(owner.page, "channel-title")).toHaveText("random");
    // The guest's sidebar picks up the new channel without a reload.
    await expect(guest.page.getByRole("link", { name: "random" })).toBeVisible();

    await send(guest.page, "are you there?");
    const general = owner.page.getByRole("link", { name: /general/ });
    await expect(general).toHaveAttribute("data-unread", "true");
    await general.click();
    await expect(live(owner.page, "message-list")).toContainText("are you there?");
    await owner.page.getByRole("link", { name: /random/ }).click();
    await expect(general).toHaveAttribute("data-unread", "false");

    // Unread on the server icon while the owner is elsewhere.
    await owner.page.goto("/channels/me");
    await send(guest.page, "ping from general");
    await expect(
      owner.page.getByTestId("server-list").getByRole("link", { name: "Live Room (unread)" }),
    ).toBeVisible();

    // Status changes, then going offline.
    await guest.page.getByTestId("user-menu").filter({ visible: true }).click();
    await guest.page.getByTestId("status-menu").click();
    await guest.page.getByRole("menuitemradio", { name: "Do not disturb" }).click();
    await owner.page.goto(`/channels/${serverId}`);
    await expect(memberRow(owner.page, guest.user.username)).toHaveAttribute(
      "data-presence",
      "dnd",
    );
    await guest.context.close();
    await expect(memberRow(owner.page, guest.user.username)).toHaveAttribute(
      "data-presence",
      "offline",
    );
    await owner.context.close();
  });

  test("a dropped connection reconnects and backfills missed messages", async ({ browser }) => {
    const owner = await newUser(browser, "rt_drop");
    const guest = await newUser(browser, "rt_peer");

    // Route the owner's gateway through Playwright so the test can cut it.
    let blocked = false;
    const sockets: { close: (o?: { code?: number; reason?: string }) => Promise<void> }[] = [];
    await owner.page.routeWebSocket(/\/ws\/$/, (ws) => {
      if (blocked) {
        void ws.close({ code: 4000, reason: "test outage" });
        return;
      }
      ws.connectToServer();
      sockets.push(ws);
    });
    await sharedServer(owner.page, guest.page, "Flaky Wifi");
    await send(guest.page, "before the outage");
    await expect(live(owner.page, "message-list")).toContainText("before the outage");

    blocked = true;
    await Promise.all(sockets.map((ws) => ws.close({ code: 4000, reason: "test outage" })));
    await expect(live(owner.page, "connection-banner")).toBeVisible();
    await send(guest.page, "sent while you were away");
    await expect(live(guest.page, "message").last()).toHaveAttribute("data-pending", "false");

    blocked = false;
    await expect(live(owner.page, "connection-banner")).toBeHidden({ timeout: 20_000 });
    await expect(live(owner.page, "message-list")).toContainText("sent while you were away");
    await send(guest.page, "and after");
    await expect(live(owner.page, "message-list")).toContainText("and after");
    for (const text of ["before the outage", "sent while you were away", "and after"]) {
      await expect(live(owner.page, "message").filter({ hasText: text })).toHaveCount(1);
    }
    await owner.context.close();
    await guest.context.close();
  });
});

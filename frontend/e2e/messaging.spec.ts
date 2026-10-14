import { expect, test, type Page } from "@playwright/test";

import { png } from "./fixtures";
import {
  apiPost,
  live,
  messageAction,
  newUser,
  realtimeReady,
  send,
  sharedServer,
} from "./realtime-helpers";

/** Rich messaging & DMs (Phase 5). */

/** The message whose own text (not a quoted reply preview) contains ``text``. */
const message = (page: Page, text: string) =>
  live(page, "message").filter({ has: page.locator("p", { hasText: text }) });

async function typeMention(page: Page, partial: string, pick: string) {
  const composer = live(page, "composer");
  await composer.pressSequentially(`@${partial}`);
  const suggestions = page.getByTestId("mention-suggestions");
  await expect(suggestions).toBeVisible();
  await suggestions
    .getByRole("option", { name: new RegExp(pick) })
    .first()
    .click();
}

test.describe("rich messaging & DMs (Phase 5)", () => {
  test("mention → highlighted message, badge and inbox notification", async ({ browser }) => {
    const owner = await newUser(browser, "mn_owner");
    const guest = await newUser(browser, "mn_guest");
    const { url } = await sharedServer(owner.page, guest.page, "Mentions");

    // The owner goes elsewhere; the guest mentions them through autocomplete.
    await owner.page.goto("/channels/me");
    await realtimeReady(owner.page);
    await typeMention(guest.page, owner.user.username.slice(0, 6), owner.user.username);
    await live(guest.page, "composer").pressSequentially("can you check this?");
    await live(guest.page, "composer").press("Enter");
    const sent = message(guest.page, "can you check this?");
    await expect(sent).toHaveAttribute("data-pending", "false");
    await expect(sent.locator('[data-mention="user"]')).toHaveText(`@${owner.user.username}`);

    // Owner: server mention badge, inbox count, notification entry.
    await expect(
      owner.page.getByTestId("server-list").getByRole("link", { name: /Mentions/ }),
    ).toContainText("1");
    await expect(owner.page.getByTestId("inbox-count")).toHaveText("1");
    await owner.page.getByTestId("inbox-button").click();
    const entry = owner.page.getByTestId("notification").first();
    await expect(entry).toContainText(`${guest.user.username} mentioned you in #general`);
    await entry.click();
    await expect(owner.page).toHaveURL(new RegExp(`${url}$`));
    const highlighted = message(owner.page, "can you check this?");
    await expect(highlighted).toHaveAttribute("data-mentioned", "true");
    await expect(owner.page.getByTestId("inbox-count")).toHaveCount(0);

    await owner.context.close();
    await guest.context.close();
  });

  test("replies, reactions and pins", async ({ browser }) => {
    const owner = await newUser(browser, "rx_owner");
    const guest = await newUser(browser, "rx_guest");
    await sharedServer(owner.page, guest.page, "Reactions");

    await send(owner.page, "Which chapter is on the exam?");
    const question = message(guest.page, "Which chapter is on the exam?");
    await expect(question).toBeVisible();

    // Reply with a quoted preview.
    await messageAction(question, "Reply");
    await expect(guest.page.getByTestId("replying-to")).toContainText(owner.user.username);
    await send(guest.page, "Chapter four");
    const reply = message(owner.page, "Chapter four");
    await expect(reply.getByTestId("reply-preview")).toContainText("Which chapter is on the exam?");
    await expect(reply).toHaveAttribute("data-mentioned", "true"); // replies to you highlight

    // React from the toolbar's emoji picker; the other side sees it live and joins in.
    await messageAction(question, "Add reaction");
    await guest.page.getByRole("textbox", { name: "Search emoji" }).fill("thumbs up");
    await guest.page.getByTestId("emoji-picker").getByRole("button", { name: "thumbs up" }).click();
    const ownerReaction = message(owner.page, "Which chapter is on the exam?").getByTestId(
      "reaction",
    );
    await expect(ownerReaction).toHaveAttribute("aria-pressed", "false");
    await expect(ownerReaction).toContainText("1");
    await ownerReaction.click();
    await expect(ownerReaction).toHaveAttribute("aria-pressed", "true");
    await expect(ownerReaction).toContainText("2");
    await expect(
      message(guest.page, "Which chapter is on the exam?").getByTestId("reaction"),
    ).toContainText("2");

    // Pins: the guest keeps the pins list open while the owner (Manage Messages) pins: it
    // updates live via pins.updated.
    await live(guest.page, "pins-button").click();
    await expect(guest.page.getByTestId("pins-list")).toContainText("No pinned messages yet.");
    await messageAction(message(owner.page, "Which chapter is on the exam?"), "Pin message");
    await expect(owner.page.getByText("Message pinned.")).toBeVisible();
    await expect(guest.page.getByTestId("pins-list")).toContainText(
      "Which chapter is on the exam?",
    );
    await guest.page.keyboard.press("Escape");
    // Members without Manage Messages get no pin action.
    await message(guest.page, "Chapter four").hover();
    await expect(
      message(guest.page, "Chapter four").getByRole("button", { name: "Pin message" }),
    ).toHaveCount(0);

    await owner.context.close();
    await guest.context.close();
  });

  test("direct messages: open from a profile, unread, notifications, blocking", async ({
    browser,
  }) => {
    test.setTimeout(120_000); // long scenario: slow on a loaded machine
    const owner = await newUser(browser, "dm_owner");
    const guest = await newUser(browser, "dm_guest");
    await sharedServer(owner.page, guest.page, "DM Club");
    await owner.page.goto("/channels/me");
    await realtimeReady(owner.page);

    // Guest opens a DM from the owner's profile card (re-open it if a live refresh closed it).
    await expect(async () => {
      await live(guest.page, "member-list")
        .getByRole("button", { name: new RegExp(owner.user.username) })
        .click();
      await guest.page
        .getByTestId("profile-card")
        .getByRole("button", { name: "Message" })
        .click({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    // First visit compiles the DM route in dev mode: allow extra time.
    await expect(live(guest.page, "channel-title")).toHaveText(owner.user.username, {
      timeout: 30_000,
    });
    await send(guest.page, "psst, homework?");

    // Owner: the DM appears with an unread badge, plus an inbox entry.
    const dm = owner.page.getByTestId("dm-item").filter({ hasText: guest.user.username });
    await expect(dm.getByRole("link")).toHaveAttribute("data-unread", "true");
    await expect(owner.page.getByTestId("inbox-count")).toHaveText("1");
    await dm.getByRole("link").click();
    await expect(live(owner.page, "message-list")).toContainText("psst, homework?");
    await expect(dm.getByRole("link")).toHaveAttribute("data-unread", "false");
    await expect(owner.page.getByTestId("inbox-count")).toHaveCount(0); // reading the DM clears it

    await send(owner.page, "page 42");
    await expect(live(guest.page, "message-list")).toContainText("page 42");

    // The owner blocks the guest: their composer explains why, the guest can't send.
    await owner.page.goto("/channels/me");
    await realtimeReady(owner.page);
    await apiPost(owner.page, "/api/v1/users/me/blocks", {
      user_id: (await (await guest.page.request.get("/api/v1/users/me")).json()).id,
    });
    await dm.getByRole("link").click();
    await expect(live(owner.page, "composer")).toBeDisabled();
    await expect(live(owner.page, "composer")).toHaveAttribute(
      "placeholder",
      /You blocked this user/,
    );
    await send(guest.page, "hello?");
    await expect(message(guest.page, "hello?")).toContainText("Not sent");
    await owner.context.close();
    await guest.context.close();
  });

  test("group DMs", async ({ browser }) => {
    const a = await newUser(browser, "gd_a");
    const b = await newUser(browser, "gd_b");
    const c = await newUser(browser, "gd_c");
    const { serverId } = await sharedServer(a.page, b.page, "Group Base");
    const invite = await apiPost<{ code: string }>(a.page, `/api/v1/servers/${serverId}/invites`);
    await apiPost(c.page, `/api/v1/invites/${invite.code}/accept`);
    await a.page.goto("/channels/me");
    await realtimeReady(a.page);
    await c.page.goto("/channels/me");
    await realtimeReady(c.page);

    await a.page.getByTestId("new-dm").click();
    const dialog = a.page.getByRole("dialog", { name: "New message" });
    for (const other of [b, c]) {
      await dialog.getByLabel("Find people").fill(other.user.username);
      await dialog.getByRole("checkbox", { name: new RegExp(other.user.username) }).click();
    }
    await dialog.getByLabel("Group name").fill("Lab partners");
    await dialog.getByRole("button", { name: "Create group" }).click();
    await expect(live(a.page, "channel-title")).toHaveText("Lab partners");
    await send(a.page, "meet at 3?");

    const group = c.page.getByTestId("dm-item").filter({ hasText: "Lab partners" });
    await expect(group).toContainText("3 members");
    await group.getByRole("link").click();
    await expect(live(c.page, "message-list")).toContainText("meet at 3?");
    await expect(c.page.getByTestId("dm-members")).toContainText(b.user.username);

    // c leaves; a sees the member count drop.
    c.page.once("dialog", (d) => void d.accept());
    await c.page.getByRole("button", { name: "Leave group" }).click();
    await expect(c.page).toHaveURL(/\/channels\/me$/);
    await expect(a.page.getByTestId("dm-item").filter({ hasText: "Lab partners" })).toContainText(
      "2 members",
    );
    for (const user of [a, b, c]) await user.context.close();
  });

  test("search with filters", async ({ browser }) => {
    const owner = await newUser(browser, "sr_owner");
    const guest = await newUser(browser, "sr_guest");
    await sharedServer(owner.page, guest.page, "Searchable");
    await send(owner.page, "photosynthesis happens in chloroplasts");
    await send(guest.page, "photosynthesis needs light");
    await send(guest.page, "unrelated lunch plans");
    await expect(message(owner.page, "unrelated lunch plans")).toBeVisible();

    await live(owner.page, "search-button").click();
    const panel = owner.page.getByTestId("search-panel");
    await panel.getByTestId("search-input").fill("photosynthesis");
    await panel.getByTestId("search-input").press("Enter");
    await expect(panel.getByTestId("search-total")).toHaveText("2 results");
    await panel.getByLabel("From").selectOption({ label: guest.user.username });
    await panel.getByTestId("search-input").press("Enter");
    await expect(panel.getByTestId("search-total")).toHaveText("1 result");
    await expect(panel.getByTestId("search-results")).toContainText("needs light");
    await owner.context.close();
    await guest.context.close();
  });

  test("attachments: image preview with lightbox and a file card (real Cloudinary)", async ({
    browser,
  }) => {
    const owner = await newUser(browser, "at_owner");
    const guest = await newUser(browser, "at_guest");
    const probe = await owner.page.request.post("/api/v1/media/sign", {
      data: { purpose: "attachment", filename: "probe.png", size: 10 },
      headers: {
        "X-CSRFToken":
          (await owner.page.context().cookies()).find((c) => c.name === "csrftoken")?.value ?? "",
      },
    });
    test.skip(probe.status() === 503, "Cloudinary is not configured");
    await sharedServer(owner.page, guest.page, "Files");

    // The input is hidden; take the one inside the visible composer's form.
    const form = live(owner.page, "composer").locator("xpath=ancestor::form");
    await form.getByTestId("file-input").setInputFiles([
      { name: "diagram.png", mimeType: "image/png", buffer: png(64) },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("cell biology notes\n") },
    ]);
    const pending = owner.page.getByTestId("pending-uploads").getByRole("listitem");
    await expect(pending).toHaveCount(2);
    await expect(pending.and(owner.page.locator('[data-status="done"]'))).toHaveCount(2, {
      timeout: 30_000,
    });
    await live(owner.page, "composer").fill("today's material");
    await live(owner.page, "composer").press("Enter");

    const received = message(guest.page, "today's material");
    await expect(received.getByRole("button", { name: "Open image diagram.png" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(received.getByTestId("file-attachment")).toContainText("notes.txt");
    await received.getByRole("button", { name: "Open image diagram.png" }).click();
    // The full-size original comes straight from Cloudinary (first fetch can be slow).
    await expect(guest.page.getByTestId("lightbox").getByRole("img")).toBeVisible({
      timeout: 20_000,
    });
    await guest.page.keyboard.press("Escape");

    // Deleting the message removes the files (from Cloudinary too, via the worker).
    owner.page.once("dialog", (d) => void d.accept());
    await messageAction(message(owner.page, "today's material"), "Delete message");
    await expect(message(guest.page, "today's material")).toHaveCount(0);
    await owner.context.close();
    await guest.context.close();
  });
});

import { expect, test, type Page } from "@playwright/test";

import { signUpAndLogin } from "./helpers";

const live = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

async function createServer(page: Page, name: string) {
  await page.getByTestId("add-server").click();
  await page.getByRole("dialog").getByLabel("Server name").fill(name);
  await page.getByRole("dialog").getByRole("button", { name: "Create server" }).click();
  await expect(live(page, "channel-title")).toHaveText("general");
}

async function inviteLink(page: Page): Promise<string> {
  await page.getByTestId("server-menu").click();
  await page.getByRole("menuitem", { name: "Invite people" }).click();
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.getByTestId("invite-link").inputValue();
  await page.keyboard.press("Escape");
  return new URL(link).pathname;
}

async function openSettings(page: Page) {
  await page.getByTestId("server-menu").click();
  await page.getByRole("menuitem", { name: "Server settings" }).click();
  await expect(page.getByTestId("settings-server-name")).toBeVisible();
}

test("server settings: overview, roles, members, ownership, delete", async ({
  page,
  request,
  browser,
}) => {
  await signUpAndLogin(page, request, "settings");
  await createServer(page, "Settings Lab");
  const invite = await inviteLink(page);

  const friendContext = await browser.newContext();
  const friend = await friendContext.newPage();
  const friendUser = await signUpAndLogin(friend, friend.request, "member");
  await friend.goto(invite);
  await friend.getByRole("button", { name: "Accept invite" }).click();
  await expect(live(friend, "channel-title")).toHaveText("general");
  await friend.getByTestId("server-menu").click();
  await expect(friend.getByRole("menuitem", { name: "Create channel" })).toHaveCount(0);
  await friend.keyboard.press("Escape");

  // Overview: rename.
  await openSettings(page);
  await page.getByLabel("Server name").fill("Settings Lab Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Server updated")).toBeVisible();
  await expect(page.getByTestId("settings-server-name")).toHaveText("Settings Lab Renamed");

  // Roles: create one that can manage channels.
  await page.getByRole("tab", { name: "Roles" }).click();
  await page.getByRole("button", { name: "Create role" }).click();
  const editor = page.getByTestId("role-editor");
  await expect(editor.getByLabel("Role name")).toHaveValue("new role");
  await editor.getByLabel("Role name").fill("Builders");
  await editor.getByRole("checkbox", { name: /Manage channels/i }).click();
  await editor.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByText("Role saved")).toBeVisible();
  await expect(page.getByRole("list", { name: "Roles" })).toContainText("Builders");

  // Members: give the friend the role.
  await page.getByRole("tab", { name: "Members" }).click();
  const row = page.getByTestId("settings-member").filter({ hasText: friendUser.username });
  await row.getByRole("checkbox", { name: "Builders" }).click();
  await expect(row.getByRole("checkbox", { name: "Builders" })).toBeChecked();

  // The friend now has MANAGE_CHANNELS.
  await friend.reload();
  await friend.getByTestId("server-menu").click();
  await expect(friend.getByRole("menuitem", { name: "Create channel" })).toBeVisible();
  await friend.keyboard.press("Escape");

  // Ownership: transfer to the friend, then the friend deletes the server.
  await page.getByRole("tab", { name: "Ownership" }).click();
  await page.getByRole("combobox", { name: "New owner" }).click();
  await page.getByRole("option", { name: friendUser.username }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Transfer" }).click();
  await expect(page.getByText("Ownership transferred")).toBeVisible();

  await friend.reload();
  await openSettings(friend);
  await friend.getByRole("tab", { name: "Ownership" }).click();
  const deleteButton = friend.getByRole("button", { name: "Delete server" });
  await expect(deleteButton).toBeDisabled();
  await friend.getByLabel("Type the server name to confirm").fill("Settings Lab Renamed");
  await deleteButton.click();
  await expect(friend).toHaveURL(/\/channels\/me$/);
  await expect(friend.getByTestId("server-list")).not.toContainText("Settings Lab");
  await friendContext.close();
});

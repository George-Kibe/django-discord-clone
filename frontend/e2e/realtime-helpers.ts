import { expect, type Browser, type Locator, type Page } from "@playwright/test";

import { signUpAndLogin } from "./helpers";

/** Next keeps recently visited pages mounted but hidden (<Activity>); only look at the live one. */
export const live = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true });

async function csrf(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "csrftoken");
  if (cookie) return cookie.value;
  await page.request.get("/api/v1/auth/csrf");
  return (await page.context().cookies()).find((c) => c.name === "csrftoken")?.value ?? "";
}

export async function apiPost<T>(page: Page, path: string, data: unknown = {}): Promise<T> {
  const response = await page.request.post(path, {
    data,
    headers: { "X-CSRFToken": await csrf(page), Origin: new URL(page.url()).origin },
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

export async function newUser(browser: Browser, prefix: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = await signUpAndLogin(page, page.request, prefix);
  return { context, page, user };
}

/** Owner creates a server through the API, the guest joins by invite; both open #general. */
export async function sharedServer(owner: Page, guest: Page, name: string) {
  const server = await apiPost<{ id: string }>(owner, "/api/v1/servers", { name });
  const invite = await apiPost<{ code: string }>(owner, `/api/v1/servers/${server.id}/invites`, {});
  await apiPost(guest, `/api/v1/invites/${invite.code}/accept`);
  const channels = (await (
    await owner.request.get(`/api/v1/servers/${server.id}/channels`)
  ).json()) as { id: string; name: string }[];
  const general = channels.find((c) => c.name === "general")!;
  const url = `/channels/${server.id}/${general.id}`;
  await owner.goto(url);
  await guest.goto(url);
  await expect(live(owner, "channel-title")).toHaveText("general");
  await expect(live(guest, "channel-title")).toHaveText("general");
  return { serverId: server.id, generalId: general.id, url };
}

export async function send(page: Page, text: string) {
  await live(page, "composer").fill(text);
  await live(page, "composer").press("Enter");
}

export function memberRow(page: Page, username: string) {
  return live(page, "member-list")
    .getByTestId("member")
    .filter({ has: page.getByText(username, { exact: true }) });
}

/**
 * Clicks a message's hover-toolbar button. Rows can still settle right after an edit (the
 * virtualiser re-measures asynchronously), so re-hover until the click lands.
 */
export async function messageAction(
  row: Locator,
  name:
    | "Edit message"
    | "Delete message"
    | "Reply"
    | "Add reaction"
    | "Pin message"
    | "Unpin message"
    | "Report message",
) {
  await expect(async () => {
    await row.hover();
    await row.getByRole("toolbar").getByRole("button", { name }).click({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

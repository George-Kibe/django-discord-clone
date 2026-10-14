import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const PASSWORD = "e2e-long-passphrase";

export function uniqueUser(prefix = "e2e") {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { email: `${prefix}.${id}@example.com`, username: `${prefix}_${id}`, password: PASSWORD };
}

type MailpitSearch = { messages: { ID: string; Subject: string }[] };

/** Polls Mailpit for the newest message to `to` with `subject` and returns its first link. */
export async function linkFromEmail(
  request: APIRequestContext,
  to: string,
  subject: string,
): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:"${to}" subject:"${subject}"` },
        });
        const { messages } = (await search.json()) as MailpitSearch;
        if (!messages.length) return null;
        const message = await (
          await request.get(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)
        ).json();
        link = /https?:\/\/\S+/.exec(message.Text as string)?.[0];
        return link ?? null;
      },
      { timeout: 20_000, message: `email "${subject}" to ${to}` },
    )
    .not.toBeNull();
  // Emails link to SITE_URL; keep the path so tests run against any base URL.
  const url = new URL(link!);
  return `${url.pathname}${url.search}`;
}

export async function register(page: Page, user: ReturnType<typeof uniqueUser>) {
  await page.goto("/register");
  // Submit buttons are enabled once React has hydrated; typing earlier can be lost.
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("register-success")).toBeVisible();
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Registers, verifies via the emailed link and signs in. */
export async function signUpAndLogin(page: Page, request: APIRequestContext, prefix = "e2e") {
  const user = uniqueUser(prefix);
  await register(page, user);
  await page.goto(await linkFromEmail(request, user.email, "Verify your email address"));
  await expect(page.getByTestId("verify-success")).toBeVisible();
  await login(page, user.email);
  await expect(page.getByTestId("welcome")).toBeVisible();
  return user;
}

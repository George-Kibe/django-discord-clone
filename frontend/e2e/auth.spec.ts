import { expect, test } from "@playwright/test";

import { linkFromEmail, login, register, signUpAndLogin, uniqueUser } from "./helpers";

test.describe("accounts (Phase 1)", () => {
  test("register → verify → login → profile → logout", async ({ page, request, context }) => {
    const user = uniqueUser();
    await register(page, user);

    // Unverified users can sign in but are nudged to verify.
    await login(page, user.email);
    await expect(page).toHaveURL(/\/channels\/me$/);
    await expect(page.getByTestId("verify-banner")).toBeVisible();

    await page.goto(await linkFromEmail(request, user.email, "Verify your email address"));
    await expect(page.getByTestId("verify-success")).toBeVisible();
    await page.getByRole("link", { name: "Continue to the app" }).click();
    await expect(page.getByTestId("welcome")).toContainText(user.username);
    await expect(page.getByTestId("verify-banner")).toHaveCount(0);

    // Tokens are httpOnly: present in the jar, invisible to page JavaScript (NFR-SEC-03).
    const cookies = await context.cookies();
    const byName = Object.fromEntries(cookies.map((cookie) => [cookie.name, cookie]));
    expect(byName.access.httpOnly).toBe(true);
    expect(byName.refresh.httpOnly).toBe(true);
    expect(byName.refresh.path).toBe("/api/v1/auth");
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain("access=");
    expect(visible).not.toContain("refresh=");

    // The WebSocket gateway authenticates from the same cookie.
    const ready = await page.evaluate(
      () =>
        new Promise<{ type: string; data: { user: { username: string } } }>((resolve, reject) => {
          const socket = new WebSocket(`ws://${location.host}/ws/`);
          socket.onmessage = (event) => {
            resolve(JSON.parse(event.data));
            socket.close();
          };
          socket.onerror = () => reject(new Error("socket error"));
        }),
    );
    expect(ready.type).toBe("ready");
    expect(ready.data.user.username).toBe(user.username);

    // Edit profile.
    await page.goto("/settings/profile");
    await page.getByLabel("Display name").fill("E2E Tester");
    await page.getByLabel("About me").fill("Written by Playwright");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Display name")).toHaveValue("E2E Tester");
    await expect(page.getByLabel("About me")).toHaveValue("Written by Playwright");

    // Log out: cookies cleared and protected pages bounce to login.
    await page.getByTestId("user-menu").last().click();
    await page.getByTestId("logout").click();
    await expect(page).toHaveURL(/\/login$/);
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names).not.toContain("access");
    expect(names).not.toContain("session");
    await page.goto("/settings/profile");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fprofile$/);
  });

  test("wrong password shows a generic error", async ({ page, request }) => {
    const user = await signUpAndLogin(page, request, "wrongpw");
    await page.context().clearCookies();
    await login(page, user.email, "not-the-password");
    await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
  });

  test("register shows server-side validation errors", async ({ page, request }) => {
    const existing = await signUpAndLogin(page, request, "dupe");
    await page.context().clearCookies();
    await page.goto("/register");
    await page.getByLabel("Email").fill(existing.email);
    await page.getByLabel("Username").fill(`${existing.username}x`);
    await page.getByLabel("Password").fill("long-enough-passphrase");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("An account with this email already exists.")).toBeVisible();
  });

  test("expired access token is refreshed silently", async ({ page, request, context }) => {
    await signUpAndLogin(page, request, "refresh");
    // Simulate the 15-minute access cookie expiring.
    await context.clearCookies({ name: "access" });
    await page.goto("/settings/account");
    await expect(page.getByTestId("current-email")).toBeVisible();
    expect((await context.cookies()).map((cookie) => cookie.name)).toContain("access");
  });

  test("password reset", async ({ page, request }) => {
    const user = await signUpAndLogin(page, request, "reset");
    await page.context().clearCookies();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(user.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/we've sent a link/)).toBeVisible();

    await page.goto(await linkFromEmail(request, user.email, "Reset your password"));
    await page.getByLabel("New password", { exact: true }).fill("brand-new-passphrase");
    await page.getByLabel("Confirm new password").fill("brand-new-passphrase");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByTestId("reset-success")).toBeVisible();

    await login(page, user.email, "brand-new-passphrase");
    await expect(page.getByTestId("welcome")).toBeVisible();
  });

  test("change email and password from account settings", async ({ page, request }) => {
    const user = await signUpAndLogin(page, request, "acct");
    const newEmail = uniqueUser("moved").email;

    await page.goto("/settings/account");
    await page.getByLabel("New email").fill(newEmail);
    await page.getByLabel("Current password").first().fill(user.password);
    await page.getByRole("button", { name: "Change email" }).click();
    await expect(page.getByText(/We sent a confirmation link/)).toBeVisible();
    await page.goto(await linkFromEmail(request, newEmail, "Confirm your new email address"));
    await expect(page.getByTestId("verify-success")).toBeVisible();
    await page.goto("/settings/account");
    await expect(page.getByTestId("current-email")).toContainText(newEmail);

    await page.getByLabel("Current password").last().fill(user.password);
    await page.getByLabel("New password", { exact: true }).fill("changed-passphrase-1");
    await page.getByLabel("Confirm new password").fill("changed-passphrase-1");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/Password changed/)).toBeVisible();
    // This session stays signed in.
    await page.reload();
    await expect(page.getByTestId("current-email")).toContainText(newEmail);
  });

  test("signed-in users skip the login page", async ({ page, request }) => {
    await signUpAndLogin(page, request, "skip");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/channels\/me$/);
    // The sidebar's Settings link lands on profile settings.
    await page.getByRole("navigation", { name: "Home" }).getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
  });
});

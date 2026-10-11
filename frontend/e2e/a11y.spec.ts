import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signUpAndLogin } from "./helpers";

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

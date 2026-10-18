import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { caseIdOf, stamp } from "./helpers";
import { linkIn, waitForEmail } from "./outbox";

/**
 * Sign-in opens the organization used most recently. Tests that leave a demo
 * clinician in another organization switch back, so later specs find them in Riverside.
 */
async function backToRiverside(page: Page) {
  await page.getByRole("button", { name: "Switch organization" }).click();
  await page.getByRole("menuitem", { name: /Riverside Cancer Center/ }).click();
  await expect(page.getByRole("button", { name: "Switch organization" })).toContainText("Riverside Cancer Center");
}

test("switching organizations changes everything you see, and anyone can start another organization", async ({ signIn }) => {
  const nguyen = await signIn("nguyen@riverside.demo");

  await nguyen.getByRole("button", { name: "Switch organization" }).click();
  await nguyen.getByRole("menuitem", { name: /Lakeside Community Hospital/ }).click();
  await expect(nguyen.getByRole("button", { name: "Switch organization" })).toContainText("Lakeside Community Hospital");
  await nguyen.goto("/cases");
  await expect(nguyen.getByRole("link", { name: /John Carter/ })).toHaveCount(0);
  // A link to a Riverside case offers to switch instead of a bare 404.
  await nguyen.goto(`/cases/${await caseIdOf("Carter")}`);
  await expect(nguyen.getByRole("heading", { name: /Open in Riverside Cancer Center/ })).toBeVisible();
  await nguyen.getByRole("button", { name: /Switch to Riverside/ }).click();
  await expect(nguyen.getByRole("heading", { name: "John Carter", level: 1 })).toBeVisible();

  const name = `Northside Synthetic Clinic ${stamp()}`;
  await nguyen.getByRole("button", { name: "Switch organization" }).click();
  await nguyen.getByRole("menuitem", { name: "Create organization" }).click();
  await nguyen.getByRole("dialog").getByLabel("Organization name").fill(name);
  await nguyen.getByRole("dialog").getByRole("button", { name: "Create organization" }).click();
  await expect(nguyen).toHaveURL(/\/team/);
  await expect(nguyen.getByRole("button", { name: "Switch organization" })).toContainText(name);
  await expect(nguyen.getByRole("button", { name: "Switch organization" })).toContainText("3 orgs");
  await backToRiverside(nguyen);
});

test("an existing account joins another organization through an emailed invitation", async ({ signIn }) => {
  const admin = await signIn("admin@lakeside.demo");
  await admin.goto("/team");
  await admin.getByLabel("Email").fill("smith@riverside.demo");
  await admin.getByLabel("Role", { exact: true }).selectOption({ label: "Specialist" });
  await admin.getByRole("button", { name: "Create invitation" }).click();
  await expect(admin.getByText("Invitation emailed to smith@riverside.demo").first()).toBeVisible();

  const invitation = await waitForEmail("smith@riverside.demo", /invited you to Lakeside/);
  const smith = await signIn("smith@riverside.demo");
  await smith.goto(linkIn(invitation, "/invite/"));
  await smith.getByRole("button", { name: /Join Lakeside Community Hospital/ }).click();
  await expect(smith).toHaveURL(/\/dashboard/);
  await expect(smith.getByRole("button", { name: "Switch organization" })).toContainText("Lakeside Community Hospital");
  await expect(smith.getByRole("button", { name: "Switch organization" })).toContainText("2 orgs");
  await backToRiverside(smith);
});

test("an admin changes a member's role, which changes what that member can do", async ({ signIn }) => {
  const kim = await caseIdOf("Kim");
  const admin = await signIn("admin@riverside.demo");
  await admin.goto("/team");
  const role = admin.getByLabel("Role of Dr. James O'Brien");
  try {
    await role.selectOption("NURSE");
    await expect(admin.getByText("Role changed to Nurse")).toBeVisible();

    // As a nurse, Dr. O'Brien can no longer propose decisions.
    const obrien = await signIn("obrien@riverside.demo");
    await obrien.goto(`/cases/${kim}`);
    await expect(obrien.getByRole("heading", { name: "Robert Kim", level: 1 })).toBeVisible();
    await expect(obrien.getByRole("button", { name: "Create decision" })).toHaveCount(0);

    await admin.goto("/settings/audit");
    await expect(admin.getByText(/changed Dr\. James O'Brien's role to NURSE/).first()).toBeVisible();
  } finally {
    await admin.goto("/team");
    await admin.getByLabel("Role of Dr. James O'Brien").selectOption("SPECIALIST");
    await expect(admin.getByText("Role changed to Specialist")).toBeVisible();
  }
});

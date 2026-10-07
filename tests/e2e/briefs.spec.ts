import { expect, test } from "./fixtures";
import { caseIdOf } from "./helpers";

test.describe("AI drafts that clinicians approve", () => {
  test("a tumor board brief is an AI draft until a physician approves the version they read", async ({ signIn }) => {
    const kim = await caseIdOf("Kim");
    const author = await signIn("nguyen@riverside.demo");
    await author.goto(`/cases/${kim}/tumor-board`);
    await author.getByRole("button", { name: "Prepare tumor board" }).click();
    await expect(author.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 60_000 });
    await expect(author.getByText(/Review every section against the sources/)).toBeVisible();

    await author.getByRole("button", { name: "Edit" }).click();
    const firstSection = author.locator("textarea").first();
    await firstSection.fill(`${await firstSection.inputValue()}\nClinician addition from the e2e test.`);
    await author.getByRole("button", { name: "Save edits" }).click();
    await expect(author.getByText("Edits saved")).toBeVisible();

    const approver = await signIn("lee@riverside.demo");
    await approver.goto(`/cases/${kim}/tumor-board`);
    await expect(approver.getByText("Clinician addition from the e2e test.")).toBeVisible();
    await approver.getByRole("button", { name: "Approve & share" }).click();
    await expect(approver.getByText("Brief approved and shared with the care team")).toBeVisible();
    await expect(approver.getByText(/approved by/)).toBeVisible();
  });

  test("a nurse generates a shift handoff and it becomes final only on approval", async ({ signIn }) => {
    const carter = await caseIdOf("Carter");
    const nurse = await signIn("adams@riverside.demo");
    await nurse.goto(`/cases/${carter}/handoff`);
    await nurse.getByRole("button", { name: /Generate (new )?handoff/ }).first().click();
    await expect(nurse.getByText(/Review every section against the sources/)).toBeVisible({ timeout: 60_000 });
    await nurse.getByRole("button", { name: "Approve handoff" }).click();
    await expect(nurse.getByText("Handoff approved: it is now final")).toBeVisible();
  });
});

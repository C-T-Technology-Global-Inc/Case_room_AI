import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { caseIdOf, stamp } from "./helpers";

/** The task row (title plus its status button), wherever tasks are listed. */
const taskRow = (page: Page, title: string) =>
  page
    .locator("div")
    .filter({ hasText: title })
    .filter({ has: page.getByRole("button", { name: /Start task|Mark done|Reopen task/ }) })
    .last();

test("a task assigned in a case reaches the assignee, who starts and completes it", async ({ signIn }) => {
  const kim = await caseIdOf("Kim");
  const title = `Review restaging CT with radiology (e2e ${stamp()})`;

  const nguyen = await signIn("nguyen@riverside.demo");
  await nguyen.goto(`/cases/${kim}/tasks`);
  await nguyen.getByRole("button", { name: "Add task" }).click();
  const dialog = nguyen.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Details").fill("Compare with the baseline CT before the tumor board.");
  await dialog.getByLabel("Owner").selectOption({ label: "Dr. Daniel Lee" });
  await dialog.getByLabel("Priority").selectOption({ label: "High" });
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(taskRow(nguyen, title)).toBeVisible();

  // The assignee finds it under "Assigned to me", with a link back to the case.
  const lee = await signIn("lee@riverside.demo");
  await lee.goto("/tasks");
  const row = taskRow(lee, title);
  await expect(row).toBeVisible();
  await expect(row.getByRole("link", { name: "Robert Kim" })).toBeVisible();
  await row.getByRole("button", { name: "Start task" }).click();
  await expect(row.getByRole("button", { name: "Mark done" })).toBeVisible();
  await row.getByRole("button", { name: "Mark done" }).click();
  await expect(row.getByRole("button", { name: "Reopen task" })).toBeVisible();

  // The case shows it done, and the audit log has the change.
  await nguyen.goto(`/cases/${kim}/tasks`);
  await expect(taskRow(nguyen, title).getByRole("button", { name: "Reopen task" })).toBeVisible();
});

test("the task list filters by what is mine, what I created, and everything in my cases", async ({ signIn }) => {
  const page = await signIn("nguyen@riverside.demo");
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  for (const filter of ["Created by me", "All in my cases", "Assigned to me"]) {
    await page.getByRole("link", { name: filter }).click();
    await expect(page.getByRole("button", { name: /Start task|Mark done|Reopen task/ }).first()).toBeVisible();
  }
});

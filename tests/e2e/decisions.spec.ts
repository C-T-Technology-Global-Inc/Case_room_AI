import { expect, test } from "./fixtures";
import { caseIdOf, queryOne, waitForRealtime } from "./helpers";

test.describe("human approval of decisions", () => {
  test("the last required approval makes the decision final, live for the proposer", async ({ signIn }) => {
    const carter = await caseIdOf("Carter");
    const proposer = await signIn("nguyen@riverside.demo");
    await proposer.goto(`/cases/${carter}/decisions`);
    await waitForRealtime(proposer);
    await expect(proposer.getByText("Final human-approved decision")).toHaveCount(0);

    // Two of three reviewers approved in the seed; Dr. Smith is the last one.
    const reviewer = await signIn("smith@riverside.demo");
    await reviewer.goto(`/cases/${carter}/decisions`);
    await reviewer.getByRole("button", { name: "Approve", exact: true }).click();
    await reviewer.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(reviewer.getByText(/is now the final human-approved decision/)).toBeVisible();

    await expect(proposer.getByText(/Final human-approved decision/)).toBeVisible();
  });

  test("a reviewer cannot approve a revision they have not read", async ({ signIn }) => {
    const kim = await caseIdOf("Kim");
    const reviewer = await signIn("lee@riverside.demo");
    await reviewer.goto(`/cases/${kim}/decisions`);
    await reviewer.getByRole("button", { name: "Approve", exact: true }).click();
    const dialog = reviewer.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Meanwhile the proposer revises the decision.
    const proposer = await signIn("nguyen@riverside.demo");
    await proposer.goto(`/cases/${kim}/decisions`);
    await proposer.getByRole("button", { name: "Revise" }).click();
    const title = proposer.locator("#decision-title");
    await title.fill(`${await title.inputValue()} (revised in e2e)`);
    await proposer.getByRole("button", { name: "Save revision" }).click();
    await expect(proposer.getByText("Decision revised; reviews reset to pending")).toBeVisible();

    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(dialog.getByText(/revised after you opened it/)).toBeVisible();
  });

  test("two clinicians proposing at the same moment get two distinct decision numbers", async ({ signIn }) => {
    const carter = await caseIdOf("Carter");
    const before = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM "Decision" WHERE "caseRoomId" = $1`, [carter]);
    const proposers = await Promise.all(["nguyen@riverside.demo", "smith@riverside.demo"].map((email) => signIn(email)));
    for (const [index, page] of proposers.entries()) {
      await page.goto(`/cases/${carter}/decisions`);
      await page.getByRole("button", { name: "Create decision" }).first().click();
      await page.locator("#decision-title").fill(`Concurrent synthetic proposal ${index + 1}`);
      await page.locator("#decision-description").fill("Synthetic proposal created at the same moment as another one.");
      await page.locator("#decision-rationale").fill("End-to-end test of concurrent decision numbering.");
    }
    await Promise.all(proposers.map((page) => page.getByRole("button", { name: "Propose decision" }).click()));
    for (const page of proposers) await expect(page.getByText("Decision proposed for review")).toBeVisible();

    const rows = await queryOne<{ n: number; numbers: number[] }>(
      `SELECT count(*)::int AS n, array_agg(number ORDER BY number) AS numbers FROM "Decision" WHERE "caseRoomId" = $1`,
      [carter],
    );
    expect(rows.n).toBe(before.n + 2);
    expect(new Set(rows.numbers).size).toBe(rows.numbers.length);
  });
});

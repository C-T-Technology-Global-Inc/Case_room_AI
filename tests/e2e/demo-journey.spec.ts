import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { caseIdOf, messages, reseedDemoData, stamp, waitForRealtime } from "./helpers";

/**
 * The five-minute demo (docs/DEMO_SCRIPT.md), step by step, in two browsers:
 * Dr. Nguyen (medical oncology) and Dr. Smith (surgical oncology) on the
 * John Carter case. If this test passes, the demo can be given live.
 */

// Earlier specs approve decisions and post messages: start from the seeded demo.
test.beforeAll(() => reseedDemoData());

const aiMessages = (page: Page) => messages(page).filter({ hasText: "AI Generated" });

async function ask(page: Page, question: string) {
  const composer = page.getByPlaceholder(/Message the care team/);
  await composer.fill(question);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("the five-minute demo works end to end, live in two browsers", async ({ signIn }) => {
  test.setTimeout(180_000);
  const carter = await caseIdOf("Carter");
  const nguyen = await signIn("nguyen@riverside.demo");
  const smith = await signIn("smith@riverside.demo");

  await test.step("1. One patient: the header and who is viewing", async () => {
    for (const page of [nguyen, smith]) {
      await page.goto(`/cases/${carter}`);
      await waitForRealtime(page);
    }
    await expect(nguyen.getByRole("heading", { name: "John Carter", level: 1 })).toBeVisible();
    await expect(nguyen.getByText(/Synthetic patient/).first()).toBeVisible();
    await expect(nguyen.getByRole("button", { name: "Decision pending" })).toBeVisible();
    // Dr. Smith's presence shows in Dr. Nguyen's window.
    await expect(nguyen.getByRole("button", { name: /ES online/ })).toBeVisible();
  });

  await test.step("2. Everything the team knows: AI summary with sources, memory, timeline", async () => {
    const summary = nguyen.getByRole("article").filter({ has: nguyen.getByRole("heading", { name: "Case summary" }) });
    await expect(summary.getByText("AI Generated")).toBeVisible();
    await expect(summary.getByText("Draft", { exact: true })).toBeVisible();
    await expect(nguyen.getByRole("heading", { name: "Missing information" })).toBeVisible();
    await expect(nguyen.getByRole("heading", { name: "Shared patient memory" })).toBeVisible();

    // A source chip opens its excerpt, then the source document itself.
    await summary.getByRole("button", { name: /Surgical pathology: pancreatic head biopsy/ }).first().click();
    await nguyen.getByRole("link", { name: "Open source" }).click();
    await expect(nguyen).toHaveURL(/\/documents\?doc=/);
    await expect(nguyen.getByRole("dialog").getByText(/adenocarcinoma/i).first()).toBeVisible();
    await nguyen.keyboard.press("Escape");

    await nguyen.getByRole("link", { name: /^Timeline/ }).click();
    await expect(nguyen.getByRole("heading", { name: "Patient timeline" })).toBeVisible();
    await nguyen.getByRole("link", { name: "Pathology", exact: true }).click();
    await expect(nguyen).toHaveURL(/type=PATHOLOGY/);
    await expect(nguyen.getByRole("link", { name: /Surgical pathology/ }).first()).toBeVisible();
    await expect(nguyen.getByRole("link", { name: /CT Abdomen\/Pelvis/ })).toHaveCount(0);
  });

  await test.step("3. Collaboration: typing indicator and a live @AI answer in both windows", async () => {
    for (const page of [nguyen, smith]) {
      await page.goto(`/cases/${carter}/discussion`);
      await waitForRealtime(page);
    }
    const before = await aiMessages(smith).count();
    const composer = nguyen.getByPlaceholder(/Message the care team/);
    await composer.pressSequentially("@AI compare the pathology with the latest CT", { delay: 15 });
    await expect(smith.getByText(/Nguyen is typing…/)).toBeVisible();
    await nguyen.getByRole("button", { name: "Send message" }).click();

    await expect(aiMessages(smith)).toHaveCount(before + 1, { timeout: 30_000 });
    await expect(aiMessages(nguyen)).toHaveCount(before + 1);
    const answer = aiMessages(smith).last();
    await expect(answer.getByText(/confidence/i)).toBeVisible();
    // Numbered sources; opening one shows its excerpt and a link to the record.
    const source = answer.getByRole("button", { name: /^1 / }).first();
    await expect(source).toBeVisible();
    await source.click();
    await expect(smith.getByRole("link", { name: "Open source" })).toBeVisible();
    await smith.keyboard.press("Escape");
  });

  await test.step("4. The AI says when the record cannot answer, instead of inventing", async () => {
    const before = await aiMessages(nguyen).count();
    await ask(nguyen, `@AI what did the liver transplant evaluation conclude? (${stamp()})`);
    await expect(aiMessages(nguyen)).toHaveCount(before + 1, { timeout: 30_000 });
    const answer = aiMessages(nguyen).last();
    await expect(answer).toContainText("Insufficient information");
    await expect(answer).toContainText(/could not find information in the case record/);
    await expect(answer.getByRole("button", { name: /^1 / })).toHaveCount(0);
  });

  await test.step("5–6. The last reviewer approves; the proposer sees the final decision live", async () => {
    await nguyen.goto(`/cases/${carter}/decisions`);
    await waitForRealtime(nguyen);
    await expect(nguyen.getByText("Approvals · 2 of 3")).toBeVisible();
    await expect(nguyen.getByText("Final human-approved decision")).toHaveCount(0);

    await smith.goto(`/cases/${carter}/decisions`);
    await smith.getByRole("button", { name: "Approve", exact: true }).click();
    const dialog = smith.getByRole("dialog");
    await dialog.getByRole("textbox").first().fill("Agree: neoadjuvant first, then surgical re-evaluation.");
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(smith.getByText(/is now the final human-approved decision/)).toBeVisible();

    await expect(nguyen.getByText(/Final human-approved decision/)).toBeVisible();
    await expect(nguyen.getByRole("button", { name: "Reviewing" })).toBeVisible();
  });

  await test.step("6b. AI-suggested follow-up tasks are created only after the physician confirms", async () => {
    await nguyen.getByRole("button", { name: "Suggest follow-up tasks" }).click();
    const dialog = nguyen.getByRole("dialog");
    await expect(dialog.getByText(/AI-suggested follow-up for Decision #1/)).toBeVisible();
    const create = dialog.getByRole("button", { name: /^Create \d+ tasks?$/ });
    await expect(create).toBeEnabled();
    const created = Number((await create.textContent())!.match(/\d+/)![0]);
    expect(created).toBeGreaterThan(0);
    await create.click();
    await expect(nguyen.getByText(/follow-up tasks? created/)).toBeVisible();

    await nguyen.goto(`/cases/${carter}/tasks`);
    await expect(nguyen.getByText("AI-suggested")).toHaveCount(created);
  });

  await test.step("7. The audit log records what happened", async () => {
    await nguyen.goto(`/cases/${carter}/audit`);
    await expect(nguyen.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await expect(nguyen.getByText(/Dr\. Smith approved Decision #1/).first()).toBeVisible();
    await expect(nguyen.getByText(/Dr\. Nguyen asked the AI/).first()).toBeVisible();
    // The audit filter (the case tabs also have a "Decisions" link).
    await nguyen.locator('a[href*="/audit?filter=decision"]').click();
    await expect(nguyen).toHaveURL(/filter=decision/);
    await expect(nguyen.getByText(/Decision #1 was recorded as the final human-approved decision/).first()).toBeVisible();
  });
});

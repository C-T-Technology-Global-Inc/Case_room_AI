import { expect, test } from "./fixtures";
import { caseIdOf, messages, waitForRealtime } from "./helpers";

test("an @AI question and its sourced answer appear live for the rest of the care team", async ({ signIn }) => {
  const carter = await caseIdOf("Carter");
  const asker = await signIn("nguyen@riverside.demo");
  const colleague = await signIn("smith@riverside.demo");
  for (const page of [asker, colleague]) {
    await page.goto(`/cases/${carter}/discussion`);
    await waitForRealtime(page);
  }

  const question = `@AI What does the CT show about the SMA? (e2e ${Date.now()})`;
  await asker.getByPlaceholder(/Message the care team/).fill(question);
  await asker.getByRole("button", { name: "Send message" }).click();

  // The colleague did not reload: the question and the AI answer arrive over realtime.
  const questionText = question.replace("@AI ", "");
  await expect(messages(colleague).filter({ hasText: questionText }).first()).toBeVisible();
  const answer = messages(colleague).filter({ hasText: "AI Generated" }).last();
  await expect(answer).toBeVisible({ timeout: 30_000 });
  await expect(messages(colleague).last()).toContainText("AI Generated");
  // Every answer cites case records: at least one numbered source chip.
  await expect(messages(colleague).last().getByRole("button").filter({ hasText: /^1/ }).first()).toBeVisible();
});

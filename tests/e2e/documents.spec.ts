import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { caseIdOf, stamp } from "./helpers";

/** Upload a document through the dialog and return to the documents list. */
async function openUpload(page: Page) {
  await page.getByRole("button", { name: "Upload document" }).first().click();
  return page.getByRole("dialog");
}

/** Open the document from the list and wait until the AI has processed it (reloading, since processing runs after the response). */
async function openProcessed(page: Page, caseId: string, title: string) {
  await expect
    .poll(
      async () => {
        await page.goto(`/cases/${caseId}/documents`);
        await page.getByRole("link", { name: new RegExp(title.replace(/[()]/g, "\\$&")) }).click();
        const sheet = page.getByRole("dialog");
        // Wait for the document sheet itself before reading its status.
        await expect(sheet.getByRole("heading", { name: title })).toBeVisible();
        return sheet.getByText("AI processed").isVisible();
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  return page.getByRole("dialog");
}

const memorySize = async (page: Page) => Number((await page.getByText(/Built from \d+ documents/).first().textContent())!.match(/(\d+) documents/)![1]);

test("a pasted report is processed by the AI into the timeline and the shared patient memory", async ({ signIn }) => {
  const kim = await caseIdOf("Kim");
  const page = await signIn("nguyen@riverside.demo");
  await page.goto(`/cases/${kim}`);
  const documentsBefore = await memorySize(page);

  const title = `Restaging CT chest (e2e ${stamp()})`;
  const dialog = await openUpload(page);
  await dialog.getByRole("button", { name: "Paste text" }).click();
  await dialog.getByLabel("Report text").fill(
    [
      "CT CHEST WITH CONTRAST",
      "Date of exam: 2026-10-12",
      "FINDINGS: The right upper lobe mass measures 3.1 cm, previously 4.2 cm. No new pulmonary nodules. No pleural effusion.",
      "IMPRESSION: Partial response of the right upper lobe adenocarcinoma. No evidence of new metastatic disease.",
    ].join("\n"),
  );
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Type").selectOption({ label: "Imaging report" });
  await dialog.getByRole("button", { name: "Add to case" }).click();
  await expect(page.getByText(/characters extracted/)).toBeVisible();

  const sheet = await openProcessed(page, kim, title);
  await expect(sheet.getByText(/Partial response of the right upper lobe adenocarcinoma/)).toBeVisible();
  await expect(sheet.getByText(/AI extracted \d+ timeline events? from this document/)).toBeVisible();

  await page.goto(`/cases/${kim}`);
  expect(await memorySize(page)).toBe(documentsBefore + 1);
  await page.goto(`/cases/${kim}/audit`);
  await expect(page.getByText(new RegExp(`uploaded an imaging report “${title.replace(/[()]/g, "\\$&")}”`)).first()).toBeVisible();
});

test("an uploaded PDF keeps its original, which downloads byte for byte", async ({ signIn }) => {
  const kim = await caseIdOf("Kim");
  const page = await signIn("nguyen@riverside.demo");
  await page.goto(`/cases/${kim}/documents`);
  const fixture = path.resolve(process.cwd(), "scripts/fixtures/synthetic-report.pdf");

  const title = `Synthetic PDF report (e2e ${stamp()})`;
  const dialog = await openUpload(page);
  await dialog.locator('input[type="file"]').setInputFiles(fixture);
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Type").selectOption({ label: "Clinical note" });
  await dialog.getByRole("button", { name: "Add to case" }).click();
  await expect(page.getByText(/characters extracted/)).toBeVisible();

  const sheet = await openProcessed(page, kim, title);
  const href = await sheet.getByRole("link", { name: "Original file" }).getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  expect(sha(await download.body())).toBe(sha(await readFile(fixture)));
});

test("files the app cannot read are refused with a clear message", async ({ signIn }) => {
  const kim = await caseIdOf("Kim");
  const page = await signIn("nguyen@riverside.demo");
  await page.goto(`/cases/${kim}/documents`);
  const dialog = await openUpload(page);
  // A 1×1 PNG: images are not interpreted.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "chest-xray.png", mimeType: "image/png", buffer: png });
  await dialog.getByLabel("Title").fill(`Image upload (e2e ${stamp()})`);
  await dialog.getByRole("button", { name: "Add to case" }).click();
  await expect(page.getByText(/Medical images are not interpreted|Upload a PDF or plain-text report/).first()).toBeVisible();
});

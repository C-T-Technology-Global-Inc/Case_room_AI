import { expect, test } from "./fixtures";
import { stamp } from "./helpers";

test("a new case room is created with its care team, found by search, and managed from its header", async ({ signIn }) => {
  test.setTimeout(120_000);
  const lastName = `Lopez${stamp()}`;
  const diagnosis = `Hepatocellular carcinoma (synthetic ${lastName})`;

  const nguyen = await signIn("nguyen@riverside.demo");
  await nguyen.goto("/cases/new");
  await nguyen.getByLabel("First name").fill("Ana");
  await nguyen.getByLabel("Last name").fill(lastName);
  await nguyen.getByLabel("Date of birth").fill("1965-04-12");
  await nguyen.getByLabel("Sex").selectOption({ label: "Female" });
  await nguyen.getByLabel("Primary diagnosis").fill(diagnosis);
  await nguyen.getByLabel("Case title").fill("HCC: liver-directed therapy planning");
  await nguyen.getByLabel("Specialty").selectOption({ label: "Oncology · Tumor Board" });
  await nguyen.getByRole("checkbox", { name: /Dr\. Emily Smith/ }).click();
  await nguyen.getByRole("checkbox", { name: /Dr\. Priya Patel/ }).click();
  const create = nguyen.getByRole("button", { name: "Create case room" });
  await expect(create).toBeDisabled(); // until the synthetic-data confirmation is ticked
  await nguyen.getByRole("checkbox", { name: /This is a synthetic demo patient/ }).click();
  await create.click();

  await expect(nguyen.getByRole("heading", { name: `Ana ${lastName}`, level: 1 })).toBeVisible();
  // A new case opens on its Documents tab, ready for the first upload.
  const caseUrl = nguyen.url().match(/^.*\/cases\/[^/?#]+/)![0];
  await expect(nguyen.getByRole("heading", { name: "Care team · 3" })).toBeVisible();

  // Search by diagnosis finds it; nonsense finds nothing.
  await nguyen.goto("/cases");
  await nguyen.getByRole("textbox", { name: "Search patient, MRN or diagnosis" }).fill(lastName);
  await nguyen.keyboard.press("Enter");
  await expect(nguyen).toHaveURL(new RegExp(`q=${lastName}`));
  await expect(nguyen.getByRole("link", { name: new RegExp(`Ana ${lastName}`) })).toBeVisible();
  await expect(nguyen.getByRole("link", { name: /John Carter/ })).toHaveCount(0);

  // Status from the header.
  await nguyen.goto(caseUrl);
  await nguyen.getByRole("button", { name: "Open", exact: true }).click();
  await nguyen.getByRole("menuitem", { name: "Reviewing" }).click();
  await expect(nguyen.getByRole("button", { name: "Reviewing" })).toBeVisible();

  // Care team members can open it; others in the organization cannot.
  const smith = await signIn("smith@riverside.demo");
  await smith.goto(caseUrl);
  await expect(smith.getByRole("heading", { name: `Ana ${lastName}`, level: 1 })).toBeVisible();
  const lee = await signIn("lee@riverside.demo");
  const denied = await lee.goto(caseUrl);
  expect(denied?.status()).toBe(404);

  // Inviting a specialist gives access.
  await nguyen.getByRole("banner").getByRole("button", { name: "Invite specialist" }).click();
  const invite = nguyen.getByRole("dialog");
  await invite.getByText("Dr. Daniel Lee").click();
  await invite.getByRole("button", { name: "Add to care team" }).click();
  await expect(nguyen.getByRole("heading", { name: "Care team · 4" })).toBeVisible();
  await lee.goto(caseUrl);
  await expect(lee.getByRole("heading", { name: `Ana ${lastName}`, level: 1 })).toBeVisible();

  // A manual timeline event.
  await nguyen.goto(`${caseUrl}/timeline`);
  await nguyen.getByRole("button", { name: "Add event" }).click();
  const event = nguyen.getByRole("dialog");
  await event.getByLabel("Title").fill("Multiphase liver MRI (e2e)");
  await event.getByLabel("Type").selectOption({ label: "Imaging" });
  await event.getByLabel("Description").fill("LI-RADS 5 lesion, 3.8 cm, segment VIII.");
  await event.getByRole("button", { name: "Add event" }).click();
  await expect(nguyen.getByText("Multiphase liver MRI (e2e)")).toBeVisible();

  // The audit log has the creation and the additions.
  await nguyen.goto(`${caseUrl}/audit`);
  await expect(nguyen.getByText(/opened case room/).first()).toBeVisible();
  await expect(nguyen.getByText(/added Dr\. Lee to the care team/).first()).toBeVisible();
});

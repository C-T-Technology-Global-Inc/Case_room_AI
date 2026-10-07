import { expect, test } from "./fixtures";
import { caseIdOf, queryOne } from "./helpers";

test.describe("case access", () => {
  test("a care-team member sees the case; others get a 404 that does not reveal the patient", async ({ signIn }) => {
    const carter = await caseIdOf("Carter");

    const member = await signIn("nguyen@riverside.demo");
    await member.goto(`/cases/${carter}`);
    await expect(member).toHaveTitle(/John Carter/);

    // Same organization, not on the care team.
    const outsider = await signIn("brooks@riverside.demo");
    const page = await outsider.goto(`/cases/${carter}`);
    expect(page?.status()).toBe(404);
    await expect(outsider).not.toHaveTitle(/Carter/);
    expect((await outsider.request.get(`/api/cases/${carter}/messages`)).status()).toBe(404);

    // Another organization.
    const otherOrganization = await signIn("admin@lakeside.demo");
    expect((await otherOrganization.goto(`/cases/${carter}`))?.status()).toBe(404);
    expect((await otherOrganization.request.get(`/api/cases/${carter}/events`)).status()).toBe(404);
  });

  test("document downloads follow the same access rules", async ({ signIn }) => {
    const carter = await caseIdOf("Carter");
    const { id } = await queryOne<{ id: string }>(`SELECT id FROM "ClinicalDocument" WHERE "caseRoomId" = $1 ORDER BY "documentDate" LIMIT 1`, [carter]);
    const url = `/api/cases/${carter}/documents/${id}/file`;

    const member = await signIn("nguyen@riverside.demo");
    const allowed = await member.request.get(url);
    expect(allowed.status()).toBe(200);
    expect((await allowed.body()).length).toBeGreaterThan(20);

    // Not on the care team, and another organization: same 404, no content.
    for (const email of ["brooks@riverside.demo", "admin@lakeside.demo"]) {
      const page = await signIn(email);
      const denied = await page.request.get(url);
      expect(denied.status()).toBe(404);
      expect(await denied.text()).not.toMatch(/Carter|CA 19-9|pancrea/i);
    }

    // A document id from this case under another case's URL is not served either.
    const kim = await caseIdOf("Kim");
    expect((await member.request.get(`/api/cases/${kim}/documents/${id}/file`)).status()).toBe(404);
  });
});

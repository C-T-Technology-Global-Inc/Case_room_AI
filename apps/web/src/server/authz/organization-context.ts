import type { SessionUser } from "../auth/session";
import { ConflictError } from "../errors";

/**
 * Organization-level writes (new case, invitation) carry the organization the
 * form was opened in. The active organization is per browser, so another tab
 * may have switched it meanwhile; refuse instead of writing into the wrong
 * organization.
 */
export function assertFormOrganization(user: SessionUser, formOrganizationId: string) {
  if (user.organizationId !== formOrganizationId) {
    throw new ConflictError("Your active organization changed in another tab. Reload this page before submitting.");
  }
}

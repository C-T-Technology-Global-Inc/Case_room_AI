import "server-only";
import { requireUser } from "./auth/session";
import { requireCaseForPage } from "./authz/case-access";

/**
 * Entry point for every page under /cases/[caseId]: authenticates the user and
 * renders the 404 page if the case does not exist or is outside their care teams.
 */
export async function loadCasePage(params: Promise<{ caseId: string }>) {
  const { caseId } = await params;
  const user = await requireUser();
  const room = await requireCaseForPage(user, caseId);
  return { user, caseId, room };
}

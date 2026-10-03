import { DiscussionView } from "@/components/discussion/discussion-view";
import { loadCasePage } from "@/server/case-page";
import { listMessages } from "@/server/services/messages";

export default async function DiscussionPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { user, caseId } = await loadCasePage(params);
  const messages = await listMessages(user, caseId);
  return <DiscussionView initialMessages={messages} />;
}

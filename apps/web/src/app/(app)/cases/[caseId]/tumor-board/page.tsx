import { BriefPage } from "@/components/briefs/brief-page";
import { loadCasePage } from "@/server/case-page";

export default async function TumorBoardPage({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<{ brief?: string }> }) {
  const { user, caseId } = await loadCasePage(params);
  const { brief } = await searchParams;
  return <BriefPage user={user} caseId={caseId} type="TUMOR_BOARD" selectedId={brief} />;
}

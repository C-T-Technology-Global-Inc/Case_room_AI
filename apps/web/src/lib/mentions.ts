const MENTION = /@([A-Za-z][A-Za-z0-9_]{0,40})/g;

/**
 * Extract mentions from a discussion message: "@AI" asks the case assistant,
 * "@Handle" notifies a care-team member (matched case-insensitively).
 * Unknown handles are ignored.
 */
export function parseMentions(content: string, members: Array<{ id: string; handle: string }>) {
  let mentionsAI = false;
  const userIds = new Set<string>();
  for (const match of content.matchAll(MENTION)) {
    const handle = match[1]!.toLowerCase();
    if (handle === "ai") {
      mentionsAI = true;
      continue;
    }
    const member = members.find((m) => m.handle.toLowerCase() === handle);
    if (member) userIds.add(member.id);
  }
  return { mentionsAI, userIds: [...userIds] };
}

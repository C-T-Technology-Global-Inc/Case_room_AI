"use client";

import { SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MessageDTO } from "@/lib/dto";
import { postMessageAction, toggleReactionAction } from "@/server/actions/messages";
import { useCaseActions } from "../case/case-actions";
import { useCaseRealtime } from "../case/realtime-provider";
import { AIAvatar } from "../shared/user-avatar";
import { Composer } from "./composer";
import { MessageItem } from "./message-item";

const GROUP_WINDOW_MS = 5 * 60_000;

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function firstSentence(text: string, max = 90): string {
  const clean = text.replace(/@\w+/g, "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

export function DiscussionView({ initialMessages }: { initialMessages: MessageDTO[] }) {
  const { caseId, members, currentUser, permissions, openCreateTask, openCreateDecision } = useCaseActions();
  const realtime = useCaseRealtime();
  const [messages, setMessages] = useState<MessageDTO[]>(initialMessages);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const fetching = useRef<Promise<void> | null>(null);
  const staleWhileFetching = useRef(false);

  const refetch = useCallback(async () => {
    if (fetching.current) {
      // The response in flight may predate this change: fetch once more when it lands.
      staleWhileFetching.current = true;
      return fetching.current;
    }
    fetching.current = (async () => {
      try {
        do {
          staleWhileFetching.current = false;
          const response = await fetch(`/api/cases/${caseId}/messages`, { cache: "no-store" });
          if (!response.ok) return;
          const body = (await response.json()) as { messages: MessageDTO[] };
          setMessages((previous) => {
            const optimistic = previous.filter((m) => m.id.startsWith("temp-"));
            return [...body.messages, ...optimistic];
          });
        } while (staleWhileFetching.current);
      } finally {
        fetching.current = null;
      }
    })();
    return fetching.current;
  }, [caseId]);

  useEffect(
    () =>
      realtime.subscribe((event) => {
        // System messages (decisions, uploads, briefs) arrive as case.updated with the "messages" scope.
        const changed =
          event.type === "message.created" ||
          event.type === "message.updated" ||
          event.type === "resync" ||
          (event.type === "case.updated" && event.scopes.includes("messages"));
        if (changed) void refetch();
      }),
    [realtime, refetch],
  );

  // Track whether the user is reading history or following the conversation.
  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140;
  }

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const hash = window.location.hash.replace("#message-", "");
    if (hash && hash !== window.location.hash) {
      const target = document.getElementById(`message-${hash}`);
      if (target) {
        target.scrollIntoView({ block: "center" });
        stickToBottom.current = false;
        requestAnimationFrame(() => setHighlightId(hash));
        return;
      }
    }
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages.length, realtime.aiActivity.length]);

  async function send(content: string): Promise<boolean> {
    const tempId = `temp-${Date.now()}`;
    const me = members.find((m) => m.id === currentUser.id) ?? { id: currentUser.id, name: currentUser.name, role: currentUser.role, specialty: null, handle: "" };
    stickToBottom.current = true;
    setMessages((previous) => [...previous, { id: tempId, type: "USER", content, createdAt: new Date().toISOString(), author: me, metadata: null, reactions: [] }]);
    setPendingIds((previous) => new Set(previous).add(tempId));

    const result = await postMessageAction(caseId, content);
    setPendingIds((previous) => {
      const next = new Set(previous);
      next.delete(tempId);
      return next;
    });
    if (!result.ok) {
      setMessages((previous) => previous.filter((m) => m.id !== tempId));
      toast.error(result.error);
      return false;
    }
    setMessages((previous) => {
      const withoutTemp = previous.filter((m) => m.id !== tempId);
      return withoutTemp.some((m) => m.id === result.data.id) ? withoutTemp : [...withoutTemp, result.data];
    });
    return true;
  }

  async function react(messageId: string, emoji: string) {
    const result = await toggleReactionAction(messageId, emoji);
    if (!result.ok) toast.error(result.error);
    else void refetch();
  }

  const canTask = permissions.manageTasks;
  const canDecide = permissions.createDecision;

  const days = messages.map((message) => dayLabel(message.createdAt));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pt-4 pb-6 scrollbar-thin">
        <div className="mx-auto max-w-4xl">
          <div className="px-6 pb-4">
            <h2 className="text-base font-semibold">Case discussion</h2>
            <p className="text-[13px] text-muted-foreground">
              The whole care team and the AI case assistant, in one thread. Mention <span className="font-medium text-ai">@AI</span> for evidence-grounded answers.
            </p>
          </div>
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const day = days[index]!;
            const showDay = index === 0 || days[index - 1] !== day;
            const grouped =
              !showDay &&
              message.type === "USER" &&
              previous?.type === "USER" &&
              previous.author?.id === message.author?.id &&
              new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS;
            return (
              <div key={message.id}>
                {showDay && (
                  <div className="sticky top-0 z-10 flex justify-center py-2">
                    <span className="rounded-full border bg-card px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-xs">{day}</span>
                  </div>
                )}
                <MessageItem
                  message={message}
                  caseId={caseId}
                  members={members}
                  currentUserId={currentUser.id}
                  grouped={grouped}
                  highlighted={highlightId === message.id}
                  pending={pendingIds.has(message.id)}
                  onReact={react}
                  onCreateTask={
                    canTask && !message.id.startsWith("temp-")
                      ? (m) => openCreateTask({ title: firstSentence(m.content), description: m.content, sourceMessageId: m.id })
                      : undefined
                  }
                  onCreateDecision={
                    canDecide && !message.id.startsWith("temp-")
                      ? (m) =>
                          openCreateDecision({
                            title: firstSentence(m.content, 120),
                            description: m.content.replace(/\[\d+\]/g, ""),
                            sourceMessageId: m.id,
                            sourceDocumentIds:
                              m.metadata?.kind === "ai_answer" ? m.metadata.sources.filter((s) => s.kind === "document").map((s) => s.id) : [],
                          })
                      : undefined
                  }
                />
              </div>
            );
          })}

          {realtime.aiActivity.map((activity) => (
            <div key={activity.requestId} className="flex gap-3 px-6 py-3">
              <AIAvatar size="md" />
              <div className="flex items-center gap-2 rounded-xl border border-ai-border bg-ai-soft px-3.5 py-2.5 text-[13px] text-ai">
                <SparklesIcon className="size-4 animate-pulse" />
                {activity.label}
                <span className="flex gap-0.5">
                  <span className="size-1 animate-bounce rounded-full bg-ai [animation-delay:-0.3s]" />
                  <span className="size-1 animate-bounce rounded-full bg-ai [animation-delay:-0.15s]" />
                  <span className="size-1 animate-bounce rounded-full bg-ai" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t bg-card/80 px-6 pt-2 pb-3 backdrop-blur">
        <div className="mx-auto max-w-4xl">
          <div className="h-5 text-[11.5px] text-muted-foreground">
            {realtime.typing.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="flex gap-0.5">
                  <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                  <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                  <span className="size-1 animate-bounce rounded-full bg-muted-foreground" />
                </span>
                {realtime.typing.map((t) => t.name).join(", ")} {realtime.typing.length === 1 ? "is" : "are"} typing…
              </span>
            )}
          </div>
          <Composer
            members={members}
            currentUserId={currentUser.id}
            canAskAI={permissions.askAI}
            disabled={!permissions.postMessage}
            onSend={send}
            onTyping={realtime.notifyTyping}
          />
        </div>
      </div>
    </div>
  );
}

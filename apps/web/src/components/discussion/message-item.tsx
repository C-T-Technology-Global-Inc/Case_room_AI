"use client";

import { Badge } from "@ccr/ui/components/badge";
import { Button } from "@ccr/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@ccr/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ccr/ui/components/tooltip";
import { cn } from "@ccr/ui/lib/utils";
import type { AIConfidence } from "@ccr/types";
import {
  AlertTriangleIcon,
  CheckSquareIcon,
  CopyIcon,
  CornerDownRightIcon,
  InfoIcon,
  ScaleIcon,
  SmilePlusIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import { Fragment } from "react";
import { toast } from "sonner";
import type { MessageDTO, UserSummary } from "@/lib/dto";
import { formatTime } from "@/lib/format";
import { AIGeneratedBadge } from "../shared/badges";
import { RichText, SourceList } from "../shared/sources";
import { AIAvatar, UserAvatar } from "../shared/user-avatar";

export const REACTIONS = ["👍", "✅", "👀", "❗", "🙏"] as const;

const CONFIDENCE: Record<AIConfidence, { label: string; className: string }> = {
  high: { label: "High confidence", className: "border-approved-border bg-approved-soft text-approved" },
  moderate: { label: "Moderate confidence", className: "border-source-border bg-source-soft text-source" },
  low: { label: "Low confidence", className: "border-draft-border bg-draft-soft text-draft" },
  insufficient: { label: "Insufficient information", className: "border-danger-border bg-danger-soft text-danger" },
};

function MentionText({ content, members }: { content: string; members: UserSummary[] }) {
  const parts = content.split(/(@[A-Za-z][A-Za-z0-9_]*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!part.startsWith("@")) return <Fragment key={index}>{part}</Fragment>;
        const handle = part.slice(1).toLowerCase();
        if (handle === "ai") {
          return (
            <span key={index} className="rounded bg-ai-soft px-1 font-medium text-ai">
              @AI
            </span>
          );
        }
        const member = members.find((m) => m.handle.toLowerCase() === handle);
        if (!member) return <Fragment key={index}>{part}</Fragment>;
        return (
          <span key={index} className="rounded bg-primary/10 px-1 font-medium text-primary" title={member.name}>
            @{member.handle}
          </span>
        );
      })}
    </>
  );
}

interface MessageItemProps {
  message: MessageDTO;
  caseId: string;
  members: UserSummary[];
  currentUserId: string;
  grouped: boolean;
  highlighted: boolean;
  pending?: boolean;
  onReact: (messageId: string, emoji: string) => void;
  onCreateTask?: (message: MessageDTO) => void;
  onCreateDecision?: (message: MessageDTO) => void;
}

function Reactions({ message, currentUserId, onReact }: Pick<MessageItemProps, "message" | "currentUserId" | "onReact">) {
  if (message.reactions.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {message.reactions.map((reaction) => {
        const mine = reaction.userIds.includes(currentUserId);
        return (
          <Tooltip key={reaction.emoji}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onReact(message.id, reaction.emoji)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-full border px-1.5 py-px text-xs transition-colors",
                  mine ? "border-primary/40 bg-primary/10 text-primary" : "bg-card hover:bg-accent",
                )}
              >
                <span>{reaction.emoji}</span>
                <span className="tabular-nums">{reaction.count}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{reaction.names.join(", ")}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function Toolbar({ message, onReact, onCreateTask, onCreateDecision }: Pick<MessageItemProps, "message" | "onReact" | "onCreateTask" | "onCreateDecision">) {
  return (
    <div className="absolute -top-3.5 right-4 z-10 hidden items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-sm group-hover:flex">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="Add reaction">
            <SmilePlusIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1" align="end">
          <div className="flex gap-0.5">
            {REACTIONS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => onReact(message.id, emoji)} className="flex size-8 cursor-pointer items-center justify-center rounded-md text-base hover:bg-accent">
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {onCreateTask && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Create task from message" onClick={() => onCreateTask(message)}>
              <CheckSquareIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create task from message</TooltipContent>
        </Tooltip>
      )}
      {onCreateDecision && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Create decision from message" onClick={() => onCreateDecision(message)}>
              <ScaleIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Propose a decision from this discussion</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy text"
            onClick={() => {
              void navigator.clipboard.writeText(message.content);
              toast.success("Copied to clipboard");
            }}
          >
            <CopyIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy text</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function MessageItem(props: MessageItemProps) {
  const { message, caseId, members, currentUserId, grouped, highlighted, pending } = props;
  const metadata = message.metadata;

  if (message.type === "SYSTEM") {
    return (
      <div id={`message-${message.id}`} className="flex scroll-mt-24 items-center gap-3 px-6 py-1.5">
        <span className="h-px flex-1 bg-border" />
        <span className="flex max-w-[80%] items-center gap-1.5 text-center text-[11.5px] text-muted-foreground">
          <ZapIcon className="size-3 shrink-0" />
          {message.content}
          <span className="shrink-0 text-muted-foreground/60">· {formatTime(message.createdAt)}</span>
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (message.type === "AI") {
    const answer = metadata?.kind === "ai_answer" ? metadata : null;
    const failed = metadata?.kind === "ai_error";
    const question = answer?.question ?? (metadata?.kind === "ai_error" ? metadata.question : null);
    const requester = answer?.requestedById ? members.find((m) => m.id === answer.requestedById) : null;
    return (
      <div id={`message-${message.id}`} className={cn("group relative scroll-mt-24 px-6 py-2", highlighted && "bg-ai-soft/60")}>
        <Toolbar {...props} />
        <div className="flex gap-3">
          <AIAvatar size="md" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-ai">AI case assistant</span>
              <AIGeneratedBadge />
              {answer && <Badge className={cn("border", CONFIDENCE[answer.confidence].className)}>{CONFIDENCE[answer.confidence].label}</Badge>}
              <span className="text-[11px] text-muted-foreground">{formatTime(message.createdAt)}</span>
            </div>
            {question && (
              <div className="mt-1 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                <CornerDownRightIcon className="size-3" />
                Answering {requester ? requester.name : "a team member"}: “{question.length > 110 ? `${question.slice(0, 110)}…` : question}”
              </div>
            )}
            <div
              className={cn(
                "mt-2 max-w-3xl rounded-xl border px-4 py-3",
                failed ? "border-danger-border bg-danger-soft/60" : "border-ai-border bg-card shadow-[0_1px_2px_0_rgb(88_28_135/0.05)]",
              )}
            >
              {failed ? (
                <div className="flex items-start gap-2 text-[13px] text-danger">
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                  {message.content}
                </div>
              ) : (
                <RichText text={message.content} caseId={caseId} sources={answer?.sources ?? []} className="text-[13.5px]" />
              )}
              {answer && answer.sources.length > 0 && (
                <div className="mt-3 border-t pt-3">
                  <SourceList caseId={caseId} sources={answer.sources} />
                </div>
              )}
              {answer && (
                <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {answer.limitations}
                    {answer.droppedCitations > 0 && ` ${answer.droppedCitations} unverifiable citation(s) removed.`} Review with the source records before acting.
                  </span>
                </div>
              )}
            </div>
            <Reactions {...props} />
          </div>
        </div>
      </div>
    );
  }

  const author = message.author;
  const isMine = author?.id === currentUserId;
  const mentionsAI = metadata?.kind === "user" && metadata.mentionsAI;
  return (
    <div
      id={`message-${message.id}`}
      className={cn("group relative scroll-mt-24 px-6 hover:bg-accent/30", grouped ? "py-0.5" : "pt-2.5 pb-0.5", highlighted && "bg-primary/5", pending && "opacity-60")}
    >
      <Toolbar {...props} />
      <div className="flex gap-3">
        <div className="w-8 shrink-0">{!grouped && author && <UserAvatar user={author} size="md" className="mt-0.5" />}</div>
        <div className="min-w-0 flex-1">
          {!grouped && (
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[13px] font-semibold">{author?.name ?? "Unknown"}</span>
              {author?.specialty && <span className="text-[11px] text-muted-foreground">{author.specialty}</span>}
              <span className="text-[11px] text-muted-foreground/80">{formatTime(message.createdAt)}</span>
              {isMine && pending && <span className="text-[11px] text-muted-foreground">sending…</span>}
            </div>
          )}
          <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground/95">
            <MentionText content={message.content} members={members} />
            {mentionsAI && <SparklesIcon className="ml-1 inline size-3.5 text-ai" aria-label="Question for the AI" />}
          </div>
          <Reactions {...props} />
        </div>
      </div>
    </div>
  );
}

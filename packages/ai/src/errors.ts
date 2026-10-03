/** Base class for all AI-layer errors. `userMessage` is safe to show in the UI. */
export class AIError extends Error {
  readonly userMessage: string;
  constructor(message: string, userMessage?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AIError";
    this.userMessage = userMessage ?? "The AI assistant could not complete this request.";
  }
}

/** Missing or invalid provider configuration (e.g. no API key). */
export class AIConfigurationError extends AIError {
  constructor(message: string) {
    super(message, "The AI provider is not configured correctly. Ask an administrator to check the AI settings.");
    this.name = "AIConfigurationError";
  }
}

/** The model declined the request (e.g. safety classifier). */
export class AIRefusalError extends AIError {
  constructor(detail?: string) {
    super(
      `Model declined the request${detail ? `: ${detail}` : ""}`,
      "The AI model declined to respond to this request. Please rephrase or consult the source records directly.",
    );
    this.name = "AIRefusalError";
  }
}

/** The model's output was truncated or did not match the expected schema. */
export class AIOutputError extends AIError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "The AI response was incomplete or malformed. Please try again.", options);
    this.name = "AIOutputError";
  }
}

/** Transport / upstream failure (rate limit, network, provider outage). */
export class AIProviderError extends AIError {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(
      message,
      retryable
        ? "The AI provider is temporarily unavailable. Please try again in a moment."
        : "The AI provider rejected the request.",
      options,
    );
    this.name = "AIProviderError";
    this.retryable = retryable;
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof AIError) return error.userMessage;
  return "The AI assistant could not complete this request.";
}

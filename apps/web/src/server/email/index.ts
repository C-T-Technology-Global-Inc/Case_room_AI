import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { appUrl } from "../app-url";
import { AppError } from "../errors";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * How email leaves this deployment:
 * - smtp: any SMTP service (SMTP_URL), e.g. Amazon SES, Resend, Postmark or a hospital mail server;
 * - log: printed to the server log (default in development; in production only when EMAIL_TRANSPORT=log);
 * - file: one JSON file per message in EMAIL_OUTBOX_DIR (end-to-end tests);
 * - memory: kept in process memory (integration tests).
 */
export type EmailTransportName = "smtp" | "log" | "file" | "memory";

const TRANSPORTS: readonly EmailTransportName[] = ["smtp", "log", "file", "memory"];

export function emailTransport(): EmailTransportName | null {
  const explicit = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
  const smtpUrl = process.env.SMTP_URL?.trim();
  if (explicit === "none") return null;
  if (explicit && TRANSPORTS.includes(explicit as EmailTransportName)) {
    return explicit === "smtp" && !smtpUrl ? null : (explicit as EmailTransportName);
  }
  if (smtpUrl) return "smtp";
  return process.env.NODE_ENV === "production" ? null : "log";
}

/**
 * Whether account emails (signup confirmation, password reset, invitations)
 * can be sent: a transport is configured and links can point to APP_URL.
 */
export function emailEnabled(): boolean {
  return emailTransport() !== null && appUrl() !== null;
}

/** Email is not configured on this deployment; the message says what is unavailable. */
export class EmailUnavailableError extends AppError {
  constructor(message = "Email delivery is not configured on this deployment.") {
    super(message);
    this.name = "EmailUnavailableError";
  }
}

/** The mail server did not accept the message. */
export class EmailDeliveryError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super("The email could not be sent. Please try again in a few minutes.");
    this.name = "EmailDeliveryError";
    if (options?.cause) this.cause = options.cause;
  }
}

const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

/**
 * Account emails are sent after the response (see server/actions/auth.ts).
 * Bound that background work per process: a few SMTP sends at a time, and a
 * short queue; beyond it a send fails (and is logged) instead of piling up.
 */
const MAX_CONCURRENT_SENDS = 4;
const MAX_QUEUED_SENDS = 100;
const sendSlots = { active: 0, queue: [] as Array<() => void> };

async function withSendSlot<T>(work: () => Promise<T>): Promise<T> {
  if (sendSlots.active < MAX_CONCURRENT_SENDS) sendSlots.active += 1;
  else if (sendSlots.queue.length >= MAX_QUEUED_SENDS) throw new Error("Too many emails waiting to be sent");
  else await new Promise<void>((resolve) => sendSlots.queue.push(resolve)); // the slot is handed over on release
  try {
    return await work();
  } finally {
    const next = sendSlots.queue.shift();
    if (next) next();
    else sendSlots.active -= 1;
  }
}

const globalForEmail = globalThis as unknown as {
  __ccrSmtp?: { url: string; transporter: ReturnType<typeof nodemailer.createTransport> };
  __ccrEmailOutbox?: EmailMessage[];
};

function smtpTransporter(url: string) {
  if (globalForEmail.__ccrSmtp?.url !== url) {
    globalForEmail.__ccrSmtp = { url, transporter: nodemailer.createTransport({ url, ...SMTP_TIMEOUTS }) };
  }
  return globalForEmail.__ccrSmtp.transporter;
}

function sender(): string {
  const configured = process.env.EMAIL_FROM?.trim();
  if (configured) return configured;
  const host = appUrl() ? new URL(appUrl()!).hostname : "localhost";
  return `Clinical Case Room <no-reply@${host}>`;
}

/** Send one message. Throws EmailUnavailableError or EmailDeliveryError. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const transport = emailTransport();
  if (!transport) throw new EmailUnavailableError();
  try {
    switch (transport) {
      case "smtp":
        await withSendSlot(() => smtpTransporter(process.env.SMTP_URL!.trim()).sendMail({ from: sender(), ...message }));
        return;
      case "log":
        console.info(`[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}`);
        return;
      case "file": {
        // Runtime data, not code: the ignore comments keep build tracing from copying the whole project into the server output.
        const directory = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.EMAIL_OUTBOX_DIR?.trim() || "email-outbox");
        await mkdir(directory, { recursive: true });
        const name = `${Date.now()}-${randomBytes(4).toString("hex")}.json`;
        const file = path.join(/*turbopackIgnore: true*/ directory, name);
        await writeFile(file, JSON.stringify({ ...message, from: sender(), sentAt: new Date().toISOString() }, null, 2));
        return;
      }
      case "memory":
        (globalForEmail.__ccrEmailOutbox ??= []).push(message);
        return;
    }
  } catch (error) {
    console.error("[email] delivery failed", error instanceof Error ? error.message : error);
    throw new EmailDeliveryError({ cause: error });
  }
}

/** Messages sent with the memory transport (integration tests). */
export function memoryOutbox(): EmailMessage[] {
  return (globalForEmail.__ccrEmailOutbox ??= []);
}

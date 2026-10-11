import { afterEach, describe, expect, it, vi } from "vitest";
import { appLink, appUrl } from "../app-url";
import { emailEnabled, emailTransport, EmailUnavailableError, memoryOutbox, sendEmail } from "./index";
import { invitationEmail, passwordResetEmail } from "./templates";

afterEach(() => {
  vi.unstubAllEnvs();
  memoryOutbox().length = 0;
});

describe("email transport", () => {
  it("prints emails to the log in development and sends nothing in production unless configured", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "");
    vi.stubEnv("SMTP_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(emailTransport()).toBe("log");
    vi.stubEnv("NODE_ENV", "production");
    expect(emailTransport()).toBeNull();
    vi.stubEnv("SMTP_URL", "smtps://user:secret@smtp.example.test:465");
    expect(emailTransport()).toBe("smtp");
    vi.stubEnv("EMAIL_TRANSPORT", "none");
    expect(emailTransport()).toBeNull();
  });

  it("ignores an explicit smtp transport without SMTP_URL", () => {
    vi.stubEnv("EMAIL_TRANSPORT", "smtp");
    vi.stubEnv("SMTP_URL", "");
    expect(emailTransport()).toBeNull();
  });

  it("needs APP_URL in production, so links never come from the request's Host header", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_TRANSPORT", "log");
    vi.stubEnv("APP_URL", "");
    expect(appUrl()).toBeNull();
    expect(emailEnabled()).toBe(false);
    vi.stubEnv("APP_URL", "https://case-room.example.test/");
    expect(appLink("/reset-password/abc")).toBe("https://case-room.example.test/reset-password/abc");
    expect(emailEnabled()).toBe(true);
  });

  it("refuses to send when no transport is configured", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "none");
    await expect(sendEmail({ to: "a@b.test", subject: "s", text: "t", html: "h" })).rejects.toBeInstanceOf(EmailUnavailableError);
  });

  it("keeps messages in memory for tests", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "memory");
    await sendEmail({ to: "a@b.test", subject: "Hello", text: "Body", html: "<p>Body</p>" });
    expect(memoryOutbox()).toEqual([{ to: "a@b.test", subject: "Hello", text: "Body", html: "<p>Body</p>" }]);
  });
});

describe("email templates", () => {
  it("puts the link in the plain text and escapes names in the HTML", () => {
    const email = invitationEmail({
      to: "colleague@hospital.test",
      organizationName: 'Ward <script>alert("x")</script>',
      inviterName: "Dr. O'Brien",
      roleLabel: "Specialist",
      url: "https://case-room.test/invite/token-123",
      expiresAt: new Date("2026-10-23T00:00:00Z"),
    });
    expect(email.text).toContain("https://case-room.test/invite/token-123");
    expect(email.text).toContain("2026-10-23");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Dr. O&#39;Brien");
  });

  it("states how long a reset link works", () => {
    const email = passwordResetEmail({ to: "a@b.test", name: "Nurse Test", url: "https://case-room.test/reset-password/t", expiresInMinutes: 60 });
    expect(email.text).toMatch(/expires in 60 minutes/);
    expect(email.text).toContain("https://case-room.test/reset-password/t");
  });
});

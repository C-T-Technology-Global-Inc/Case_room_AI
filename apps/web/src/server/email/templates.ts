import type { EmailMessage } from "./index";

/**
 * Account emails. Plain text first (what security-conscious mail clients
 * show), with a minimal HTML version. No tracking pixels or remote images.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

interface Body {
  greeting: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer: string;
}

function render(to: string, subject: string, body: Body): EmailMessage {
  const text = [
    body.greeting,
    "",
    ...body.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(body.action ? [`${body.action.label}: ${body.action.url}`, ""] : []),
    body.footer,
    "",
    "Clinical Case Room",
  ].join("\n");

  const paragraph = (value: string) => `<p style="margin:0 0 16px">${escapeHtml(value)}</p>`;
  const button = body.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(body.action.url)}" style="background:#2563eb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(body.action.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:12px;color:#64748b">If the button does not work, copy this link into your browser:<br>${escapeHtml(body.action.url)}</p>`
    : "";
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
${paragraph(body.greeting)}${body.paragraphs.map(paragraph).join("")}${button}<p style="margin:24px 0 0;font-size:12px;color:#64748b">${escapeHtml(body.footer)}</p>
<p style="margin:8px 0 0;font-size:12px;color:#64748b">Clinical Case Room</p></body></html>`;

  return { to, subject, text, html };
}

export function signupConfirmationEmail(input: { to: string; name: string; organizationName: string; url: string; expiresInHours: number }): EmailMessage {
  return render(input.to, "Confirm your email to create your Clinical Case Room workspace", {
    greeting: `Hello ${input.name},`,
    paragraphs: [
      `You asked to create the workspace "${input.organizationName}" on Clinical Case Room with this email address.`,
      `Open the link below to confirm your address and choose a password. The link works once and expires in ${input.expiresInHours} hours.`,
    ],
    action: { label: "Confirm email and create workspace", url: input.url },
    footer: "If you did not ask for this, ignore this email: nothing is created until the link is opened.",
  });
}

/** Sent instead of a confirmation link when the address already has an account (no account enumeration on the signup form). */
export function existingAccountEmail(input: { to: string; name: string; signInUrl: string; resetUrl: string }): EmailMessage {
  return render(input.to, "You already have a Clinical Case Room account", {
    greeting: `Hello ${input.name},`,
    paragraphs: [
      "Someone tried to create a new workspace with this email address, but it already has an account.",
      `Sign in at ${input.signInUrl}. Once signed in, you can create another organization from the organization menu.`,
      `Forgot your password? Reset it at ${input.resetUrl}.`,
    ],
    footer: "If this was not you, you can ignore this email. Your account has not been changed.",
  });
}

export function passwordResetEmail(input: { to: string; name: string; url: string; expiresInMinutes: number }): EmailMessage {
  return render(input.to, "Reset your Clinical Case Room password", {
    greeting: `Hello ${input.name},`,
    paragraphs: [
      "We received a request to reset the password of your Clinical Case Room account.",
      `The link below works once and expires in ${input.expiresInMinutes} minutes. Choosing a new password signs out all your other sessions.`,
    ],
    action: { label: "Choose a new password", url: input.url },
    footer: "If you did not ask for this, ignore this email: your password stays the same.",
  });
}

export function passwordChangedEmail(input: { to: string; name: string; resetUrl: string }): EmailMessage {
  return render(input.to, "Your Clinical Case Room password was changed", {
    greeting: `Hello ${input.name},`,
    paragraphs: [
      "The password of your Clinical Case Room account was just changed, and your other sessions were signed out.",
      `If you did not do this, reset your password now at ${input.resetUrl} and tell your organization admin.`,
    ],
    footer: "This is an automatic security notice.",
  });
}

export function invitationEmail(input: {
  to: string;
  organizationName: string;
  inviterName: string;
  roleLabel: string;
  url: string;
  expiresAt: Date;
}): EmailMessage {
  const expires = input.expiresAt.toISOString().slice(0, 10);
  return render(input.to, `${input.inviterName} invited you to ${input.organizationName} on Clinical Case Room`, {
    greeting: "Hello,",
    paragraphs: [
      `${input.inviterName} invited you to join ${input.organizationName} on Clinical Case Room as ${input.roleLabel}.`,
      `Open the link below to accept. It works only for ${input.to} and expires on ${expires}.`,
    ],
    action: { label: `Join ${input.organizationName}`, url: input.url },
    footer: "If you were not expecting this invitation, you can ignore this email.",
  });
}

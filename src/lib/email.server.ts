/**
 * Server-only email helper using Resend.
 * Falls back to console.log if RESEND_API_KEY is not configured.
 * Import inside server handlers only:
 *   const { sendEmail } = await import("@/lib/email.server");
 */

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, from }: EmailOptions): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddr = from ?? process.env.EMAIL_FROM ?? "TaskOps <noreply@taskops.app>";

  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set — would send to ${Array.isArray(to) ? to.join(", ") : to}:`, subject);
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddr,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[email] Resend API error:", res.status, body);
      return { ok: false, error: body };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email] Failed to send:", message);
    return { ok: false, error: message };
  }
}

/**
 * Send task-assigned notification email.
 */
export async function sendTaskAssignedEmail(assigneeEmail: string, taskTitle: string, taskId: string) {
  return sendEmail({
    to: assigneeEmail,
    subject: `[TaskOps] New task assigned: ${taskTitle}`,
    html: `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">New Task Assigned</h2>
        <p>You've been assigned a new task:</p>
        <div style="background: #f8f9fa; border-left: 4px solid #6366f1; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <strong>${taskTitle}</strong>
        </div>
        <p style="color: #666; font-size: 14px;">Log in to TaskOps to view the full details and get started.</p>
      </div>
    `,
  });
}

/**
 * Send overdue notification email.
 */
export async function sendOverdueEmail(userEmail: string, taskTitle: string, taskId: string) {
  return sendEmail({
    to: userEmail,
    subject: `[TaskOps] ⚠️ Task overdue: ${taskTitle}`,
    html: `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Task Overdue</h2>
        <p>The following task is past its due date:</p>
        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <strong>${taskTitle}</strong>
        </div>
        <p style="color: #666; font-size: 14px;">Please take action on this task as soon as possible.</p>
      </div>
    `,
  });
}

/**
 * Send approval requested email.
 */
export async function sendApprovalRequestedEmail(approverEmail: string, taskTitle: string, taskId: string) {
  return sendEmail({
    to: approverEmail,
    subject: `[TaskOps] Approval requested: ${taskTitle}`,
    html: `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">Approval Requested</h2>
        <p>A task is waiting for your review and approval:</p>
        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <strong>${taskTitle}</strong>
        </div>
        <p style="color: #666; font-size: 14px;">Log in to TaskOps to review and approve or reject this task.</p>
      </div>
    `,
  });
}

/**
 * Send mention notification email.
 */
export async function sendMentionEmail(userEmail: string, mentionedBy: string, taskTitle: string, commentBody: string) {
  return sendEmail({
    to: userEmail,
    subject: `[TaskOps] ${mentionedBy} mentioned you in: ${taskTitle}`,
    html: `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">You were mentioned</h2>
        <p><strong>${mentionedBy}</strong> mentioned you in a comment on:</p>
        <div style="background: #f0f4ff; border-left: 4px solid #6366f1; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <strong>${taskTitle}</strong>
          <p style="margin: 8px 0 0; color: #555; font-size: 14px;">"${commentBody.slice(0, 200)}${commentBody.length > 200 ? "…" : ""}"</p>
        </div>
        <p style="color: #666; font-size: 14px;">Log in to TaskOps to view the full conversation.</p>
      </div>
    `,
  });
}

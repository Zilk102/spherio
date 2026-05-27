import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) {
    console.warn("[mail] SMTP не настроен (SMTP_HOST/SMTP_USER/SMTP_PASS)");
    return null;
  }
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    const secure = process.env.SMTP_SECURE !== "false" && port === 465;
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }
  return transporter;
}

function publicAppUrl(): string {
  return (process.env.APP_PUBLIC_URL ?? "https://sphere3d.ru").replace(/\/$/, "");
}

function fromAddress(): string {
  return process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || "noreply@sphere3d.ru";
}

export async function sendVerificationEmail(
  to: string,
  verifyUrl: string,
  displayName: string,
): Promise<void> {
  const tx = getTransporter();
  if (!tx) {
    throw new Error("smtp_not_configured");
  }
  const subject = "Подтвердите email — Sphere3D";
  const text =
    `Здравствуйте, ${displayName}!\n\n` +
    `Подтвердите регистрацию на Sphere3D, перейдя по ссылке:\n${verifyUrl}\n\n` +
    `Ссылка действует 24 часа. Если вы не регистрировались — проигнорируйте письмо.\n`;
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;line-height:1.5;color:#111">
<p>Здравствуйте, <strong>${escapeHtml(displayName)}</strong>!</p>
<p>Подтвердите регистрацию на <strong>Sphere3D</strong>:</p>
<p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:12px 20px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px">Подтвердить email</a></p>
<p style="font-size:13px;color:#555">Или скопируйте ссылку:<br><a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>
<p style="font-size:12px;color:#888">Ссылка действует 24 часа.</p>
</body></html>`;

  await tx.sendMail({
    from: `"Sphere3D" <${fromAddress()}>`,
    to,
    subject,
    text,
    html,
  });
}

export function buildVerificationUrl(rawToken: string): string {
  const base = publicAppUrl();
  return `${base}/?verify=${encodeURIComponent(rawToken)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

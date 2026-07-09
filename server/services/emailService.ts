import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || "noreply@chatbanana.com.br";
const APP_URL = process.env.APP_URL || "https://app.chatbanana.com.br";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_USER || !SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export function isEmailConfigured(): boolean {
  return !!(SMTP_USER && SMTP_PASS);
}

export async function sendLoginCodeEmail(params: {
  to: string;
  code: string;
  ttlMinutes?: number;
}): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    // Sem SMTP configurado: loga o código (dev) e devolve false. O fluxo de login
    // sempre responde genérico ao cliente, então isto nunca vaza nada pra fora.
    console.log(`[Email] SMTP nao configurado. Codigo de login p/ ${params.to}: ${params.code}`);
    return false;
  }

  const ttl = params.ttlMinutes || 10;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;border:1px solid #2a2a3e">
        <tr><td style="background:#FAC209;padding:28px 40px;text-align:center">
          <img src="${APP_URL}/chatbanana-logo.png" alt="ChatBanana CRM" width="220" height="auto" style="display:block;margin:0 auto;max-width:220px;height:auto" />
          <div style="font-size:13px;color:#1A1A1A;opacity:0.85;margin-top:8px;font-weight:600">Seu codigo de acesso</div>
        </td></tr>
        <tr><td style="padding:32px 40px;text-align:center">
          <div style="font-size:14px;color:#a0a0b0;line-height:1.7;margin-bottom:20px">
            Use o codigo abaixo para entrar na sua conta. Ele vale por <strong style="color:#FAC209">${ttl} minutos</strong>.
          </div>
          <div style="display:inline-block;background:#12121e;border:1px solid #2a2a3e;border-radius:12px;padding:18px 28px;font-size:34px;font-weight:800;letter-spacing:10px;color:#FAC209;font-family:'Courier New',monospace">
            ${params.code}
          </div>
          <div style="font-size:12px;color:#606070;margin-top:22px;line-height:1.6">
            Nao compartilhe este codigo com ninguem. Se voce nao tentou entrar, ignore este email.
          </div>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid #2a2a3e;text-align:center">
          <div style="font-size:11px;color:#505060">ChatBanana CRM © ${new Date().getFullYear()}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await t.sendMail({
      from: `"ChatBanana CRM" <${SMTP_FROM}>`,
      to: params.to,
      subject: `${params.code} é o seu código de acesso — ChatBanana`,
      html,
    });
    return true;
  } catch (err: any) {
    console.error("[Email] Erro ao enviar codigo de login:", err.message);
    return false;
  }
}

export async function sendInviteEmail(params: {
  to: string;
  inviteLink: string;
  workspaceName: string;
  role: string;
  teams: string[];
  invitedBy: string;
}): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.log("[Email] SMTP nao configurado. Link do convite:", params.inviteLink);
    return false;
  }

  // Auditoria 2026-06-19: escapa os campos livres do usuário (quem convida, nome do
  // workspace, equipes) antes de interpolar no HTML do e-mail — senão um admin/gestor
  // injetava HTML/link de phishing no convite enviado pelo domínio legítimo.
  const esc = (s: string) => String(s ?? "").slice(0, 120).replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c));
  const invitedBy = esc(params.invitedBy);
  const workspaceName = esc(params.workspaceName);
  const roleLabel = params.role === "gerente" ? "Gerente" : "Atendente";
  const teamsText = params.teams.length > 0 ? params.teams.map(esc).join(", ") : "Nenhuma equipe atribuida";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;border:1px solid #2a2a3e">
        <tr><td style="background:#FFC700;padding:28px 40px;text-align:center">
          <img src="${APP_URL}/chatbanana-logo.png" alt="ChatBanana CRM" width="220" height="auto" style="display:block;margin:0 auto;max-width:220px;height:auto" />
          <div style="font-size:13px;color:#0a0a0a;opacity:0.85;margin-top:8px;font-weight:600">Voce foi convidado!</div>
        </td></tr>
        <tr><td style="padding:32px 40px">
          <div style="font-size:16px;font-weight:700;color:#e0e0e0;margin-bottom:16px">Ola!</div>
          <div style="font-size:14px;color:#a0a0b0;line-height:1.7;margin-bottom:24px">
            <strong style="color:#e0e0e0">${invitedBy}</strong> convidou voce para fazer parte do workspace
            <strong style="color:#FFC700">${workspaceName}</strong> como <strong style="color:#FFC700">${roleLabel}</strong>.
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#12121e;border-radius:10px;border:1px solid #2a2a3e;margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              <div style="font-size:11px;color:#707080;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Detalhes do convite</div>
              <div style="font-size:13px;color:#d0d0e0;margin-bottom:6px">📋 Funcao: <strong style="color:#FFC700">${roleLabel}</strong></div>
              <div style="font-size:13px;color:#d0d0e0">👥 Equipe(s): <strong>${teamsText}</strong></div>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="${params.inviteLink}" style="display:inline-block;background:#FFC700;color:#0a0a0a;font-size:14px;font-weight:700;padding:14px 40px;border-radius:10px;text-decoration:none;letter-spacing:0.3px">
              Aceitar Convite e Criar Conta
            </a>
          </td></tr></table>
          <div style="font-size:12px;color:#606070;margin-top:20px;text-align:center">
            Este link expira em 48 horas. Se voce nao solicitou este convite, ignore este email.
          </div>
        </td></tr>
        <tr><td style="padding:16px 40px;border-top:1px solid #2a2a3e;text-align:center">
          <div style="font-size:11px;color:#505060">ChatBanana CRM © ${new Date().getFullYear()}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await t.sendMail({
      from: `"ChatBanana CRM" <${SMTP_FROM}>`,
      to: params.to,
      subject: `${params.invitedBy} convidou voce para o ${params.workspaceName} — ChatBanana CRM`,
      html,
    });
    return true;
  } catch (err: any) {
    console.error("[Email] Erro ao enviar convite:", err.message);
    return false;
  }
}

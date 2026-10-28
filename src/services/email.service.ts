import nodemailer from 'nodemailer';

export interface SendTenantCredentialsOptions {
  email: string;
  fullName: string;
  unitNumber: string;
  block?: string;
  communityName: string;
  genericPassword: string;
}

/**
 * Envia correo utilizando la API REST oficial de Gmail por HTTPS (Puerto 443).
 * Evita cualquier bloqueo de puertos SMTP (465/587) en servidores en la nube como Railway.
 */
const sendMailViaGmailRestApi = async (options: {
  to: string;
  subject: string;
  html: string;
  senderEmail: string;
  communityName: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) => {
  const { to, subject, html, senderEmail, communityName, clientId, clientSecret, refreshToken } = options;

  console.log(`[GMAIL REST API] 🌐 Obteniendo Access Token de Google vía HTTPS...`);

  // Step 1: Exchange Refresh Token for Access Token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(`Error obteniendo Access Token de Google: ${tokenData.error_description || tokenData.error || 'Token inválido'}`);
  }

  const accessToken = tokenData.access_token;
  console.log(`[GMAIL REST API] 🔑 Access Token obtenido con éxito. Enviando mensaje por API REST...`);

  // Step 2: Build MIME message and convert to base64url
  const mimeMessage = [
    `From: "${communityName} - Zentary" <${senderEmail}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
  ].join('\r\n');

  const raw = Buffer.from(mimeMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Step 3: Call Gmail REST API messages.send endpoint
  const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  const sendData = await sendResponse.json();

  if (!sendResponse.ok) {
    throw new Error(`Gmail API Error (${sendResponse.status}): ${sendData.error?.message || 'Error desconocido'}`);
  }

  console.log(`[GMAIL REST API] 🎉 Mensaje enviado exitosamente vía HTTPS. MessageId: ${sendData.id}`);
  return { success: true, messageId: sendData.id };
};

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Envia correo de bienvenida y credenciales iniciales al inquilino registrado con logs detallados.
 */
export const sendTenantCredentialsEmail = async (options: SendTenantCredentialsOptions): Promise<EmailSendResult> => {
  const timestamp = new Date().toISOString();
  const { email, fullName, unitNumber, block, communityName, genericPassword } = options;

  console.log(`\n======================================================`);
  console.log(`[GMAIL EMAIL LOG] 🚀 INICIANDO DESPACHO DE CORREO [${timestamp}]`);
  console.log(`[GMAIL EMAIL LOG] 📌 Despacho en curso`);
  console.log(`[GMAIL EMAIL LOG] 🏠 Unidad: ${unitNumber} (${communityName})`);
  console.log(`======================================================`);

  const senderEmail = (process.env.GMAIL_USER || '').trim().replace(/^["']|["']$/g, '');
  const clientId = (process.env.GMAIL_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
  const clientSecret = (process.env.GMAIL_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
  const refreshToken = (process.env.GMAIL_REFRESH_TOKEN || '').trim().replace(/^["']|["']$/g, '');
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '').trim().replace(/^["']|["']$/g, '');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #0f172a; }
          .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); }
          .header { background: linear-gradient(135deg, #2563eb, #4f46e5); padding: 32px 24px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 1px; }
          .header p { margin: 6px 0 0 0; font-size: 13px; opacity: 0.9; }
          .body { padding: 32px 24px; }
          .greeting { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
          .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 20px 0; }
          .info-item { margin-bottom: 10px; font-size: 14px; }
          .info-item strong { color: #334155; }
          .cred-card { background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0; }
          .cred-title { font-size: 11px; text-transform: uppercase; font-weight: 800; color: #2563eb; letter-spacing: 1px; margin-bottom: 6px; }
          .cred-pass { font-family: monospace; font-size: 22px; font-weight: 800; color: #1e3a8a; letter-spacing: 2px; }
          .warning-badge { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 12px; border-radius: 10px; font-size: 13px; margin-top: 20px; line-height: 1.5; }
          .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>ZENTARY RESIDENCIAL</h1>
            <p>${communityName}</p>
          </div>
          
          <div class="body">
            <div class="greeting">¡Hola, ${fullName}! 👋</div>
            <p>Te damos la bienvenida a <strong>${communityName}</strong>. La administración ha activado tu acceso oficial a la aplicación móvil <strong>Zentary</strong>.</p>
            
            <div class="info-box">
              <div class="info-item"><strong>Residente:</strong> ${fullName}</div>
              <div class="info-item"><strong>Unidad Asignada:</strong> ${unitNumber} ${block ? `(${block})` : ''}</div>
              <div class="info-item"><strong>Correo Electrónico:</strong> ${email}</div>
            </div>

            <div class="cred-card">
              <div class="cred-title">🔑 Tu Contraseña Genérica Inicial</div>
              <div class="cred-pass">${genericPassword}</div>
            </div>

            <div class="warning-badge">
              ⚠️ <strong>Aviso de Seguridad Importante:</strong><br>
              Al iniciar sesión en la aplicación por primera vez, la plataforma te exigirá actualizar tu contraseña por una clave personal y privada.
            </div>
          </div>

          <div class="footer">
            Este correo fue enviado de forma automática por la administración de ${communityName}.<br>
            © 2026 Zentary Residential Platform. Todos los derechos reservados.
          </div>
        </div>
      </body>
    </html>
  `;

  const subject = `Accesos a la App Móvil Zentary - ${communityName}`;

  try {
    if (clientId && clientSecret && refreshToken) {
      try {
        console.log(`[GMAIL EMAIL LOG] 🌐 Usando API REST HTTPS directa de Gmail (Puerto 443)...`);
        const result = await sendMailViaGmailRestApi({
          to: email,
          subject,
          html: htmlContent,
          senderEmail,
          communityName,
          clientId,
          clientSecret,
          refreshToken,
        });

        console.log(`[GMAIL EMAIL LOG] ✅ EXITO REST API: Correo entregado correctamente`);
        console.log(`======================================================\n`);
        return result;
      } catch (restError: any) {
        console.warn(`[GMAIL EMAIL LOG] ⚠️ Fallo Gmail REST API (${restError.message}). Intentando fallback con Nodemailer SMTP...`);
      }
    }

    // Fallback to Nodemailer SMTP App Password
    console.log(`[GMAIL EMAIL LOG] 🔑 Usando transporte Nodemailer SMTP...`);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: senderEmail,
        pass: gmailPass,
      },
    });

    const info = await transporter.sendMail({
      from: `"${communityName} - Zentary" <${senderEmail}>`,
      to: email,
      subject,
      html: htmlContent,
    });

    console.log(`[GMAIL EMAIL LOG] ✅ EXITO SMTP: Correo entregado. MessageId: ${info.messageId}`);
    console.log(`======================================================\n`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error(`[GMAIL EMAIL LOG] ❌ ERROR ENVIANDO CORREO:`);
    console.error(`[GMAIL EMAIL LOG] ⚠️ Detalle del Error: ${error.message}`);
    console.log(`======================================================\n`);

    return { success: false, error: error.message };
  }
};

export interface SendVisitInvitationOptions {
  email: string;
  residentName: string;
  communityName: string;
  unit?: string;
  validFromText: string;
  publicUrl: string;
}

export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Arma asunto, texto y HTML del correo con el pase de ingreso (FastPass) de una visita.
 */
export const buildVisitInvitationEmail = (options: SendVisitInvitationOptions) => {
  const { residentName, communityName, unit, validFromText, publicUrl } = options;
  const subject = `Tu pase de ingreso a ${communityName}`;
  const text = `${residentName} te envió un pase de ingreso a ${communityName}${unit ? ` (${unit})` : ''}.\nFecha y hora autorizada: ${validFromText}.\n\nMuéstrale al oficial de garita el código QR en este enlace:\n${publicUrl}`;
  const html = `
    <div style="font-family: Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #0f172a;">
      <h2 style="color: #2563eb; margin-top: 0;">Tu pase de ingreso</h2>
      <p><strong>${escapeHtml(residentName)}</strong> te envió un pase de ingreso a <strong>${escapeHtml(communityName)}</strong>${unit ? ` (${escapeHtml(unit)})` : ''}.</p>
      <p><strong>Fecha y hora autorizada:</strong> ${escapeHtml(validFromText)}</p>
      <p>Muéstrale al oficial de garita el código QR en este enlace:</p>
      <p><a href="${escapeHtml(publicUrl)}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 700;">Ver mi pase</a></p>
      <p style="font-size: 12px; color: #64748b;">Si el botón no funciona, copia este enlace: ${escapeHtml(publicUrl)}</p>
    </div>
  `;
  return { subject, text, html };
};

/**
 * Envia por correo el enlace del pase de ingreso al visitante (Gmail REST API con fallback SMTP).
 */
export const sendVisitInvitationEmail = async (options: SendVisitInvitationOptions): Promise<EmailSendResult> => {
  const { email, communityName } = options;
  const { subject, html } = buildVisitInvitationEmail(options);

  const senderEmail = (process.env.GMAIL_USER || '').trim().replace(/^["']|["']$/g, '');
  const clientId = (process.env.GMAIL_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
  const clientSecret = (process.env.GMAIL_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
  const refreshToken = (process.env.GMAIL_REFRESH_TOKEN || '').trim().replace(/^["']|["']$/g, '');
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '').trim().replace(/^["']|["']$/g, '');

  try {
    if (clientId && clientSecret && refreshToken) {
      try {
        return await sendMailViaGmailRestApi({ to: email, subject, html, senderEmail, communityName, clientId, clientSecret, refreshToken });
      } catch (restError: any) {
        console.warn(`[VISIT EMAIL] Fallo Gmail REST API (${restError.message}). Intentando fallback con Nodemailer SMTP...`);
      }
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: senderEmail, pass: gmailPass },
    });
    const info = await transporter.sendMail({
      from: `"${communityName} - Zentary" <${senderEmail}>`,
      to: email,
      subject,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error(`[VISIT EMAIL] Error enviando correo: ${error.message}`);
    return { success: false, error: error.message };
  }
};

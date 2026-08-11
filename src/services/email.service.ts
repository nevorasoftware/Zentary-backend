import nodemailer from 'nodemailer';

export interface SendTenantCredentialsOptions {
  email: string;
  fullName: string;
  unitNumber: string;
  block?: string;
  communityName: string;
  genericPassword: string;
}

const getTransporter = () => {
  const gmailUser = process.env.GMAIL_USER || process.env.SMTP_USER || 'zentaryapp@gmail.com';
  const gmailPass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;

  // Google Cloud Console OAuth2 credentials (if provided)
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    // Support OAuth2 authentication from Google Cloud Console
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: gmailUser,
        clientId,
        clientSecret,
        refreshToken,
      },
    });
  }

  // Standard Gmail SMTP / App Password
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  });
};

/**
 * Envia correo de bienvenida y credenciales iniciales al inquilino registrado
 */
export const sendTenantCredentialsEmail = async (options: SendTenantCredentialsOptions) => {
  try {
    const { email, fullName, unitNumber, block, communityName, genericPassword } = options;
    const transporter = getTransporter();

    const senderEmail = process.env.GMAIL_USER || 'zentaryapp@gmail.com';

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

    const mailOptions = {
      from: `"${communityName} - Zentary" <${senderEmail}>`,
      to: email,
      subject: `Accesos a la App Móvil Zentary - ${communityName}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Correo de accesos enviado exitosamente a ${email}. MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error(`❌ Error enviando correo a ${options.email}:`, error.message);
    return { success: false, error: error.message };
  }
};

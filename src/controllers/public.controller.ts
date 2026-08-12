import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import crypto from 'crypto';

/**
 * GET /api/public/visit/:publicToken
 * Returns visit metadata for visitor web page validation & display
 */
export const getPublicVisitDetails = async (req: Request, res: Response) => {
  try {
    const { publicToken } = req.params;

    if (!publicToken) {
      return res.status(400).json({ success: false, message: 'Token de visita requerido.' });
    }

    const visit = await prisma.visit.findUnique({
      where: { publicToken },
      include: {
        resident: {
          select: {
            fullName: true,
            community: {
              select: {
                name: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    });

    if (!visit) {
      return res.status(404).json({
        success: false,
        code: 'VISIT_NOT_FOUND',
        message: 'La invitación especificada no existe o el enlace es incorrecto.',
      });
    }

    // Validation checks according to detailed flow rules
    if (visit.status === 'CANCELADA') {
      return res.status(400).json({
        success: false,
        code: 'VISIT_CANCELLED',
        message: 'Esta invitación ha sido cancelada por el residente.',
      });
    }

    if (visit.status === 'VENCIDA') {
      return res.status(400).json({
        success: false,
        code: 'VISIT_EXPIRED',
        message: 'Esta invitación ha expirado y ya no está vigente.',
      });
    }

    if (visit.status === 'INGRESADA' || visit.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        code: 'VISIT_ALREADY_USED',
        message: '⚠️ Esta invitación ya fue utilizada. Los datos del visitante ya fueron registrados y el acceso ha sido procesado.',
      });
    }

    // If visit status is DATOS_COMPLETADOS, check active dynamic token
    let activeToken: string | null = null;
    let expiresAt: Date | null = null;
    let remainingSeconds = 0;

    if (visit.status === 'DATOS_COMPLETADOS') {
      const now = new Date();
      const currentTokenRecord = await prisma.visitToken.findFirst({
        where: {
          visitId: visit.id,
          isRevoked: false,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (currentTokenRecord) {
        activeToken = currentTokenRecord.token;
        expiresAt = currentTokenRecord.expiresAt;
        remainingSeconds = Math.max(0, Math.floor((currentTokenRecord.expiresAt.getTime() - now.getTime()) / 1000));
      }
    }

    return res.json({
      success: true,
      visit: {
        id: visit.id,
        status: visit.status,
        visitorName: visit.visitorName,
        visitorPhone: visit.visitorPhone,
        documentType: visit.documentType,
        documentNumber: visit.documentNumber,
        hasVehicle: visit.hasVehicle,
        vehiclePlate: visit.vehiclePlate,
        vehicleModel: visit.vehicleModel,
        vehicleColor: visit.vehicleColor,
        validFrom: visit.validFrom,
        residentName: visit.resident?.fullName || 'Residente',
        communityName: visit.resident?.community?.name || 'Residencial Zentary',
      },
      dynamicToken: activeToken,
      expiresAt,
      remainingSeconds,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al consultar la invitación', error: error.message });
  }
};

/**
 * POST /api/public/visit/:publicToken/register
 * Saves visitor's details, document photo, vehicle info, and activates dynamic QR token
 */
export const registerVisitorData = async (req: Request, res: Response) => {
  try {
    const { publicToken } = req.params;
    const {
      visitorName,
      documentType,
      documentNumber,
      documentPhotoUrl,
      hasVehicle,
      vehiclePlate,
      vehicleModel,
      vehicleColor,
    } = req.body;

    const visit = await prisma.visit.findUnique({
      where: { publicToken },
    });

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Invitación no encontrada.' });
    }

    if (visit.status === 'INGRESADA' || visit.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        code: 'VISIT_ALREADY_USED',
        message: '⚠️ Esta invitación ya fue registrada y utilizada.',
      });
    }

    if (visit.status === 'CANCELADA') {
      return res.status(400).json({ success: false, message: 'Esta invitación fue cancelada.' });
    }

    // Generate dynamic QR token valid for 15 minutes
    const tokenString = `ACCESS-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const [updatedVisit, newVisitToken] = await prisma.$transaction([
      prisma.visit.update({
        where: { id: visit.id },
        data: {
          visitorName: visitorName || visit.visitorName,
          documentType: documentType || 'DUI',
          documentNumber: documentNumber || null,
          documentPhotoUrl: documentPhotoUrl || null,
          hasVehicle: Boolean(hasVehicle),
          vehiclePlate: vehiclePlate || null,
          vehicleModel: vehicleModel || null,
          vehicleColor: vehicleColor || null,
          status: 'DATOS_COMPLETADOS',
        },
      }),
      prisma.visitToken.create({
        data: {
          visitId: visit.id,
          token: tokenString,
          expiresAt,
        },
      }),
    ]);

    return res.json({
      success: true,
      message: 'Registro de visitante completado exitosamente.',
      visit: updatedVisit,
      dynamicToken: newVisitToken.token,
      expiresAt: newVisitToken.expiresAt,
      remainingSeconds: 15 * 60,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al registrar los datos del visitante', error: error.message });
  }
};

/**
 * GET /api/public/visit/:publicToken/qr
 * Obtains or rotates dynamic 15-minute QR token for visitor's active session
 */
export const getOrRotateDynamicQR = async (req: Request, res: Response) => {
  try {
    const { publicToken } = req.params;

    const visit = await prisma.visit.findUnique({
      where: { publicToken },
    });

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Visita no encontrada.' });
    }

    if (visit.status === 'INGRESADA' || visit.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        code: 'VISIT_ALREADY_USED',
        message: 'Visita ingresada. El código QR ha sido detenido.',
      });
    }

    if (visit.status !== 'DATOS_COMPLETADOS') {
      return res.status(400).json({
        success: false,
        message: 'El visitante aún no ha completado el registro de sus datos.',
      });
    }

    const now = new Date();
    // Check if there is an active unexpired token
    let currentToken = await prisma.visitToken.findFirst({
      where: {
        visitId: visit.id,
        isRevoked: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    // If token does not exist or has less than 5 seconds remaining, generate a new one
    if (!currentToken || (currentToken.expiresAt.getTime() - now.getTime()) <= 5000) {
      const newTokenString = `ACCESS-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      currentToken = await prisma.visitToken.create({
        data: {
          visitId: visit.id,
          token: newTokenString,
          expiresAt,
        },
      });
    }

    const remainingSeconds = Math.max(0, Math.floor((currentToken.expiresAt.getTime() - now.getTime()) / 1000));

    return res.json({
      success: true,
      dynamicToken: currentToken.token,
      expiresAt: currentToken.expiresAt,
      remainingSeconds,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener código QR dinámico', error: error.message });
  }
};

/**
 * GET /visit/:publicToken
 * Renders the responsive public Web Application for Visitors
 */
export const renderVisitorWebPage = async (req: Request, res: Response) => {
  const { publicToken } = req.params;
  
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Registro de Visitante | Zentary</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
    body { background: #0F172A; color: #F8FAFC; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
    .card { background: rgba(30, 41, 59, 0.85); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 32px; width: 100%; max-width: 440px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .header { text-align: center; margin-bottom: 24px; }
    .logo-badge { background: linear-gradient(135deg, #2563EB, #1D4ED8); width: 64px; height: 64px; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 12px; box-shadow: 0 10px 20px rgba(37, 99, 235, 0.3); }
    h1 { font-size: 22px; font-weight: 700; color: #FFFFFF; }
    p.sub { font-size: 14px; color: #94A3B8; margin-top: 4px; }
    .info-box { background: rgba(15, 23, 42, 0.6); border-radius: 16px; padding: 16px; margin-bottom: 20px; border: 1px solid rgba(255, 255, 255, 0.05); }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #94A3B8; font-size: 13px; }
    .info-value { color: #F8FAFC; font-weight: 600; text-align: right; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #CBD5E1; margin-bottom: 6px; }
    input, select { width: 100%; padding: 12px 16px; background: #0F172A; border: 1px solid #334155; border-radius: 12px; color: #F8FAFC; font-size: 15px; outline: none; transition: border-color 0.2s; }
    input:focus, select:focus { border-color: #3B82F6; }
    .radio-group { display: flex; gap: 12px; margin-top: 6px; }
    .radio-btn { flex: 1; padding: 10px; background: #0F172A; border: 1px solid #334155; border-radius: 10px; text-align: center; cursor: pointer; font-size: 14px; color: #94A3B8; }
    .radio-btn.active { background: rgba(59, 130, 246, 0.2); border-color: #3B82F6; color: #3B82F6; font-weight: 600; }
    .btn-submit { width: 100%; padding: 14px; background: linear-gradient(135deg, #2563EB, #1D4ED8); border: none; border-radius: 14px; color: #FFFFFF; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 12px; box-shadow: 0 10px 25px rgba(37, 99, 235, 0.4); transition: transform 0.1s; }
    .btn-submit:active { transform: scale(0.98); }
    .qr-container { text-align: center; padding: 20px 0; }
    .qr-wrapper { background: #FFFFFF; padding: 20px; border-radius: 20px; display: inline-block; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
    .timer-badge { margin-top: 16px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 10px 16px; display: inline-block; color: #60A5FA; font-weight: 700; font-size: 16px; }
    .timer-sub { font-size: 12px; color: #94A3B8; margin-top: 6px; }
    .alert-box { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #FCA5A5; border-radius: 16px; padding: 20px; text-align: center; }
    .alert-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #F87171; }
    .alert-desc { font-size: 14px; line-height: 1.5; color: #FECACA; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo-badge">🏢</div>
      <h1 id="headerTitle">Registro de Visitante</h1>
      <p class="sub" id="headerSub">Acceso Autorizado Zentary</p>
    </div>

    <!-- Alert Screen (Used for used, expired, cancelled) -->
    <div id="alertScreen" class="alert-box hidden">
      <div class="alert-title" id="alertTitle">⚠️ Invitación No Disponible</div>
      <div class="alert-desc" id="alertDesc">Los datos del visitante ya fueron registrados y este enlace ya no está disponible.</div>
    </div>

    <!-- Loading Screen -->
    <div id="loadingScreen" style="text-align:center; padding: 40px 0;">
      <p style="color:#94A3B8;">Cargando invitación...</p>
    </div>

    <!-- Registration Form Screen -->
    <div id="formScreen" class="hidden">
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Comunidad:</span>
          <span class="info-value" id="dispCommunity">-</span>
        </div>
        <div class="info-row">
          <span class="info-label">Residente que invita:</span>
          <span class="info-value" id="dispResident">-</span>
        </div>
        <div class="info-row">
          <span class="info-label">Visitante:</span>
          <span class="info-value" id="dispVisitorName">-</span>
        </div>
        <div class="info-row">
          <span class="info-label">Hora autorizada:</span>
          <span class="info-value" id="dispValidFrom">-</span>
        </div>
      </div>

      <form id="visitorForm">
        <div class="form-group">
          <label>Nombre completo del visitante *</label>
          <input type="text" id="visitorName" required placeholder="Ej. Juan Pérez">
        </div>

        <div class="form-group">
          <label>Tipo de Documento *</label>
          <select id="documentType">
            <option value="DUI">DUI (El Salvador)</option>
            <option value="PASAPORTE">Pasaporte</option>
            <option value="OTRO">Otro Documento</option>
          </select>
        </div>

        <div class="form-group">
          <label>Número de Documento *</label>
          <input type="text" id="documentNumber" required placeholder="Ej. 01234567-8">
        </div>

        <div class="form-group">
          <label>¿Ingresará con vehículo?</label>
          <div class="radio-group">
            <div class="radio-btn active" id="btnVehNo" onclick="toggleVeh(false)">No</div>
            <div class="radio-btn" id="btnVehYes" onclick="toggleVeh(true)">Sí</div>
          </div>
        </div>

        <div id="vehicleFields" class="hidden">
          <div class="form-group">
            <label>Placa de Vehículo</label>
            <input type="text" id="vehiclePlate" placeholder="Ej. P 123-456">
          </div>
          <div class="form-group">
            <label>Modelo / Color (Opcional)</label>
            <input type="text" id="vehicleModel" placeholder="Ej. Toyota Corolla Gris">
          </div>
        </div>

        <button type="submit" class="btn-submit">Completar Registro y Obtener QR</button>
      </form>
    </div>

    <!-- Active QR Dynamic Screen -->
    <div id="qrScreen" class="hidden">
      <div style="text-align: center; margin-bottom: 12px;">
        <span style="background: #166534; color: #4ADE80; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px;">
          🟢 REGISTRO COMPLETADO
        </span>
      </div>

      <div class="qr-container">
        <div class="qr-wrapper">
          <canvas id="qrCanvas"></canvas>
        </div>
        <br>
        <div class="timer-badge">
          ⏳ Código válido por: <span id="timerText">15:00</span>
        </div>
        <div class="timer-sub">Presenta este código QR al personal de seguridad. El código rota automáticamente por seguridad.</div>
      </div>
    </div>
  </div>

  <script>
    const publicToken = "${publicToken}";
    let hasVehicleChoice = false;
    let timerInterval = null;
    let qrCheckInterval = null;

    function toggleVeh(val) {
      hasVehicleChoice = val;
      document.getElementById('btnVehNo').classList.toggle('active', !val);
      document.getElementById('btnVehYes').classList.toggle('active', val);
      document.getElementById('vehicleFields').classList.toggle('hidden', !val);
    }

    async function loadData() {
      try {
        const res = await fetch('/api/public/visit/' + publicToken);
        const data = await res.json();
        document.getElementById('loadingScreen').classList.add('hidden');

        if (!data.success) {
          showError(data.message || 'La invitación no está disponible.');
          return;
        }

        const v = data.visit;
        if (v.status === 'DATOS_COMPLETADOS') {
          showQR(data.dynamicToken, data.remainingSeconds);
          return;
        }

        // Populate Form
        document.getElementById('dispCommunity').innerText = v.communityName || 'Residencial';
        document.getElementById('dispResident').innerText = v.residentName || 'Residente';
        document.getElementById('dispVisitorName').innerText = v.visitorName || 'Invitado';
        document.getElementById('visitorName').value = v.visitorName || '';
        document.getElementById('dispValidFrom').innerText = v.validFrom ? new Date(v.validFrom).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Todo el día';
        
        document.getElementById('formScreen').classList.remove('hidden');
      } catch (err) {
        document.getElementById('loadingScreen').classList.add('hidden');
        showError('Error de conexión al servidor.');
      }
    }

    function showError(msg) {
      document.getElementById('formScreen').classList.add('hidden');
      document.getElementById('qrScreen').classList.add('hidden');
      document.getElementById('alertScreen').classList.remove('hidden');
      document.getElementById('alertDesc').innerText = msg;
    }

    document.getElementById('visitorForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        visitorName: document.getElementById('visitorName').value,
        documentType: document.getElementById('documentType').value,
        documentNumber: document.getElementById('documentNumber').value,
        hasVehicle: hasVehicleChoice,
        vehiclePlate: document.getElementById('vehiclePlate').value,
        vehicleModel: document.getElementById('vehicleModel').value
      };

      try {
        const res = await fetch('/api/public/visit/' + publicToken + '/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('formScreen').classList.add('hidden');
          showQR(data.dynamicToken, data.remainingSeconds);
        } else {
          alert(data.message || 'Error al guardar datos');
        }
      } catch (err) {
        alert('Error al enviar los datos');
      }
    });

    function showQR(tokenStr, remainingSecs) {
      document.getElementById('formScreen').classList.add('hidden');
      document.getElementById('qrScreen').classList.remove('hidden');
      document.getElementById('headerTitle').innerText = "Código de Acceso";
      document.getElementById('headerSub').innerText = "Muestra este QR en caseta de entrada";

      QRCode.toCanvas(document.getElementById('qrCanvas'), tokenStr, { width: 220, margin: 2 });
      startTimer(remainingSecs || 900);

      if (!qrCheckInterval) {
        qrCheckInterval = setInterval(fetchNextQR, 10000);
      }
    }

    async function fetchNextQR() {
      try {
        const res = await fetch('/api/public/visit/' + publicToken + '/qr');
        const data = await res.json();
        if (data.success && data.dynamicToken) {
          QRCode.toCanvas(document.getElementById('qrCanvas'), data.dynamicToken, { width: 220, margin: 2 });
          if (data.remainingSeconds > 0) {
            startTimer(data.remainingSeconds);
          }
        } else if (data.code === 'VISIT_ALREADY_USED') {
          clearInterval(qrCheckInterval);
          clearInterval(timerInterval);
          showError('✅ Visita autorizada e ingresada. ¡Bienvenido!');
          document.getElementById('alertTitle').innerText = 'Visita Completada';
        }
      } catch (err) {}
    }

    function startTimer(seconds) {
      if (timerInterval) clearInterval(timerInterval);
      let left = seconds;

      const updateDisplay = () => {
        const mins = Math.floor(left / 60);
        const secs = left % 60;
        document.getElementById('timerText').innerText = 
          (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
      };

      updateDisplay();
      timerInterval = setInterval(() => {
        left--;
        if (left <= 0) {
          clearInterval(timerInterval);
          fetchNextQR();
        } else {
          updateDisplay();
        }
      }, 1000);
    }

    loadData();
  </script>
</body>
</html>`;

  return res.send(html);
};


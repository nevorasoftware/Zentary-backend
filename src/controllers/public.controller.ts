import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import crypto from 'crypto';
import QRCode from 'qrcode';

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
                address: true,
              },
            },
            property: {
              select: {
                unitNumber: true,
                block: true,
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
    let qrImageDataUrl: string | null = null;

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
        qrImageDataUrl = await QRCode.toDataURL(activeToken, { width: 280, margin: 2 });
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
        documentPhotoUrl: visit.documentPhotoUrl,
        hasVehicle: visit.hasVehicle,
        vehiclePlate: visit.vehiclePlate,
        vehicleModel: visit.vehicleModel,
        vehicleColor: visit.vehicleColor,
        validFrom: visit.validFrom,
        residentName: visit.resident?.fullName || 'Residente',
        communityName: visit.resident?.community?.name || 'Residencial Zentary',
        communityAddress: visit.resident?.community?.address || '',
        propertyUnit: visit.resident?.property ? `${visit.resident.property.block ? visit.resident.property.block + ' ' : ''}${visit.resident.property.unitNumber}`.trim() : 'A-125',
        formattedDateStr: visit.validFrom ? new Date(visit.validFrom).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' - ' + new Date(visit.validFrom).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true }) : new Date(visit.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' - ' + new Date(visit.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true }),
      },
      dynamicToken: activeToken,
      qrImageDataUrl,
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
  const { publicToken } = req.params;
  console.log(`📝 [PUBLIC REGISTRATION ATTEMPT] Recibida solicitud de registro para token ${publicToken}`);

  try {
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
      console.warn(`⚠️ [PUBLIC REGISTRATION WARN] Token no existe: ${publicToken}`);
      return res.status(404).json({ success: false, message: 'Invitación no encontrada.' });
    }

    if (visit.status === 'INGRESADA' || visit.status === 'COMPLETED') {
      console.warn(`⚠️ [PUBLIC REGISTRATION WARN] Visita ya ingresada previamente: ${publicToken}`);
      return res.status(400).json({
        success: false,
        code: 'VISIT_ALREADY_USED',
        message: '⚠️ Esta invitación ya fue registrada y utilizada.',
      });
    }

    if (visit.status === 'CANCELADA') {
      console.warn(`⚠️ [PUBLIC REGISTRATION WARN] Visita cancelada: ${publicToken}`);
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

    const qrImageDataUrl = await QRCode.toDataURL(tokenString, { width: 280, margin: 2 });

    console.log(`✅ [PUBLIC REGISTRATION SUCCESS] Visita ${visit.id} (${visitorName}) completada con token QR: ${tokenString}`);

    return res.json({
      success: true,
      message: 'Registro de visitante completado exitosamente.',
      visit: updatedVisit,
      dynamicToken: newVisitToken.token,
      qrImageDataUrl,
      expiresAt: newVisitToken.expiresAt,
      remainingSeconds: 15 * 60,
    });
  } catch (error: any) {
    console.error(`❌ [PUBLIC REGISTRATION ERROR] Fallo al procesar token ${publicToken}:`, error);
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
    let currentToken = await prisma.visitToken.findFirst({
      where: {
        visitId: visit.id,
        isRevoked: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

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
    const qrImageDataUrl = await QRCode.toDataURL(currentToken.token, { width: 280, margin: 2 });

    return res.json({
      success: true,
      dynamicToken: currentToken.token,
      qrImageDataUrl,
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
  <title>Zentary | FAST PASS</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
    body { background: linear-gradient(180deg, #2563EB 0%, #1D4ED8 40%, #1E3A8A 100%); color: #F8FAFC; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 24px 16px; }
    
    .top-brand { text-align: center; margin-bottom: 20px; }
    .top-brand h1 { font-size: 28px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.5px; }
    .top-brand .fastpass-badge { font-size: 11px; font-weight: 800; color: #93C5FD; letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }

    .main-card { background: linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.05) 100%); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 36px; padding: 28px 20px; width: 100%; max-width: 410px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35); text-align: center; }

    /* White QR Card Container */
    .qr-card-box { background: #FFFFFF; border-radius: 28px; padding: 24px; display: inline-block; position: relative; box-shadow: 0 15px 35px rgba(0, 0, 0, 0.2); }
    .qr-img { width: 230px; height: 230px; border-radius: 12px; display: block; }
    .qr-center-logo { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 44px; height: 44px; background: #2563EB; border: 3px solid #FFFFFF; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-weight: 800; font-size: 18px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); }

    /* Rotation countdown text */
    .rotation-text { margin-top: 18px; font-size: 11px; font-weight: 800; color: #93C5FD; letter-spacing: 1px; text-transform: uppercase; }
    .dots-line { border-bottom: 2px dashed rgba(255, 255, 255, 0.25); width: 80%; margin: 12px auto; }

    .community-title { font-size: 24px; font-weight: 800; color: #FFFFFF; margin-top: 14px; }
    .unit-text { font-size: 15px; font-weight: 600; color: #DBEAFE; margin-top: 6px; }
    .date-text { font-size: 13px; color: #BFDBFE; margin-top: 4px; }

    /* Location Pill Button */
    .btn-location { display: inline-flex; align-items: center; justify-content: center; gap: 6px; width: 85%; padding: 14px; margin-top: 22px; background: rgba(255, 255, 255, 0.15); border: 1.5px solid rgba(255, 255, 255, 0.4); border-radius: 30px; color: #FFFFFF; font-size: 15px; font-weight: 700; text-decoration: none; transition: all 0.2s; }
    .btn-location:hover { background: rgba(255, 255, 255, 0.25); }

    /* More Options Button */
    .btn-more { background: transparent; border: none; color: #93C5FD; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 18px; display: inline-flex; align-items: center; gap: 4px; }

    /* Registration Modal Form Overlay */
    .modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(12px); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 100; }
    .modal-card { background: #1E293B; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 28px; padding: 28px 24px; width: 100%; max-width: 420px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .modal-title { font-size: 20px; font-weight: 800; color: #FFFFFF; margin-bottom: 4px; }
    .modal-sub { font-size: 13px; color: #94A3B8; margin-bottom: 20px; }
    .form-group { margin-bottom: 14px; text-align: left; }
    label { display: block; font-size: 12px; font-weight: 700; color: #CBD5E1; margin-bottom: 6px; }
    input, select { width: 100%; padding: 12px 14px; background: #0F172A; border: 1px solid #334155; border-radius: 12px; color: #F8FAFC; font-size: 14px; outline: none; }
    input:focus, select:focus { border-color: #3B82F6; }
    .file-input-wrapper { background: #0F172A; border: 2px dashed #334155; border-radius: 14px; padding: 14px; text-align: center; cursor: pointer; }
    .photo-preview { width: 100%; height: 140px; object-fit: cover; border-radius: 10px; margin-top: 10px; display: none; }
    .radio-group { display: flex; gap: 10px; margin-top: 6px; }
    .radio-btn { flex: 1; padding: 10px; background: #0F172A; border: 1px solid #334155; border-radius: 10px; text-align: center; cursor: pointer; font-size: 13px; color: #94A3B8; }
    .radio-btn.active { background: rgba(59, 130, 246, 0.2); border-color: #3B82F6; color: #60A5FA; font-weight: 700; }
    .btn-submit { width: 100%; padding: 14px; background: linear-gradient(135deg, #2563EB, #1D4ED8); border: none; border-radius: 14px; color: #FFFFFF; font-size: 16px; font-weight: 800; cursor: pointer; margin-top: 16px; box-shadow: 0 10px 25px rgba(37, 99, 235, 0.4); }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <!-- Brand Top Header -->
  <div class="top-brand">
    <h1 id="brandName">Zentary</h1>
    <div class="fastpass-badge">FAST PASS</div>
  </div>

  <div class="main-card">
    <!-- QR View Screen -->
    <div id="qrScreen" class="hidden">
      <div class="qr-card-box">
        <img id="qrImg" class="qr-img" alt="Código QR de Acceso">
        <div class="qr-center-logo">Z</div>
      </div>

      <div class="rotation-text" id="rotationText">CÓDIGO QR SE ACTUALIZARÁ EN <span id="secCount">59</span> SEGUNDOS</div>
      <div class="dots-line"></div>

      <h2 class="community-title" id="dispCommunity">Paseo del Prado 1</h2>
      <p class="unit-text" id="dispUnit">Unidad de destino: A-125</p>
      <p class="date-text" id="dispDate">Fecha: --/--/-- - --:--</p>

      <a id="btnMap" href="https://maps.google.com" target="_blank" class="btn-location">¿Cómo llegar? 📍</a>
      <br>
      <button onclick="toggleMoreOptions()" class="btn-more">Más opciones <span id="optArrow">˅</span></button>
    </div>

    <!-- Alert Screen -->
    <div id="alertScreen" class="hidden" style="padding: 20px 0;">
      <h3 style="color:#F87171; font-size: 18px; font-weight: 700;" id="alertTitle">⚠️ Invitación No Disponible</h3>
      <p style="color:#94A3B8; font-size: 14px; margin-top: 8px;" id="alertDesc">El enlace especificado ya no se encuentra activo o ha vencido.</p>
    </div>

    <!-- Loading State -->
    <div id="loadingScreen" style="padding: 40px 0;">
      <p style="color:#93C5FD; font-size: 15px;">Cargando FastPass...</p>
    </div>
  </div>

  <!-- Registration Modal Form -->
  <div id="registrationModal" class="modal-overlay hidden">
    <div class="modal-card">
      <div class="modal-title">Completar Datos de Visitante</div>
      <div class="modal-sub">Para activar tu código QR FastPass, ingresa tus datos personales:</div>

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
          <label>Fotografía del Documento *</label>
          <div class="file-input-wrapper" onclick="document.getElementById('documentPhotoFile').click()">
            <span style="font-size: 24px; display: block; margin-bottom: 4px;">📷</span>
            <span style="font-size: 13px; color: #60A5FA; font-weight: 600;" id="photoLabel">Tomar foto o subir documento</span>
            <input type="file" id="documentPhotoFile" accept="image/*" capture="environment" style="display:none;">
            <img id="photoPreview" class="photo-preview" alt="Vista previa documento">
          </div>
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
            <label>Placa de Vehículo *</label>
            <input type="text" id="vehiclePlate" placeholder="Ej. P 123-456">
          </div>
        </div>

        <button type="submit" class="btn-submit" id="btnSubmit">Activar Mi FastPass QR</button>
      </form>
    </div>
  </div>

  <script>
    const publicToken = "${publicToken}";
    let hasVehicleChoice = false;
    let documentPhotoBase64 = null;
    let timerInterval = null;
    let qrCheckInterval = null;

    document.getElementById('documentPhotoFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        document.getElementById('photoLabel').innerText = '⏳ Procesando imagen...';
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX = 1200;
            let w = img.width, h = img.height;
            if (w > h ? w > MAX : h > MAX) {
              if (w > h) { h *= MAX / w; w = MAX; }
              else { w *= MAX / h; h = MAX; }
            }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            documentPhotoBase64 = canvas.toDataURL('image/jpeg', 0.75);
            document.getElementById('photoPreview').src = documentPhotoBase64;
            document.getElementById('photoPreview').style.display = 'block';
            document.getElementById('photoLabel').innerText = '✅ Foto cargada correctamente';
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    function toggleVeh(val) {
      hasVehicleChoice = val;
      document.getElementById('btnVehNo').classList.toggle('active', !val);
      document.getElementById('btnVehYes').classList.toggle('active', val);
      document.getElementById('vehicleFields').classList.toggle('hidden', !val);
    }

    function toggleMoreOptions() {
      alert('Información adicional:\n- El código QR rota dinámicamente cada 60 segundos por seguridad.\n- Muéstralo directamente desde la pantalla al guardia.');
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
        document.getElementById('dispCommunity').innerText = v.communityName || 'Residencial Zentary';
        document.getElementById('dispUnit').innerText = 'Unidad de destino: ' + (v.propertyUnit || 'Principal');
        document.getElementById('dispDate').innerText = 'Fecha: ' + (v.formattedDateStr || 'Hoy');

        if (v.communityAddress) {
          document.getElementById('btnMap').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v.communityName + ' ' + v.communityAddress);
        } else {
          document.getElementById('btnMap').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v.communityName);
        }

        if (v.status === 'DATOS_COMPLETADOS') {
          showQR(data.qrImageDataUrl, data.remainingSeconds || 60);
          return;
        }

        // Show registration form modal
        document.getElementById('visitorName').value = v.visitorName || '';
        document.getElementById('registrationModal').classList.remove('hidden');
      } catch (err) {
        document.getElementById('loadingScreen').classList.add('hidden');
        showError('Error al cargar la invitación: ' + (err.message || err));
      }
    }

    function showError(msg) {
      document.getElementById('qrScreen').classList.add('hidden');
      document.getElementById('registrationModal').classList.add('hidden');
      document.getElementById('alertScreen').classList.remove('hidden');
      document.getElementById('alertDesc').innerText = msg;
    }

    document.getElementById('visitorForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!documentPhotoBase64) {
        alert('Por favor captura o sube la fotografía de tu documento.');
        return;
      }

      const btn = document.getElementById('btnSubmit');
      btn.disabled = true;
      btn.innerText = 'Activando QR...';

      const payload = {
        visitorName: document.getElementById('visitorName').value,
        documentType: document.getElementById('documentType').value,
        documentNumber: document.getElementById('documentNumber').value,
        documentPhotoUrl: documentPhotoBase64,
        hasVehicle: hasVehicleChoice,
        vehiclePlate: document.getElementById('vehiclePlate').value
      };

      try {
        const res = await fetch('/api/public/visit/' + publicToken + '/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('registrationModal').classList.add('hidden');
          showQR(data.qrImageDataUrl, data.remainingSeconds || 60);
        } else {
          alert('⚠️ ' + (data.message || 'Error al registrar datos'));
          btn.disabled = false;
          btn.innerText = 'Activar Mi FastPass QR';
        }
      } catch (err) {
        alert('⚠️ Error de red al registrar datos.');
        btn.disabled = false;
        btn.innerText = 'Activar Mi FastPass QR';
      }
    });

    function showQR(qrDataUrl, remainingSecs) {
      document.getElementById('qrScreen').classList.remove('hidden');
      if (qrDataUrl) {
        document.getElementById('qrImg').src = qrDataUrl;
      }
      startRotationTimer(remainingSecs || 60);

      if (!qrCheckInterval) {
        qrCheckInterval = setInterval(fetchNextQR, 8000);
      }
    }

    async function fetchNextQR() {
      try {
        const res = await fetch('/api/public/visit/' + publicToken + '/qr');
        const data = await res.json();
        if (data.success && data.qrImageDataUrl) {
          document.getElementById('qrImg').src = data.qrImageDataUrl;
          startRotationTimer(data.remainingSeconds > 0 ? (data.remainingSeconds % 60 || 60) : 60);
        } else if (data.code === 'VISIT_ALREADY_USED') {
          clearInterval(qrCheckInterval);
          clearInterval(timerInterval);
          showError('✅ Visita autorizada e ingresada. ¡Bienvenido!');
          document.getElementById('alertTitle').innerText = 'Visita Completada';
        }
      } catch (err) {}
    }

    function startRotationTimer(seconds) {
      if (timerInterval) clearInterval(timerInterval);
      let left = seconds > 60 ? (seconds % 60 || 60) : seconds;

      const updateDisplay = () => {
        document.getElementById('secCount').innerText = left < 10 ? '0' + left : left;
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

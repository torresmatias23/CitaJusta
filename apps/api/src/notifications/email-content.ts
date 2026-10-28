import { notificationContent, notificationContentSchema } from './notification-content.js';
import { loadEmailLogo } from './email-logo.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

// Private layout: bodyHtml is built only by the escaped renderers below, never from event HTML.
function renderEmailLayout(title: string, bodyHtml: string, withLogo: boolean): string {
  const brand = withLogo
    ? '<img src="cid:citajusta-logo" alt="CitaJusta" width="148" height="148" style="display:block;width:148px;height:148px;max-width:100%;border:0;color:#172B50;font-size:20px;" />'
    : '<p style="margin:0;padding:32px 0;color:#172B50;font-size:25px;font-weight:bold;">CitaJusta</p>';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | CitaJusta</title>
  <style>@media screen and (max-width:480px) { .appointment-column { display:block !important;width:100% !important; } }</style>
</head>
<body style="margin:0;padding:0;background-color:#F3F8FB;color:#172B50;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F8FB;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #dce8ef;border-radius:16px;">
        <tr><td style="padding:0 24px;border-bottom:4px solid #008184;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td width="148" valign="middle">${brand}</td>
            <td align="right" valign="middle" style="padding-left:12px;color:#65748d;font-size:11px;font-weight:bold;letter-spacing:1px;">GESTIÓN DE CITAS</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:32px 24px;">
${bodyHtml}
        </td></tr>
        <tr><td style="padding:24px;border-top:1px solid #dce8ef;background-color:#f5f8fb;border-radius:0 0 16px 16px;">
          <p style="margin:0 0 6px;font-size:14px;font-weight:bold;color:#172B50;">Cita<span style="color:#008184;">Justa</span></p>
          <p style="margin:0;color:#65748d;font-size:11px;line-height:1.6;">Esta notificación fue generada automáticamente por CitaJusta.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Text-only interpolation; the optional CID is a fixed, validated application asset.
export function renderEmailHtml(title: string, message: string, withLogo = false): string {
  return renderEmailLayout(title, `          <p style="margin:0 0 12px;color:#008184;font-size:11px;font-weight:bold;letter-spacing:1px;">NOTIFICACIÓN DE CITAJUSTA</p>
          <h1 style="margin:24px 0 16px;color:#172B50;font-size:29px;line-height:1.25;">${escapeHtml(title)}</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EDF8F8;border:1px solid #d3eded;border-radius:12px;">
            <tr><td style="padding:24px 20px;">
              <p style="margin:0;color:#586d86;font-size:16px;line-height:1.7;overflow-wrap:break-word;">${escapeHtml(message)}</p>
            </td></tr>
          </table>
          <p style="margin:26px 0 16px;color:#586d86;font-size:14px;line-height:1.7;">Puedes consultar el estado actual en CitaJusta.</p>`, withLogo);
}

export function renderBookingEmailHtml(startsAt: string, timeZone: string, withLogo: boolean): string {
  const instant = new Date(startsAt);
  const date = new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone }).format(instant);
  const time = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(instant);
  return renderEmailLayout('Tu reserva está registrada', `          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td width="44" valign="middle">
              <table role="presentation" width="40" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" height="40" style="background-color:#e1f5f1;border-radius:50%;color:#008184;font-size:25px;line-height:40px;">&#10003;</td></tr></table>
            </td><td style="padding-left:12px;color:#008184;font-size:11px;font-weight:bold;line-height:1.6;letter-spacing:1px;">RESERVA CONFIRMADA EN EL SISTEMA</td></tr>
          </table>
          <h1 style="margin:24px 0 16px;color:#172B50;font-size:29px;line-height:1.25;">Tu reserva está registrada</h1>
          <p style="margin:0 0 28px;color:#586d86;font-size:16px;line-height:1.7;">Tu cita se agendó correctamente en CitaJusta. Aquí tienes los detalles para que puedas organizar tu visita.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EDF8F8;border:1px solid #d3eded;border-radius:12px;">
            <tr><td style="padding:24px 20px;">
              <p style="margin:0 0 18px;color:#008184;font-size:11px;font-weight:bold;letter-spacing:1px;">DETALLES DE TU CITA</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td class="appointment-column" width="65%" valign="top">
                  <p style="margin:0 0 6px;color:#65748d;font-size:13px;">Fecha</p>
                  <p style="margin:0 0 18px;color:#172B50;font-size:18px;font-weight:bold;line-height:1.5;">${escapeHtml(date)}</p>
                </td>
                <td class="appointment-column" width="35%" valign="top">
                  <p style="margin:0 0 6px;color:#65748d;font-size:13px;">Hora de inicio</p>
                  <p style="margin:0 0 20px;color:#172B50;font-size:26px;font-weight:bold;line-height:1.3;">${escapeHtml(time)}</p>
                </td>
              </tr></table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #cde4e7;">
                <tr><td style="padding-top:16px;color:#586d86;font-size:12px;line-height:1.7;overflow-wrap:break-word;">Zona horaria: <strong>${escapeHtml(timeZone)}</strong></td></tr>
                <tr><td style="padding-top:8px;color:#008184;font-size:12px;font-weight:bold;">&#8226; AGENDADA</td></tr>
              </table>
            </td></tr>
          </table>
          <p style="margin:26px 0 16px;color:#586d86;font-size:14px;line-height:1.7;">Puedes revisar el estado de tu cita desde la sección <strong>Mis citas</strong> de CitaJusta.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f8fb;border-left:3px solid #69b5b7;border-radius:4px;">
            <tr><td style="padding:12px 14px;color:#586d86;font-size:12px;line-height:1.6;">Este comprobante de reserva no implica una confirmación de asistencia.</td></tr>
          </table>`, withLogo);
}

export function renderEmailContent(value: unknown, timeZone = 'UTC', loadLogo = loadEmailLogo) {
  const item = notificationContentSchema.parse(value);
  // Reuse validated event-specific wording for plain text; leave HU-024 unchanged.
  const content = notificationContent(item, timeZone);
  const logo = loadLogo();
  return { subject: content.title, text: content.message,
    html: item.type === 'APPOINTMENT_BOOKED'
      ? renderBookingEmailHtml(item.data.startsAt, timeZone, logo !== undefined)
      : renderEmailHtml(content.title, content.message, logo !== undefined),
    ...(logo ? { attachments: [logo] } : {}),
  };
}

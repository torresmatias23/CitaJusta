// Published versions are immutable. Add a new UUID/content entry for each change;
// AuditEvent.resourceId refers to this registry, including historical versions.
export const privacyNoticeVersions = [{
  id: 'cd56aa09-2e36-43e2-8e4e-7b50a59fc831',
  version: '2026-11-02.1',
  publishedOn: '2026-11-02',
  title: 'Información de privacidad en CitaJusta',
  introduction: 'Esta información describe el funcionamiento actual de CitaJusta. No es una política legal aprobada ni una solicitud de consentimiento para tratamientos adicionales.',
  sections: [
    { heading: 'Tu cuenta y tus atenciones', paragraphs: [
      'Usamos tus nombres, apellidos y correo para identificar tu cuenta. Puedes añadir o quitar tu teléfono desde Mi cuenta. Con acceso local se guarda un hash de la contraseña; con Google se vincula el identificador de tu cuenta Google.',
      'Al usar el servicio se registran citas, institución, sede, servicio, horarios, estados y preferencias de espera. Estos datos permiten gestionar reservas, cancelaciones, ofertas y reasignaciones.',
    ] },
    { heading: 'Acceso, seguridad y seguimiento', paragraphs: [
      'Tu sesión permite consultar tu información personal. El personal autorizado accede a los datos operativos según sus permisos, institución y sede. Los reportes operativos presentan indicadores agregados.',
      'Se registran eventos de autenticación y operaciones para seguridad y trazabilidad. El control de intentos de acceso utiliza identificadores derivados de la dirección de conexión.',
    ] },
    { heading: 'Servicios externos y opciones', paragraphs: [
      'Si eliges Google para acceder, se verifican los datos de identidad que Google entrega. Añadir una cita a Google Calendar es una acción separada y requiere la autorización de Google para esa operación; iniciar sesión no añade citas automáticamente.',
      'Cuando el envío de correo está habilitado, Resend recibe el destinatario y el contenido necesario para entregar mensajes de cuenta, citas u ofertas. Los mapas e indicaciones conectan con OpenStreetMap o Google cuando eliges abrirlos.',
      'No se incorporan finalidades promocionales ni autorizaciones generales mediante este aviso.',
    ] },
    { heading: 'Tus preferencias', paragraphs: [
      'En Mi cuenta puedes corregir nombres, apellidos y teléfono, y elegir los correos de citas y de ofertas. Son preferencias funcionales: no equivalen a un consentimiento general de tratamiento. Las notificaciones internas permanecen disponibles y la recuperación de contraseña se gestiona por separado.',
      'No confirmar este aviso no bloquea el acceso, las citas ni la lista de espera, y no cambia tus preferencias.',
    ] },
    { heading: 'Registro de esta información', paragraphs: [
      'Si pulsas «Ya vi esta información», se registra tu cuenta, la versión y la fecha de esa confirmación. No se registra una aceptación de tratamientos ni se demuestra que hayas leído o comprendido todo el texto. Consultarlo o iniciar sesión no confirma nada automáticamente.',
      'Una nueva versión se volverá a mostrar. Puedes consultar la información desde Mi cuenta o el enlace de privacidad, aunque ya la hayas confirmado.',
    ] },
    { heading: 'Información pendiente de definición', paragraphs: [
      'El equipo aún debe publicar la identificación del responsable, el canal específico para solicitudes sobre datos, las bases legales por finalidad y los plazos de conservación. Esta pantalla no ofrece eliminación de cuentas ni promete borrado automático.',
      'Este aviso informativo no sustituye esas definiciones ni habilita consentimientos nuevos. Para la demostración deben utilizarse datos ficticios.',
    ] },
  ],
}] as const;

export const currentPrivacyNotice = privacyNoticeVersions[privacyNoticeVersions.length - 1]!;

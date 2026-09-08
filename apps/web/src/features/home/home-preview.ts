// Datos sintéticos de presentación. Nunca se usan para decisiones ni peticiones API.
export const homePreview = {
  profile: { name: 'Camila López', initials: 'CL' },
  services: ['Asesoría general', 'Atención al cliente', 'Orientación de trámites'],
  branches: ['Sucursal Centro', 'Sede Norte', 'Oficina Central'],
  preferences: ['Próximos 7 días', 'Próximos 14 días', 'Sin preferencia'],
  appointment: {
    service: 'Asesoría general',
    professional: 'Constanza Rojas',
    date: 'Martes 27 de mayo · fecha de ejemplo',
    time: '10:30',
    branch: 'Sucursal Centro',
    address: 'Avenida Principal 450',
    statusLabel: 'Agendada',
  },
  waitlist: { service: 'Orientación de trámites', days: 'Lunes a viernes', time: '08:00 – 13:00' },
  notifications: [
    { title: 'Tu próxima cita, a la vista', description: 'Aquí podrás consultar la información de tus reservas.', icon: 'check' },
    { title: 'Lista de espera', description: 'Este espacio mostrará novedades de tus solicitudes.', icon: 'bell' },
    { title: 'Todo en un mismo lugar', description: 'Las novedades aparecerán aquí cuando estén disponibles.', icon: 'calendar' },
  ],
} as const;

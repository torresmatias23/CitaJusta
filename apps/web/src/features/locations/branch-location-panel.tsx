import { useState } from 'react';
import { addressLabel, directionsUrl, osmEmbedUrl, type BranchLocation } from './branch-location';

export function BranchLocationPanel({ branch, initiallyExpanded = false }: { branch: BranchLocation & { name: string }; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const address = addressLabel(branch), map = osmEmbedUrl(branch), directions = directionsUrl(branch);
  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4" aria-label={`Ubicación de ${branch.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Ubicación de {branch.name}</h3>
        <button type="button" className="button button-outline" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Ocultar ubicación' : 'Ver ubicación'}
        </button>
      </div>
      {expanded && <div className="mt-3 space-y-3">
        <p>{address || 'Esta sede aún no tiene una dirección registrada.'}</p>
        {map ? <>
          <iframe src={map} title={`Mapa de ubicación de ${branch.name}`} loading="lazy"
            className="h-64 w-full rounded-lg border border-slate-200" referrerPolicy="strict-origin-when-cross-origin" />
          <p className="text-sm">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap contributors</a>.</p>
          <p className="text-sm">El mapa es externo y requiere conexión. Si no carga, puedes usar Cómo llegar.</p>
        </> : <p>No hay un par de coordenadas válido para mostrar el mapa de esta sede.</p>}
        {directions ? <>
          <a href={directions} target="_blank" rel="noopener noreferrer" className="button button-outline">Cómo llegar (Google Maps)</a>
          <p className="text-sm">{map ? 'El destino usa las coordenadas registradas.' : 'El destino usa la dirección registrada; verifica el resultado en Google Maps.'} La ruta se abre en otra pestaña.</p>
        </> : <p>No hay información suficientemente específica para ofrecer indicaciones.</p>}
        <p className="text-sm">Al abrir el mapa o las indicaciones te conectas al proveedor externo. CitaJusta no solicita tu geolocalización.</p>
      </div>}
    </section>
  );
}

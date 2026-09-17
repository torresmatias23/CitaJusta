import { useState } from 'react';
import { ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { AsyncState } from '../../components/ui/async-state';
import { Button } from '../../components/ui/button';
import type { WaitlistEntry, WaitlistPreferences } from './waitlist-api';
import type { WaitlistApi, WaitlistWrite } from './waitlist-page';
import { useWaitlistResource } from './use-waitlist-resource';

type Props = { entry: WaitlistEntry; owner: string; api: WaitlistApi; busy: boolean; write: WaitlistWrite };
const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function WaitlistPreferencesPanel(props: Props) {
  const { api, entry, owner } = props;
  const preferences = useWaitlistResource(`${owner}:preferences:${entry.id}`, (signal) => api.preferences(entry.id, signal));
  if (preferences.status === 'loading') return <AsyncState kind="loading" title="Cargando preferencias…" />;
  if (preferences.status === 'error') return <AsyncState kind="error" title="No pudimos cargar las preferencias" description={preferences.message} onRetry={preferences.reload} />;
  return <PreferencesForm {...props} initial={preferences.data} reload={preferences.reload} />;
}

function PreferencesForm({ entry, owner, api, busy, write, initial, reload }: Props & { initial: WaitlistPreferences; reload: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [branchToAdd, setBranchToAdd] = useState('');
  const branches = useWaitlistResource(`${owner}:preference-branches:${entry.service.id}`, (signal) => api.branches(entry.service.id, signal));
  return <form className="mt-5" onSubmit={(event) => {
    event.preventDefault();
    void write((signal) => api.updatePreferences(entry.id, draft, signal), 'Preferencias guardadas.', reload);
  }}>
    <fieldset disabled={busy} className="grid gap-6">
      <fieldset><legend className="mb-3 font-semibold">Días preferidos</legend><div className="flex flex-wrap gap-4">{days.map((day, index) => <label key={day} className="flex items-center gap-2"><input type="checkbox" checked={draft.preferredDays.includes(index + 1)} onChange={(event) => setDraft({ ...draft, preferredDays: event.target.checked ? [...draft.preferredDays, index + 1] : draft.preferredDays.filter((value) => value !== index + 1) })} />{day}</label>)}</div></fieldset>
      <fieldset><legend className="mb-3 font-semibold">Rangos horarios</legend>
        <p className="mb-3 text-sm">Horas locales de atención (HH:mm), sin conversión de zona horaria. Usa rangos separados y sin superposición.</p>
        {draft.timeRanges.length === 0 && <p className="mb-3 text-sm">Sin rangos guardados.</p>}
        {draft.timeRanges.map((range, index) => <div key={index} className="mb-3 flex flex-wrap items-end gap-3">
          <label className="waitlist-field">Desde · rango {index + 1}<input type="time" required value={range.start} onChange={(event) => setDraft({ ...draft, timeRanges: draft.timeRanges.map((item, i) => i === index ? { ...item, start: event.target.value } : item) })} /></label>
          <label className="waitlist-field">Hasta · rango {index + 1}<input type="time" required value={range.end} onChange={(event) => setDraft({ ...draft, timeRanges: draft.timeRanges.map((item, i) => i === index ? { ...item, end: event.target.value } : item) })} /></label>
          <Button variant="outline" aria-label={`Quitar rango ${index + 1}`} onClick={() => setDraft({ ...draft, timeRanges: draft.timeRanges.filter((_, i) => i !== index) })}><Trash2 size={18} aria-hidden="true" /> Quitar</Button>
        </div>)}
        <Button variant="outline" onClick={() => setDraft({ ...draft, timeRanges: [...draft.timeRanges, { start: '', end: '' }] })}><Plus size={18} aria-hidden="true" /> Agregar rango</Button>
      </fieldset>
      <fieldset><legend className="mb-3 font-semibold">Sedes preferidas, en orden</legend>
        {branches.status === 'loading' && <p role="status">Cargando sedes disponibles…</p>}
        {branches.status === 'error' && <AsyncState kind="error" title="No pudimos cargar el catálogo de sedes" description={`${branches.message} Las preferencias guardadas se conservan; puedes revisarlas o retirarte de la lista.`} onRetry={branches.reload} />}
        <ol className="mb-3 grid gap-2">{draft.preferredBranchIds.map((id, index) => <li key={id} className="flex flex-wrap items-center gap-3">
          <span>{index + 1}. {(branches.status === 'ready' ? branches.data.find((branch) => branch.id === id)?.name : undefined) ?? (entry.branch?.id === id ? entry.branch.name : 'Sede guardada (sin nombre disponible en el catálogo)')}</span>
          <Button variant="outline" disabled={index === 0} aria-label={`Subir sede ${index + 1}`} onClick={() => {
            const ids = [...draft.preferredBranchIds];
            ids.splice(index, 1); ids.splice(index - 1, 0, id);
            setDraft({ ...draft, preferredBranchIds: ids });
          }}><ArrowUp size={16} aria-hidden="true" /> Subir</Button>
          <Button variant="outline" aria-label={`Quitar sede ${index + 1}`} onClick={() => setDraft({ ...draft, preferredBranchIds: draft.preferredBranchIds.filter((value) => value !== id) })}><Trash2 size={16} aria-hidden="true" /> Quitar</Button>
        </li>)}</ol>
        {draft.preferredBranchIds.length === 0 && <p className="mb-3 text-sm">Sin sedes preferidas guardadas.</p>}
        {branches.status === 'ready' && <div className="flex flex-wrap items-end gap-3"><label className="waitlist-field">Agregar sede<select value={branchToAdd} onChange={(event) => setBranchToAdd(event.target.value)}><option value="">Selecciona una sede</option>{branches.data.filter((branch) => !draft.preferredBranchIds.includes(branch.id)).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><Button variant="outline" disabled={!branchToAdd || draft.preferredBranchIds.includes(branchToAdd)} onClick={() => { setDraft({ ...draft, preferredBranchIds: [...draft.preferredBranchIds, branchToAdd] }); setBranchToAdd(''); }}>Agregar sede</Button></div>}
      </fieldset>
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.allowsOtherBranches} onChange={(event) => setDraft({ ...draft, allowsOtherBranches: event.target.checked })} />Acepto otras sedes</label>
      <div><label className="flex items-center gap-2"><input type="checkbox" checked={draft.acceptsAnyProfessional} onChange={(event) => setDraft({ ...draft, acceptsAnyProfessional: event.target.checked })} />Acepto cualquier profesional</label><p className="mt-2 text-sm">La selección de un profesional específico aún no está disponible. Si desmarcas esta opción, actualmente tu solicitud no recibirá ofertas.</p></div>
      <p className="text-sm">Se guardan todas las preferencias del formulario. La institución valida su compatibilidad; esta pantalla no calcula prioridad ni garantiza una oferta.</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}><Save size={18} aria-hidden="true" />{busy ? 'Guardando…' : 'Guardar preferencias'}</Button><Button variant="outline" disabled={busy} onClick={reload}>Descartar cambios y recargar</Button></div>
    </fieldset>
  </form>;
}

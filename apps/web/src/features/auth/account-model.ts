import type { ApiClient } from '../../lib/http-client';
import { accountError, createAccountApi, type AccountProfile, type EmailPreferences } from './account-api';

export type AccountState = {
  status: 'loading' | 'ready' | 'error'; data: AccountProfile | null; loadError: string;
  firstName: string; lastName: string; phone: string; preferences: EmailPreferences;
  profilePending: boolean; preferencesPending: boolean; profileError: string; preferencesError: string;
  profileMessage: string; preferencesMessage: string;
};
export function createAccountModel(client: ApiClient, refreshProfile: () => Promise<void>, userId: string) {
  const api = createAccountApi(client), listeners = new Set<() => void>(), controllers = new Set<AbortController>();
  let disposed = false, sequence = 0;
  let state: AccountState = { status: 'loading', data: null, loadError: '', firstName: '', lastName: '', phone: '',
    preferences: { appointmentEmailsEnabled: true, offerEmailsEnabled: true }, profilePending: false, preferencesPending: false,
    profileError: '', preferencesError: '', profileMessage: '', preferencesMessage: '' };
  function update(patch: Partial<AccountState>) { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); } }
  const controller = () => { const item = new AbortController(); controllers.add(item); return item; };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    async load() {
      disposed = false; // React StrictMode may restart the same mounted effect after cleanup.
      const version = ++sequence, request = controller(); update({ status: 'loading', loadError: '' });
      try {
        const data = await api.find(request.signal);
        if (data.id !== userId) throw new Error('Perfil no corresponde a la sesión.');
        if (!disposed && version === sequence) update({ status: 'ready', data, firstName: data.firstName, lastName: data.lastName, phone: data.phone ?? '', preferences: data.notificationPreferences });
      } catch (error) { if (!disposed && version === sequence) update({ status: 'error', loadError: accountError(error) }); }
      finally { controllers.delete(request); }
    },
    setPersonal(field: 'firstName' | 'lastName' | 'phone', value: string) {
      if (!state.profilePending) update({ [field]: value, profileMessage: '', profileError: '' });
    },
    setPreference(field: keyof EmailPreferences, value: boolean) {
      if (!state.preferencesPending) update({ preferences: { ...state.preferences, [field]: value }, preferencesError: '', preferencesMessage: '' });
    },
    async savePersonal() {
      if (disposed || state.status !== 'ready' || state.profilePending) return;
      const input = { firstName: state.firstName.trim(), lastName: state.lastName.trim(), phone: state.phone.trim() || null };
      if (!input.firstName || !input.lastName || input.firstName.length > 120 || input.lastName.length > 120 || (input.phone?.length ?? 0) > 30) {
        update({ profileError: 'Ingresa nombres y apellidos de 1 a 120 caracteres; teléfono opcional de hasta 30.' }); return;
      }
      const request = controller(); update({ profilePending: true, profileError: '', profileMessage: '' });
      try {
        const saved = await api.updateProfile(input, request.signal);
        if (disposed) return;
        update({ data: state.data ? { ...state.data, ...saved } : null, firstName: saved.firstName, lastName: saved.lastName, phone: saved.phone ?? '', profileMessage: 'Información personal guardada.' });
        try { await refreshProfile(); }
        catch { update({ profileError: 'Los datos se guardaron, pero no pudimos actualizar el encabezado. Vuelve a consultar tu cuenta.' }); }
      } catch (error) { update({ profileError: accountError(error) }); }
      finally { controllers.delete(request); update({ profilePending: false }); }
    },
    async savePreferences() {
      if (disposed || state.status !== 'ready' || state.preferencesPending) return;
      const request = controller(); update({ preferencesPending: true, preferencesError: '', preferencesMessage: '' });
      try {
        const saved = await api.updatePreferences(state.preferences, request.signal);
        update({ preferences: saved, data: state.data ? { ...state.data, notificationPreferences: saved } : null,
          preferencesMessage: 'Preferencias guardadas. Las notificaciones internas siguen disponibles.' });
      } catch (error) { update({ preferencesError: accountError(error) }); }
      finally { controllers.delete(request); update({ preferencesPending: false }); }
    },
    dispose() { disposed = true; sequence++; controllers.forEach(item => item.abort()); controllers.clear(); listeners.clear(); },
  };
}
export type AccountModel = ReturnType<typeof createAccountModel>;

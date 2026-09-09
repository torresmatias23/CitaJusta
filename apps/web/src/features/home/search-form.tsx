import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  LogIn,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AsyncState } from '../../components/ui/async-state';
import { Button } from '../../components/ui/button';
import { useResource } from '../../lib/use-resource';
import { useAuth } from '../auth/auth-provider';
import { createCatalogApi } from '../availability/catalog-api';
import {
  changeSelection,
  initialSelection,
  searchParameters,
} from '../availability/search-selection';

function SearchField({
  name,
  label,
  placeholder,
  options,
  icon: Icon,
  value,
  onChange,
  disabled = false,
  className = '',
}: {
  name: string;
  label: string;
  placeholder: string;
  options: readonly { id: string; name: string }[];
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`search-field ${className}`}>
      <Icon className="search-field-icon" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <label htmlFor={name}>{label}</label>

        <div className="select-wrapper">
          <select
            id={name}
            name={name}
            value={value}
            required
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="" disabled>
              {placeholder}
            </option>

            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>

          <ChevronDown size={17} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export function SearchForm() {
  const { api, user, status } = useAuth();
  const navigate = useNavigate();

  const [selection, setSelection] = useState(initialSelection);

  const authenticated = status === 'authenticated' && user !== null;

  const catalogs = createCatalogApi(api);

  /*
   * IMPORTANTE:
   * useResource recibe null mientras no exista una sesión.
   * De esta forma el Home público NO consulta endpoints protegidos.
   */
  const institutions = useResource(
    authenticated ? `${user.id}:institutions` : null,
    (signal) => catalogs.institutions(signal),
  );

  const branches = useResource(
    authenticated && selection.institutionId
      ? `${user.id}:branches:${selection.institutionId}`
      : null,
    (signal) => catalogs.branches(selection.institutionId, signal),
  );

  const services = useResource(
    authenticated && selection.branchId
      ? `${user.id}:services:${selection.branchId}`
      : null,
    (signal) => catalogs.services(selection.branchId, signal),
  );

  const institutionOptions =
    institutions.status === 'success' ? institutions.data : [];

  const branchOptions =
    branches.status === 'success' ? branches.data : [];

  const serviceOptions =
    services.status === 'success' ? services.data : [];

  const canSearch =
    authenticated &&
    institutionOptions.some(
      (item) => item.id === selection.institutionId,
    ) &&
    branchOptions.some(
      (item) => item.id === selection.branchId,
    ) &&
    serviceOptions.some(
      (item) => item.id === selection.serviceId,
    );

  const update = (
    field: keyof typeof selection,
    value: string,
  ) => {
    setSelection((current) =>
      changeSelection(current, field, value),
    );
  };

  const failure =
    authenticated && institutions.status === 'error'
      ? institutions
      : authenticated &&
          branches.status === 'error' &&
          selection.institutionId
        ? branches
        : authenticated &&
            services.status === 'error' &&
            selection.branchId
          ? services
          : null;

  return (
    <div>
      <form
        id="buscar-horas"
        className="search-form connected-search"
        aria-label="Buscar horas"
        onSubmit={(event) => {
          event.preventDefault();

          if (canSearch) {
            navigate(
              `/resultados?${searchParameters(selection).toString()}`,
            );
          }
        }}
      >
        <SearchField
          className="institution-field"
          name="institution"
          label="Institución o empresa"
          value={selection.institutionId}
          onChange={(value) =>
            update('institutionId', value)
          }
          options={institutionOptions}
          icon={Building2}
          disabled={
            !authenticated ||
            institutions.status !== 'success' ||
            !institutionOptions.length
          }
          placeholder={
            !authenticated
              ? 'Inicia sesión para buscar'
              : institutions.status === 'loading'
                ? 'Cargando instituciones…'
                : 'Selecciona una institución'
          }
        />

        <SearchField
          name="branch"
          label="Sede o sucursal"
          value={selection.branchId}
          onChange={(value) =>
            update('branchId', value)
          }
          options={branchOptions}
          icon={Building2}
          disabled={
            !authenticated ||
            !selection.institutionId ||
            branches.status !== 'success' ||
            !branchOptions.length
          }
          placeholder={
            !authenticated
              ? 'Inicia sesión para buscar'
              : selection.institutionId &&
                  branches.status === 'loading'
                ? 'Cargando sedes…'
                : 'Selecciona una sede'
          }
        />

        <SearchField
          name="service"
          label="Servicio o atención"
          value={selection.serviceId}
          onChange={(value) =>
            update('serviceId', value)
          }
          options={serviceOptions}
          icon={BriefcaseBusiness}
          disabled={
            !authenticated ||
            !selection.branchId ||
            services.status !== 'success' ||
            !serviceOptions.length
          }
          placeholder={
            !authenticated
              ? 'Inicia sesión para buscar'
              : selection.branchId &&
                  services.status === 'loading'
                ? 'Cargando servicios…'
                : 'Selecciona un servicio'
          }
        />

        <SearchField
          name="preference"
          label="Fecha o preferencia"
          value={selection.days}
          onChange={(value) =>
            update('days', value)
          }
          options={[
            { id: '7', name: 'Próximos 7 días' },
            { id: '14', name: 'Próximos 14 días' },
            { id: '30', name: 'Próximos 30 días' },
          ]}
          icon={CalendarDays}
          disabled={!authenticated}
          placeholder="Selecciona un rango"
        />

        {authenticated ? (
          <Button
            type="submit"
            disabled={!canSearch}
            className="search-submit"
          >
            <Search size={22} aria-hidden="true" />
            Buscar horas
          </Button>
        ) : (
          <Link
            to="/login"
            className="button button-primary search-submit"
          >
            <LogIn size={20} aria-hidden="true" />
            Iniciar sesión
          </Link>
        )}
      </form>

      {!authenticated && status !== 'loading' && (
        <div className="search-login-notice">
          <strong>¿Quieres buscar una hora?</strong>
          <span>
            Inicia sesión o crea una cuenta para consultar
            instituciones, servicios y disponibilidad real.
          </span>

          <Link to="/registro">
            Crear una cuenta
          </Link>
        </div>
      )}

      {failure && (
        <AsyncState
          kind="error"
          title="No pudimos cargar el catálogo"
          description="Reintenta para consultar las opciones disponibles."
          onRetry={failure.reload}
        />
      )}

      {authenticated && !failure && (
        <p className="search-note" role="status">
          {institutions.status === 'loading'
            ? 'Cargando instituciones disponibles…'
            : institutions.status === 'success' &&
                !institutionOptions.length
              ? 'No hay instituciones disponibles por ahora.'
              : selection.institutionId &&
                  branches.status === 'success' &&
                  !branchOptions.length
                ? 'Esta institución no tiene sedes disponibles.'
                : selection.branchId &&
                    services.status === 'success' &&
                    !serviceOptions.length
                  ? 'Esta sede no tiene servicios disponibles.'
                  : 'Selecciona institución, sede y servicio. Los horarios se muestran en la zona horaria de tu dispositivo.'}
        </p>
      )}
    </div>
  );
}
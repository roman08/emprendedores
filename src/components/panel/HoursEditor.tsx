import { DAYS, defaultHours, validateDay, type DayHours, type DayKey, type Hours } from '../../lib/hours';

interface Props { value: Hours | null; onChange: (v: Hours | null) => void }

export default function HoursEditor({ value, onChange }: Props) {
  const enabled = value !== null;

  function patch(day: DayKey, p: Partial<DayHours>) {
    if (!value) return;
    onChange({ ...value, [day]: { ...value[day], ...p } });
  }

  function addSecond(day: DayKey) {
    if (!value) return;
    const d = value[day];
    // Propone un turno de tarde razonable después del cierre del primero
    const start = d.close >= '16:00' || d.close < d.open ? '19:00' : '16:00';
    patch(day, { open2: start, close2: start >= '19:00' ? '21:00' : '19:00' });
  }

  function removeSecond(day: DayKey) {
    if (!value) return;
    const { open2: _o, close2: _c, ...rest } = value[day];
    onChange({ ...value, [day]: rest });
  }

  function copyToAll() {
    if (!value) return;
    const src = DAYS.map((d) => value[d.key]).find((d) => !d.closed);
    if (!src) return;
    // El spread copia también open2/close2 cuando existen
    onChange(Object.fromEntries(DAYS.map((d) => [d.key, { ...src }])) as Hours);
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={enabled}
          onChange={(e) => onChange(e.target.checked ? defaultHours() : null)} />
        Mostrar mis horarios de atención
      </label>

      {value && (
        <>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {DAYS.map(({ key, label }) => {
              const d = value[key];
              const has2 = d.open2 !== undefined;
              const err = validateDay(d);
              return (
                <li key={key} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="w-24 text-sm font-medium">{label}</span>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!d.closed}
                        onChange={(e) => patch(key, { closed: !e.target.checked })} />
                      Abierto
                    </label>
                    {d.closed ? (
                      <span className="text-sm text-muted">Cerrado</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <input type="time" required className="input !w-auto !py-1.5" value={d.open}
                          onChange={(e) => patch(key, { open: e.target.value })} aria-label={`${label}: abre`}
                          aria-invalid={!!err} />
                        <span className="text-sm text-muted">a</span>
                        <input type="time" required className="input !w-auto !py-1.5" value={d.close}
                          onChange={(e) => patch(key, { close: e.target.value })} aria-label={`${label}: cierra`}
                          aria-invalid={!!err} />
                      </span>
                    )}
                  </div>

                  {!d.closed && has2 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 sm:pl-[6.75rem]">
                      <span className="text-sm text-muted">y de</span>
                      <input type="time" required className="input !w-auto !py-1.5" value={d.open2 ?? ''}
                        onChange={(e) => patch(key, { open2: e.target.value })} aria-label={`${label}: segundo turno abre`}
                        aria-invalid={!!err} />
                      <span className="text-sm text-muted">a</span>
                      <input type="time" required className="input !w-auto !py-1.5" value={d.close2 ?? ''}
                        onChange={(e) => patch(key, { close2: e.target.value })} aria-label={`${label}: segundo turno cierra`}
                        aria-invalid={!!err} />
                      <button type="button" className="text-sm text-muted underline hover:text-brand-700"
                        onClick={() => removeSecond(key)} aria-label={`${label}: quitar segundo turno`}>Quitar</button>
                    </div>
                  )}

                  {!d.closed && !has2 && (
                    <button type="button" className="mt-1.5 text-sm font-medium text-brand-700 hover:underline sm:ml-[6.75rem]"
                      onClick={() => addSecond(key)} aria-label={`${label}: agregar segundo turno`}>+ Agregar segundo turno</button>
                  )}

                  {err && <p role="alert" className="mt-1.5 text-sm text-red-700 sm:pl-[6.75rem]">{err}</p>}
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-ghost" onClick={copyToAll}>Copiar el primer día abierto a toda la semana</button>
          <p className="text-xs text-muted">Hora de Ciudad de México. Si cierras a mediodía, agrega un segundo turno. Si cierras después de medianoche (ej. 8:00 p. m. a 2:00 a. m.), el sistema lo entiende en el último turno del día.</p>
        </>
      )}
    </div>
  );
}

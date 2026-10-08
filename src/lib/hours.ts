export const TIMEZONE = 'America/Mexico_City';

export const DAYS = [
  { key: 'mon', label: 'Lunes' },
  { key: 'tue', label: 'Martes' },
  { key: 'wed', label: 'Miércoles' },
  { key: 'thu', label: 'Jueves' },
  { key: 'fri', label: 'Viernes' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
] as const;

export type DayKey = (typeof DAYS)[number]['key'];
/** open2/close2: segundo turno opcional. Sin ellos es un solo turno (formato original). */
export type DayHours = { closed: boolean; open: string; close: string; open2?: string; close2?: string };
export type Hours = Record<DayKey, DayHours>;
export interface Shift { open: string; close: string }

export function defaultHours(): Hours {
  const weekday: DayHours = { closed: false, open: '09:00', close: '18:00' };
  return {
    mon: { ...weekday }, tue: { ...weekday }, wed: { ...weekday }, thu: { ...weekday }, fri: { ...weekday },
    sat: { closed: false, open: '09:00', close: '14:00' },
    sun: { closed: true, open: '09:00', close: '14:00' },
  };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isTime = (t: unknown): t is string => typeof t === 'string' && TIME_RE.test(t);

/** "18:30" -> "6:30 p. m." */
export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'p. m.' : 'a. m.';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Turnos de un día (1 o 2), vacío si está cerrado. */
export function shiftsOf(d: DayHours | null | undefined): Shift[] {
  if (!d || d.closed) return [];
  const out: Shift[] = [{ open: d.open, close: d.close }];
  if (d.open2 && d.close2) out.push({ open: d.open2, close: d.close2 });
  return out;
}

/** Texto de un día: "9:00 a. m. – 2:00 p. m. · 4:00 p. m. – 8:00 p. m." o "Cerrado". */
export function fmtDay(d: DayHours): string {
  if (d.closed) return 'Cerrado';
  return shiftsOf(d).map((s) => `${fmtTime(s.open)} – ${fmtTime(s.close)}`).join(' · ');
}

/**
 * Valida un día para el formulario: devuelve un mensaje de error o null si es válido.
 * Turnos ordenados y sin traslape; solo el último turno puede cruzar la medianoche.
 */
export function validateDay(d: DayHours): string | null {
  if (d.closed) return null;
  if (!isTime(d.open) || !isTime(d.close)) return 'Indica la hora de apertura y de cierre.';
  // Un segundo turno presente (aunque vacío) debe completarse o quitarse; si no, parseHours lo rechazaría al leerlo
  const has2 = d.open2 != null || d.close2 != null;
  if (toMin(d.open) === toMin(d.close)) return 'La apertura y el cierre no pueden ser la misma hora.';
  if (!has2) return null;
  if (!isTime(d.open2) || !isTime(d.close2)) return 'Completa la hora de apertura y de cierre del segundo turno.';
  if (toMin(d.close) < toMin(d.open)) return 'Solo el segundo turno puede terminar después de medianoche.';
  if (toMin(d.open2) === toMin(d.close2)) return 'En el segundo turno, la apertura y el cierre no pueden ser la misma hora.';
  if (toMin(d.open2) <= toMin(d.close)) return 'El segundo turno debe empezar después de que termine el primero.';
  return null;
}

/** Día de la semana y minutos actuales en la zona horaria del negocio. */
function localNow(now: Date): { dayIdx: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { dayIdx: map[get('weekday')], minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

export interface OpenStatus { open: boolean; label: string; todayKey: DayKey }

/**
 * Estado actual ("Abierto · cierra a las…" / "Cerrado · abre …").
 * Soporta dos turnos por día y un último turno que cruza la medianoche.
 */
export function openStatus(hours: Hours | null | undefined, now = new Date()): OpenStatus | null {
  if (!hours) return null;
  const { dayIdx, minutes } = localNow(now);
  const todayKey = DAYS[dayIdx].key;

  // Último turno de ayer que cruza la medianoche y sigue abierto
  const prevShifts = shiftsOf(hours[DAYS[(dayIdx + 6) % 7].key]);
  const prevLast = prevShifts[prevShifts.length - 1];
  if (prevLast && toMin(prevLast.close) < toMin(prevLast.open) && minutes < toMin(prevLast.close))
    return { open: true, label: `Abierto · cierra a las ${fmtTime(prevLast.close)}`, todayKey };

  const todayShifts = shiftsOf(hours[todayKey]);
  for (let i = 0; i < todayShifts.length; i++) {
    const s = todayShifts[i];
    const o = toMin(s.open), c = toMin(s.close);
    // Solo el último turno del día puede cruzar la medianoche
    const overnight = c < o && i === todayShifts.length - 1;
    if (minutes >= o && (overnight || minutes < c))
      return { open: true, label: `Abierto · cierra a las ${fmtTime(s.close)}`, todayKey };
    if (minutes < o) return { open: false, label: `Cerrado · abre hoy a las ${fmtTime(s.open)}`, todayKey };
  }

  for (let i = 1; i <= 7; i++) {
    const d = DAYS[(dayIdx + i) % 7];
    const first = shiftsOf(hours[d.key])[0];
    if (first)
      return { open: false, label: `Cerrado · abre ${i === 1 ? 'mañana' : 'el ' + d.label.toLowerCase()} a las ${fmtTime(first.open)}`, todayKey };
  }
  return { open: false, label: 'Cerrado', todayKey };
}

/** Valida lo que llega de la base de datos para no romper la página con datos malformados. */
export function parseHours(raw: unknown): Hours | null {
  if (!raw || typeof raw !== 'object') return null;
  const out = {} as Hours;
  for (const { key } of DAYS) {
    const d = (raw as any)[key];
    if (!d || typeof d !== 'object' || !isTime(d.open) || !isTime(d.close)) return null;
    const day: DayHours = { closed: !!d.closed, open: d.open, close: d.close };
    const o2 = d.open2 ?? null, c2 = d.close2 ?? null;
    // El segundo turno viene completo o no viene
    if (o2 !== null || c2 !== null) {
      if (!isTime(o2) || !isTime(c2)) return null;
      day.open2 = o2;
      day.close2 = c2;
    }
    out[key] = day;
  }
  return out;
}

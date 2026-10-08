import { describe, expect, it } from 'vitest';
import { defaultHours, fmtDay, fmtTime, openStatus, parseHours, shiftsOf, validateDay, type Hours } from './hours';

// Ciudad de México es UTC-6 todo el año (sin horario de verano desde 2022).
// Lunes 5 de octubre de 2026. mx(dia, "HH:MM") -> instante UTC equivalente.
const mx = (day: number, hm: string) => new Date(`2026-10-${String(day).padStart(2, '0')}T${hm}:00-06:00`);
const MON = 5, TUE = 6, SAT = 10, SUN = 11, NEXT_MON = 12;

function week(over: Partial<Hours> = {}): Hours {
  const h = defaultHours();
  return { ...h, ...over };
}
const closedDay = { closed: true, open: '09:00', close: '14:00' };

describe('fmtTime / fmtDay', () => {
  it('formatea a 12 horas', () => {
    expect(fmtTime('00:00')).toBe('12:00 a. m.');
    expect(fmtTime('12:00')).toBe('12:00 p. m.');
    expect(fmtTime('18:30')).toBe('6:30 p. m.');
  });
  it('muestra uno o dos turnos', () => {
    expect(fmtDay({ closed: false, open: '09:00', close: '14:00' })).toBe('9:00 a. m. – 2:00 p. m.');
    expect(fmtDay({ closed: false, open: '09:00', close: '14:00', open2: '16:00', close2: '20:00' }))
      .toBe('9:00 a. m. – 2:00 p. m. · 4:00 p. m. – 8:00 p. m.');
    expect(fmtDay(closedDay)).toBe('Cerrado');
  });
});

describe('openStatus: un turno (formato anterior)', () => {
  const h = week();
  it('abierto dentro del turno', () => {
    expect(openStatus(h, mx(MON, '10:00'))).toMatchObject({ open: true, todayKey: 'mon', label: 'Abierto · cierra a las 6:00 p. m.' });
  });
  it('cerrado antes de abrir', () => {
    expect(openStatus(h, mx(MON, '07:00'))?.label).toBe('Cerrado · abre hoy a las 9:00 a. m.');
  });
  it('cerrado exactamente a la hora de cierre y abierto a la de apertura', () => {
    expect(openStatus(h, mx(MON, '18:00'))?.open).toBe(false);
    expect(openStatus(h, mx(MON, '09:00'))?.open).toBe(true);
  });
  it('después del cierre apunta a mañana', () => {
    expect(openStatus(h, mx(MON, '20:00'))?.label).toBe('Cerrado · abre mañana a las 9:00 a. m.');
  });
  it('sin horario devuelve null', () => {
    expect(openStatus(null)).toBeNull();
    expect(openStatus(undefined)).toBeNull();
  });
});

describe('openStatus: día cerrado', () => {
  it('domingo cerrado apunta al lunes', () => {
    expect(openStatus(week(), mx(SUN, '11:00'))?.label).toBe('Cerrado · abre mañana a las 9:00 a. m.');
  });
  it('sábado tarde con domingo cerrado apunta al lunes por nombre', () => {
    expect(openStatus(week(), mx(SAT, '15:00'))?.label).toBe('Cerrado · abre el lunes a las 9:00 a. m.');
  });
  it('toda la semana cerrada', () => {
    const all = Object.fromEntries(Object.keys(defaultHours()).map((k) => [k, closedDay])) as unknown as Hours;
    expect(openStatus(all, mx(MON, '10:00'))?.label).toBe('Cerrado');
  });
});

describe('openStatus: dos turnos', () => {
  const h = week({ mon: { closed: false, open: '09:00', close: '14:00', open2: '16:00', close2: '20:00' } });
  it('abierto en el primer turno', () => {
    expect(openStatus(h, mx(MON, '10:00'))?.label).toBe('Abierto · cierra a las 2:00 p. m.');
  });
  it('descanso de mediodía', () => {
    expect(openStatus(h, mx(MON, '15:00'))).toMatchObject({ open: false, label: 'Cerrado · abre hoy a las 4:00 p. m.' });
  });
  it('abierto en el segundo turno', () => {
    expect(openStatus(h, mx(MON, '17:00'))?.label).toBe('Abierto · cierra a las 8:00 p. m.');
  });
  it('después del segundo turno apunta a mañana', () => {
    expect(openStatus(h, mx(MON, '21:00'))?.label).toBe('Cerrado · abre mañana a las 9:00 a. m.');
  });
  it('el límite entre turnos: 14:00 cerrado, 16:00 abierto', () => {
    expect(openStatus(h, mx(MON, '14:00'))?.open).toBe(false);
    expect(openStatus(h, mx(MON, '16:00'))?.open).toBe(true);
  });
});

describe('openStatus: turno nocturno', () => {
  const night = week({
    sat: { closed: false, open: '20:00', close: '02:00' },
    sun: closedDay,
  });
  it('abierto antes de medianoche', () => {
    expect(openStatus(night, mx(SAT, '23:00'))?.label).toBe('Abierto · cierra a las 2:00 a. m.');
  });
  it('desborda al día siguiente (sábado -> domingo cerrado)', () => {
    expect(openStatus(night, mx(SUN, '01:00'))).toMatchObject({ open: true, todayKey: 'sun', label: 'Abierto · cierra a las 2:00 a. m.' });
  });
  it('ya cerró pasada la hora', () => {
    expect(openStatus(night, mx(SUN, '02:00'))?.open).toBe(false);
  });
  it('domingo -> lunes: el turno del domingo desborda al lunes', () => {
    const h = week({ sun: { closed: false, open: '20:00', close: '01:00' } });
    expect(openStatus(h, mx(NEXT_MON, '00:30'))).toMatchObject({ open: true, todayKey: 'mon' });
    expect(openStatus(h, mx(NEXT_MON, '01:00'))?.open).toBe(false);
  });
  it('dos turnos: solo el último desborda', () => {
    const h = week({ mon: { closed: false, open: '09:00', close: '14:00', open2: '20:00', close2: '03:00' } });
    expect(openStatus(h, mx(TUE, '02:00'))?.label).toBe('Abierto · cierra a las 3:00 a. m.');
    expect(openStatus(h, mx(MON, '23:30'))?.open).toBe(true);
    expect(openStatus(h, mx(MON, '15:00'))?.label).toBe('Cerrado · abre hoy a las 8:00 p. m.');
  });
  it('cierre a las 00:00 cuenta como medianoche', () => {
    const h = week({ mon: { closed: false, open: '18:00', close: '00:00' } });
    expect(openStatus(h, mx(MON, '23:59'))?.open).toBe(true);
    expect(openStatus(h, mx(TUE, '00:00'))?.open).toBe(false);
  });
});

describe('openStatus: zona horaria', () => {
  const h = week();
  it('usa la hora de Ciudad de México y no la del servidor', () => {
    // 15:00Z = 09:00 en CDMX (UTC-6)
    expect(openStatus(h, new Date('2026-10-05T15:00:00Z'))?.open).toBe(true);
    expect(openStatus(h, new Date('2026-10-05T14:59:00Z'))?.open).toBe(false);
  });
  it('el día cambia con la hora local, no con UTC', () => {
    // 2026-10-06T04:00Z = lunes 5 de octubre 22:00 en CDMX
    expect(openStatus(h, new Date('2026-10-06T04:00:00Z'))?.todayKey).toBe('mon');
    // 2026-10-06T06:00Z = martes 00:00 en CDMX
    expect(openStatus(h, new Date('2026-10-06T06:00:00Z'))?.todayKey).toBe('tue');
  });
  it('mismo desfase en invierno y verano (sin horario de verano)', () => {
    // Enero: lunes 2026-01-05 15:00Z = 09:00 CDMX; julio: lunes 2026-07-06 15:00Z = 09:00 CDMX
    expect(openStatus(h, new Date('2026-01-05T15:00:00Z'))?.open).toBe(true);
    expect(openStatus(h, new Date('2026-07-06T15:00:00Z'))?.open).toBe(true);
    expect(openStatus(h, new Date('2026-07-06T14:59:00Z'))?.open).toBe(false);
  });
});

describe('parseHours', () => {
  it('acepta datos viejos sin segundo turno y no agrega campos', () => {
    const p = parseHours(defaultHours())!;
    expect(p.mon).toEqual({ closed: false, open: '09:00', close: '18:00' });
    expect('open2' in p.mon).toBe(false);
  });
  it('conserva el segundo turno completo', () => {
    const raw = { ...defaultHours(), mon: { closed: false, open: '09:00', close: '14:00', open2: '16:00', close2: '20:00' } };
    expect(parseHours(raw)!.mon).toEqual(raw.mon);
  });
  it('trata null en open2/close2 como sin segundo turno', () => {
    const raw = { ...defaultHours(), mon: { closed: false, open: '09:00', close: '14:00', open2: null, close2: null } };
    expect('open2' in parseHours(raw)!.mon).toBe(false);
  });
  it('rechaza basura', () => {
    expect(parseHours(null)).toBeNull();
    expect(parseHours('hola')).toBeNull();
    expect(parseHours({})).toBeNull();
    expect(parseHours({ ...defaultHours(), mon: null })).toBeNull();
    expect(parseHours({ ...defaultHours(), mon: { closed: false, open: 9, close: 18 } })).toBeNull();
    expect(parseHours({ ...defaultHours(), mon: { closed: false, open: '9am', close: '6pm' } })).toBeNull();
    expect(parseHours({ ...defaultHours(), mon: { closed: false, open: '25:00', close: '18:00' } })).toBeNull();
    expect(parseHours({ ...defaultHours(), mon: { closed: false, open: '09:60', close: '18:00' } })).toBeNull();
  });
  it('rechaza un segundo turno incompleto o inválido', () => {
    const base = { closed: false, open: '09:00', close: '14:00' };
    expect(parseHours({ ...defaultHours(), mon: { ...base, open2: '16:00' } })).toBeNull();
    expect(parseHours({ ...defaultHours(), mon: { ...base, close2: '20:00' } })).toBeNull();
    expect(parseHours({ ...defaultHours(), mon: { ...base, open2: '', close2: '' } })).toBeNull();
    expect(parseHours({ ...defaultHours(), mon: { ...base, open2: 'x', close2: '20:00' } })).toBeNull();
  });
  it('un día faltante invalida todo el horario', () => {
    const { sun: _s, ...rest } = defaultHours();
    expect(parseHours(rest)).toBeNull();
  });
});

describe('shiftsOf', () => {
  it('devuelve los turnos del día', () => {
    expect(shiftsOf(closedDay)).toEqual([]);
    expect(shiftsOf(null)).toEqual([]);
    expect(shiftsOf({ closed: false, open: '09:00', close: '14:00' })).toHaveLength(1);
    expect(shiftsOf({ closed: false, open: '09:00', close: '14:00', open2: '16:00', close2: '20:00' })).toHaveLength(2);
  });
});

describe('validateDay', () => {
  const d = (p: object) => ({ closed: false, open: '09:00', close: '14:00', ...p });
  it('día cerrado siempre es válido', () => {
    expect(validateDay({ closed: true, open: '', close: '' })).toBeNull();
  });
  it('un turno normal y uno nocturno son válidos', () => {
    expect(validateDay(d({}))).toBeNull();
    expect(validateDay(d({ open: '20:00', close: '02:00' }))).toBeNull();
  });
  it('rechaza horas vacías o iguales', () => {
    expect(validateDay(d({ open: '' }))).not.toBeNull();
    expect(validateDay(d({ close: '09:00' }))).not.toBeNull();
  });
  it('dos turnos ordenados son válidos', () => {
    expect(validateDay(d({ open2: '16:00', close2: '20:00' }))).toBeNull();
    expect(validateDay(d({ open2: '20:00', close2: '02:00' }))).toBeNull();
  });
  it('rechaza turnos traslapados, desordenados o pegados', () => {
    expect(validateDay(d({ open2: '13:00', close2: '20:00' }))).not.toBeNull();
    expect(validateDay(d({ open2: '14:00', close2: '20:00' }))).not.toBeNull();
    expect(validateDay(d({ open: '16:00', close: '20:00', open2: '09:00', close2: '14:00' }))).not.toBeNull();
  });
  it('rechaza segundo turno incompleto', () => {
    expect(validateDay(d({ open2: '16:00', close2: '' }))).not.toBeNull();
    expect(validateDay(d({ open2: '', close2: '' }))).not.toBeNull();
    expect(validateDay(d({ open2: '16:00' }))).not.toBeNull();
  });
  it('el primer turno no puede cruzar la medianoche si hay segundo', () => {
    expect(validateDay(d({ open: '20:00', close: '02:00', open2: '03:00', close2: '05:00' }))).not.toBeNull();
  });
});

// Resolve a civil minute using the institution's IANA zone, never the device zone.
// Search candidate offsets across adjacent days and validate every candidate by round-trip.
export function institutionalInstant(date: string, time: string, timeZone: string): string {
  const invalid = () => new Error('Fecha u hora institucional inválida, inexistente o ambigua.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw invalid();
  const civil = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(civil) || new Date(civil).toISOString().slice(0, 16) !== `${date}T${time}`) throw invalid();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const localEpoch = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  };
  const offsets = new Set<number>();
  for (let hour = -48; hour <= 48; hour++) {
    const sample = civil + hour * 3_600_000;
    offsets.add(localEpoch(sample) - sample);
  }
  const candidates = [...offsets].map(offset => civil - offset).filter(value => value % 60_000 === 0 && localEpoch(value) === civil);
  if (candidates.length !== 1) throw invalid();
  return new Date(candidates[0]).toISOString();
}
export function institutionalInterval(date: string, start: string, end: string, timeZone: string) {
  const startsAt = institutionalInstant(date, start, timeZone), endsAt = institutionalInstant(date, end, timeZone);
  if (endsAt <= startsAt) throw new Error('La hora de término debe ser posterior al inicio.');
  return { startsAt, endsAt };
}

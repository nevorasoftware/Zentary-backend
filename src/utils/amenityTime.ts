// Horarios de amenidades que pueden cruzar la medianoche (fin <= inicio => termina al día siguiente)
export const timeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map((num) => parseInt(num, 10));
  return hours * 60 + minutes;
};

// Minutos del fin normalizados: si el fin es <= inicio, cruza medianoche y se suman 24 h
export const normEnd = (startMins: number, endMins: number): number =>
  endMins <= startMins ? endMins + 1440 : endMins;

// Traslape entre una reserva [start, end] (minutos del día D) y otra existente
// que empieza `dayOffset` días respecto a D, con sus horas "HH:MM"
export const reservationOverlaps = (
  start: number,
  end: number,
  existing: { startTime: string; endTime: string },
  dayOffset: number,
): boolean => {
  const eStartRaw = timeToMinutes(existing.startTime);
  const eStart = dayOffset * 1440 + eStartRaw;
  const eEnd = dayOffset * 1440 + normEnd(eStartRaw, timeToMinutes(existing.endTime));
  return !(end <= eStart || start >= eEnd);
};

// Una reserva "HH:MM" ocupa también el inicio del día siguiente solo si termina después de las 00:00
export const spillsToNextDay = (startTime: string, endTime: string): boolean => {
  const end = timeToMinutes(endTime);
  return end > 0 && end <= timeToMinutes(startTime);
};

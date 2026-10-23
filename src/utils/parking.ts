// Lógica pura de parqueos de visita (sin acceso a base de datos)

export const DEFAULT_HOLD_MINUTES = 60;
export const HOLD_LEAD_MINUTES = 30;

export type ParkingReservationLike = {
  zoneId: string;
  status: string;
  holdFrom: Date;
  holdUntil: Date;
};

export type ParkingZoneLike = {
  id: string;
  capacity: number;
  isActive: boolean;
  sortOrder: number;
};

/**
 * Ventana de reserva: desde 30 minutos antes de `validFrom` hasta `validFrom` + minutos de espera.
 */
export function computeHoldWindow(validFrom: Date, holdMinutes: number = DEFAULT_HOLD_MINUTES) {
  return {
    holdFrom: new Date(validFrom.getTime() - HOLD_LEAD_MINUTES * 60000),
    holdUntil: new Date(validFrom.getTime() + holdMinutes * 60000),
  };
}

export function windowsOverlap(aFrom: Date, aUntil: Date, bFrom: Date, bUntil: Date): boolean {
  return aFrom.getTime() < bUntil.getTime() && bFrom.getTime() < aUntil.getTime();
}

/**
 * Ocupación de una zona para una ventana: OCUPADO (si la ventana ya empezó) + RESERVADO vigente con ventana solapada.
 */
export function computeZoneOccupancy(
  reservations: ParkingReservationLike[],
  zoneId: string,
  window: { holdFrom: Date; holdUntil: Date },
  now: Date,
): number {
  return reservations.filter((r) => {
    if (r.zoneId !== zoneId) return false;
    if (r.status === 'OCUPADO') return window.holdFrom.getTime() <= now.getTime();
    if (r.status === 'RESERVADO') {
      if (r.holdUntil.getTime() < now.getTime()) return false; // expirada (expiración perezosa)
      return windowsOverlap(r.holdFrom, r.holdUntil, window.holdFrom, window.holdUntil);
    }
    return false;
  }).length;
}

/**
 * Selección automática: primera zona activa por sortOrder con espacio. Null si ninguna.
 */
export function pickZone(
  zones: ParkingZoneLike[],
  reservations: ParkingReservationLike[],
  window: { holdFrom: Date; holdUntil: Date },
  now: Date,
): ParkingZoneLike | null {
  const ordered = zones
    .filter((z) => z.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const zone of ordered) {
    if (computeZoneOccupancy(reservations, zone.id, window, now) < zone.capacity) return zone;
  }
  return null;
}

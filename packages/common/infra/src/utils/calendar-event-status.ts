export function normalizeCalendarEventStatus(
  status: string | null | undefined
) {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized === 'cancelled' ? 'canceled' : normalized;
}

export function isCalendarEventCanceled(status: string | null | undefined) {
  return normalizeCalendarEventStatus(status) === 'canceled';
}

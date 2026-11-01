// Presentation state only: approval still validates the current request snapshot.
export function permissionDisclosureKey(sessionId, request) {
  return JSON.stringify([sessionId, request.id, request.tool, request.details]);
}
export function restoreDisclosures(previous, current) {
  const opened = new Set(Array.from(previous).filter(d => d.open).map(d => d.dataset.permissionKey));
  for (const detail of current) detail.open = opened.has(detail.dataset.permissionKey);
}

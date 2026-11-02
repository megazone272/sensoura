/**
 * Lightweight device-id validation used by the Socket.IO hook.
 *
 * This is a development/operational gate, not a cryptographic identity check.
 * A real deployment would replace this with device certificate / provisioning
 * validation tied to the production identity provider.
 */

export function validateDeviceId(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  // Allow only simple identifiers for now so we can reject obviously fake
  // client-supplied values during development without being overly prescriptive.
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(trimmed);
}

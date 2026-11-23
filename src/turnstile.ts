export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export async function verifyTurnstile(
  secret: string,
  token: string | undefined,
  remoteip: string | undefined,
): Promise<'verified' | 'denied' | 'unavailable'> {
  if (!token || token.length > 2048) return 'denied';
  try {
    const response = await fetch(TURNSTILE_ORIGIN + '/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip }),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!response.ok) return 'unavailable';
    const result = await response.json<{ success?: unknown; 'error-codes'?: string[] }>();
    if (result.success === true) return 'verified';
    if (result.success !== false || result['error-codes']?.some((code) =>
      code === 'internal-error' || code === 'invalid-input-secret' || code === 'missing-input-secret')) {
      return 'unavailable';
    }
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

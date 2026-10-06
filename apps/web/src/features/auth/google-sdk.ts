type GoogleWindow = Window & { google?: { accounts?: unknown } };
let scriptFlight: Promise<void> | undefined;

// Shared GIS script, with independent clients for identity and Calendar authorization.
export function loadGoogleSdk(): Promise<void> {
  if ((window as GoogleWindow).google?.accounts) return Promise.resolve();
  if (scriptFlight) return scriptFlight;
  scriptFlight = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timeout = window.setTimeout(fail, 10_000);
    function fail() {
      window.clearTimeout(timeout); script.remove(); reject(new Error('Google unavailable'));
    }
    script.onerror = fail;
    script.onload = () => {
      window.clearTimeout(timeout);
      if ((window as GoogleWindow).google?.accounts) resolve(); else fail();
    };
    document.head.append(script);
  }).catch((error: unknown) => { scriptFlight = undefined; throw error; });
  return scriptFlight;
}

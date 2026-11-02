// Rohdaten einer Anfrage fuer das Besucherprotokoll (Beweissicherung).
// Genutzt von functions/_middleware.js und functions/besuch-da.js.
// Bewusst NICHT gespeichert: Cookies, Anmeldung und alles, was die IP-Adresse enthaelt.

const WEGLASSEN = new Set([
  'cookie', 'authorization', 'cf-connecting-ip', 'cf-connecting-ipv6', 'cf-pseudo-ipv4',
  'true-client-ip', 'x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-ew-via', 'cdn-loop',
]);

export const rohdaten = (request, jetzt) => {
  const cf = request.cf || {};
  const kopf = {};
  for (const [name, wert] of request.headers) {
    if (!WEGLASSEN.has(name.toLowerCase())) kopf[name] = String(wert).slice(0, 500);
  }
  return {
    zeit_utc: new Date(jetzt).toISOString(),
    methode: request.method,
    url: request.url,
    ray: request.headers.get('cf-ray') || '',
    kennung: request.headers.get('user-agent') || '',
    kopfzeilen: kopf,
    netz: { asn: cf.asn ?? null, organisation: cf.asOrganization || '' },
    ort: {
      land: cf.country || '', region: cf.region || '', stadt: cf.city || '',
      postleitzahl: cf.postalCode || '', zeitzone: cf.timezone || '', kontinent: cf.continent || '',
    },
    verbindung: {
      rechenzentrum: cf.colo || '', http: cf.httpProtocol || '', tls: cf.tlsVersion || '',
      tls_verschluesselung: cf.tlsCipher || '',
    },
  };
};

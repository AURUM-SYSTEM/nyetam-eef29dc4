// Browser-side GPS capture helper.
// Reverse geocoding is handled server-side via aurum.functions.reverseGeocode
// (Nominatim requires a custom User-Agent header).

export type CapturedLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt: number;
};

export async function captureGps(
  timeoutMs = 10_000,
  // 5 minutes par défaut : une position récente en cache convient pour une
  // capture ponctuelle (position de l'agent). À forcer à 0 pour les points
  // d'un périmètre (handleAddBoundaryPoint) — sinon le navigateur peut
  // renvoyer la MÊME position en cache pour plusieurs points tapés à la
  // suite sans déplacement significatif, produisant un polygone dégénéré
  // (points quasi identiques) dont l'aire calcule correctement... à zéro.
  maximumAgeMs = 5 * 60_000,
): Promise<CapturedLocation | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: CapturedLocation | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const t = setTimeout(() => done(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(t);
        done({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        });
      },
      () => {
        clearTimeout(t);
        done(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maximumAgeMs },
    );
  });
}

export type ResolvedLocation = {
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  source: "gps" | "text" | "none";
};

// Browser-side GPS capture helper.
// Reverse geocoding is handled server-side via aurum.functions.reverseGeocode
// (Nominatim requires a custom User-Agent header).

export type CapturedLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt: number;
};

// En dessous de cette précision (mètres), on arrête d'attendre — inutile de
// consommer tout le budget de temps si un bon signal arrive vite.
const GOOD_ENOUGH_ACCURACY_M = 15;

export async function captureGps(
  // 20s, pas 10 : un premier fix GPS (surtout en intérieur, ou après un
  // moment sans utiliser le GPS) peut légitimement prendre plus de 10s à
  // s'établir. Avec l'ancien délai, le tout premier point renvoyé par le
  // téléphone (souvent une estimation réseau grossière, en attendant que le
  // GPS s'affine) était accepté tel quel avant que la puce n'ait eu le temps
  // de verrouiller un vrai signal satellite.
  timeoutMs = 20_000,
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
    let best: CapturedLocation | null = null;
    let watchId: number | null = null;

    const finish = (v: CapturedLocation | null) => {
      if (settled) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      resolve(v);
    };

    // watchPosition (pas getCurrentPosition) : sur mobile, les toutes
    // premières positions renvoyées sont souvent une estimation réseau
    // grossière pendant que le GPS s'affine progressivement. On surveille
    // les mises à jour successives et on garde la MEILLEURE précision vue
    // dans la fenêtre de temps impartie, au lieu de se contenter de la
    // toute première réponse.
    const t = setTimeout(() => finish(best), timeoutMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const candidate: CapturedLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        };
        if (!best || (candidate.accuracy ?? Infinity) < (best.accuracy ?? Infinity)) {
          best = candidate;
        }
        if (candidate.accuracy != null && candidate.accuracy <= GOOD_ENOUGH_ACCURACY_M) {
          clearTimeout(t);
          finish(candidate);
        }
      },
      () => {
        // Erreur de géolocalisation : on garde un éventuel candidat déjà
        // obtenu plutôt que d'échouer sur une erreur transitoire.
        if (!best) { clearTimeout(t); finish(null); }
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

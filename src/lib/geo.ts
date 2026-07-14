// Browser-side GPS capture helper.
// Reverse geocoding is handled server-side via aurum.functions.reverseGeocode
// (Nominatim requires a custom User-Agent header).
import { debugLog, debugWarn, debugError } from "./debug-log";

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

    const finish = (v: CapturedLocation | null, reason: string) => {
      if (settled) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      debugLog("[GPS DEBUG] captureGps resolved", { reason, value: v });
      resolve(v);
    };

    // watchPosition (pas getCurrentPosition) : sur mobile, les toutes
    // premières positions renvoyées sont souvent une estimation réseau
    // grossière pendant que le GPS s'affine progressivement. On surveille
    // les mises à jour successives.
    //
    // BUG CORRIGÉ ICI : `best` retenait auparavant la position ayant la
    // MEILLEURE PRÉCISION vue sur toute la fenêtre, pas la plus RÉCENTE.
    // En extérieur, une première lecture peut déjà être bonne (ex. ±12m) ;
    // si l'agent se déplace ensuite pendant que la fenêtre de capture
    // tourne encore, les positions suivantes (qui reflètent son vrai
    // déplacement) ne remplaçaient l'ancienne QUE si leur précision était
    // meilleure — ce qui n'arrive pas forcément. La fonction renvoyait donc
    // la position d'où l'agent se trouvait au moment de la première bonne
    // lecture, pas sa position actuelle : "la valeur reste figée sur le
    // premier point malgré le déplacement". `best` est maintenant TOUJOURS
    // la dernière position reçue ; la précision ne sert plus qu'à décider
    // si on peut arrêter d'attendre plus tôt, jamais à choisir quelle
    // lecture garder.
    debugLog("[GPS DEBUG] captureGps starting watchPosition", { timeoutMs, maximumAgeMs });
    const t = setTimeout(() => finish(best, "outer-timeout"), timeoutMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const candidate: CapturedLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        };
        debugLog("[GPS DEBUG] watchPosition success callback", candidate);
        best = candidate;
        debugLog("[GPS DEBUG] updated best (=latest) candidate", best);
        if (candidate.accuracy != null && candidate.accuracy <= GOOD_ENOUGH_ACCURACY_M) {
          clearTimeout(t);
          finish(candidate, "good-enough-accuracy");
        }
      },
      (err) => {
        // BUG CORRIGÉ ICI : watchPosition() peut légitimement déclencher
        // cette erreur plusieurs fois pendant qu'il continue de chercher un
        // signal en arrière-plan (ex. TIMEOUT interne sur une tentative,
        // POSITION_UNAVAILABLE momentané) — ce n'est PAS un échec définitif.
        // L'ancien code arrêtait tout (clearWatch + resolve(null)) dès la
        // toute première erreur si aucun point n'avait encore été obtenu,
        // ce qui pouvait tuer la capture avant même que le GPS n'ait eu la
        // moindre chance de verrouiller un signal — expliquant "plus aucun
        // nouveau point capturé". Seul le timeout GLOBAL (ci-dessus) ou une
        // erreur de PERMISSION (définitive, jamais transitoire) doivent
        // mettre fin à la capture.
        debugWarn("[GPS DEBUG] watchPosition error callback (peut être transitoire)", {
          code: err.code, message: err.message, hasBestAlready: !!best,
        });
        if (err.code === err.PERMISSION_DENIED) {
          debugError("[GPS DEBUG] permission de géolocalisation refusée — abandon immédiat");
          clearTimeout(t);
          finish(best, "permission-denied");
        }
        // Sinon (POSITION_UNAVAILABLE / TIMEOUT) : on NE résout PAS ici, on
        // laisse watchPosition continuer d'essayer jusqu'au timeout global.
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

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

// watchPosition() plutôt que getCurrentPosition() : sur mobile, un premier
// fix GPS s'affine progressivement sur plusieurs secondes (la toute
// première position peut être une estimation réseau grossière, remplacée
// ensuite par un vrai fix satellite). On surveille les mises à jour
// successives pendant la fenêtre de temps impartie, pour donner sa chance
// à une meilleure précision plutôt que d'accepter la toute première réponse.
//
// Deux bugs ont déjà été commis ici par le passé et sont documentés pour ne
// pas être réintroduits :
//   1. NE JAMAIS abandonner sur une erreur transitoire (POSITION_UNAVAILABLE
//      / TIMEOUT internes) — watchPosition() continue de chercher un signal
//      en arrière-plan après une erreur ; seule une erreur PERMISSION_DENIED
//      (définitive) doit interrompre la capture avant le timeout global.
//   2. NE JAMAIS retenir la position ayant la MEILLEURE précision vue sur
//      toute la fenêtre plutôt que la plus RÉCENTE — sinon, si l'agent se
//      déplace pendant que la capture attend encore une meilleure
//      précision, la valeur renvoyée reflète une position dépassée, pas sa
//      position actuelle. La précision ne sert qu'à décider si on peut
//      arrêter d'attendre plus tôt (`GOOD_ENOUGH_ACCURACY_M`), jamais à
//      choisir quelle lecture garder.
export async function captureGps(
  // 20s : un premier fix GPS (surtout en intérieur, ou après un moment sans
  // utiliser le GPS) peut légitimement prendre plus de 10s à s'établir.
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
    let latest: CapturedLocation | null = null;
    let watchId: number | null = null;

    const finish = (v: CapturedLocation | null, reason: string) => {
      if (settled) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      debugLog("[GPS DEBUG] captureGps resolved", { reason, value: v });
      resolve(v);
    };

    debugLog("[GPS DEBUG] captureGps starting watchPosition", { timeoutMs, maximumAgeMs });
    const t = setTimeout(() => finish(latest, "outer-timeout"), timeoutMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const candidate: CapturedLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        };
        debugLog("[GPS DEBUG] watchPosition success callback", candidate);
        latest = candidate; // toujours la plus récente, jamais la "meilleure historique"
        if (candidate.accuracy != null && candidate.accuracy <= GOOD_ENOUGH_ACCURACY_M) {
          clearTimeout(t);
          finish(candidate, "good-enough-accuracy");
        }
      },
      (err) => {
        debugWarn("[GPS DEBUG] watchPosition error callback (peut être transitoire)", {
          code: err.code, message: err.message, hasLatestAlready: !!latest,
        });
        if (err.code === err.PERMISSION_DENIED) {
          debugError("[GPS DEBUG] permission de géolocalisation refusée — abandon immédiat");
          clearTimeout(t);
          finish(latest, "permission-denied");
        }
        // POSITION_UNAVAILABLE / TIMEOUT : transitoire, on laisse
        // watchPosition continuer d'essayer jusqu'au timeout global.
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

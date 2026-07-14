// Browser-side GPS capture helper.
// Reverse geocoding is handled server-side via aurum.functions.reverseGeocode
// (Nominatim requires a custom User-Agent header).
import { debugLog, debugError } from "./debug-log";

export type CapturedLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt: number;
};

// Retour à getCurrentPosition() (lecture ponctuelle) — le mécanisme
// d'origine du projet, avant l'introduction d'un watchPosition() avec
// sélection de candidat pendant cette session. Cette réécriture a produit
// deux bugs successifs (abandon prématuré sur erreur transitoire, puis
// sélection par précision figeant la valeur sur une lecture ancienne au
// lieu de la plus récente) — signe que la complexité ajoutée n'était pas
// justifiée. getCurrentPosition() délègue à l'OS/navigateur la décision de
// "quand une lecture est assez bonne", ce que watchPosition nous forçait à
// réimplémenter nous-mêmes, avec les bugs que ça a entraînés.
//
// Les deux améliorations qui restaient valables indépendamment de cette
// réécriture sont conservées : maximumAge paramétrable (0 pour forcer une
// lecture fraîche sur chaque point de périmètre — voir plus bas) et un
// timeout à 20s (un premier fix GPS, surtout en intérieur, peut légitimement
// prendre plus de 10s à s'établir).
export async function captureGps(
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
    const done = (v: CapturedLocation | null, reason: string) => {
      if (settled) return;
      settled = true;
      debugLog("[GPS DEBUG] captureGps resolved", { reason, value: v });
      resolve(v);
    };
    debugLog("[GPS DEBUG] captureGps calling getCurrentPosition", { timeoutMs, maximumAgeMs });
    const t = setTimeout(() => done(null, "timeout"), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(t);
        const result: CapturedLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        };
        debugLog("[GPS DEBUG] getCurrentPosition success", result);
        done(result, "success");
      },
      (err) => {
        clearTimeout(t);
        debugError("[GPS DEBUG] getCurrentPosition error", { code: err.code, message: err.message });
        done(null, "error");
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

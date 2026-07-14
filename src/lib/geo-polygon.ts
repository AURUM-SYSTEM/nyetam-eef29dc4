// Géométrie de périmètre — fonctions pures, sans dépendance DOM/navigateur,
// importables aussi bien côté client (aperçu immédiat) que côté serveur
// (recalcul de sécurité dans createParcelle — on ne fait jamais confiance
// au calcul client pour la valeur stockée).

export type LatLng = { lat: number; lng: number };

// Rejette les points non finis (NaN, Infinity — ex. capture GPS corrompue
// ou donnée en cache altérée) plutôt que de les laisser propager un NaN
// silencieux jusqu'au résultat final.
function finitePoints(points: LatLng[]): LatLng[] {
  return points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export function computePolygonCenter(points: LatLng[]): LatLng {
  const valid = finitePoints(points);
  const n = valid.length;
  const lat = valid.reduce((s, p) => s + p.lat, 0) / n;
  const lng = valid.reduce((s, p) => s + p.lng, 0) / n;
  return { lat, lng };
}

const EARTH_RADIUS_M = 6371000;

// Formule du lacet (shoelace) sur une projection équirectangulaire simple
// (mètres autour de la latitude moyenne du polygone) — approximation
// suffisante à l'échelle d'une parcelle agricole.
export function computePolygonAreaHectares(points: LatLng[]): number {
  const validPoints = finitePoints(points);
  if (validPoints.length < 3) return 0;
  const meanLatRad = (validPoints.reduce((s, p) => s + p.lat, 0) / validPoints.length) * (Math.PI / 180);
  const toXY = (p: LatLng) => ({
    x: (p.lng * Math.PI / 180) * Math.cos(meanLatRad) * EARTH_RADIUS_M,
    y: (p.lat * Math.PI / 180) * EARTH_RADIUS_M,
  });
  const pts = validPoints.map(toXY);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  const areaM2 = Math.abs(sum) / 2;
  return areaM2 / 10000;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// La plus grande distance entre deux points du périmètre — sert à détecter
// un polygone "dégénéré" (points trop rapprochés par rapport à la
// précision GPS obtenue) plutôt que de laisser une surface proche de zéro
// s'afficher sans explication.
export function maxPairwiseDistanceMeters(points: LatLng[]): number {
  const valid = finitePoints(points);
  let max = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const d = haversineMeters(valid[i], valid[j]);
      if (d > max) max = d;
    }
  }
  return max;
}

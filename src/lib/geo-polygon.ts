// Géométrie de périmètre — fonctions pures, sans dépendance DOM/navigateur,
// importables aussi bien côté client (aperçu immédiat) que côté serveur
// (recalcul de sécurité dans createParcelle — on ne fait jamais confiance
// au calcul client pour la valeur stockée).

export type LatLng = { lat: number; lng: number };

export function computePolygonCenter(points: LatLng[]): LatLng {
  const n = points.length;
  const lat = points.reduce((s, p) => s + p.lat, 0) / n;
  const lng = points.reduce((s, p) => s + p.lng, 0) / n;
  return { lat, lng };
}

const EARTH_RADIUS_M = 6371000;

// Formule du lacet (shoelace) sur une projection équirectangulaire simple
// (mètres autour de la latitude moyenne du polygone) — approximation
// suffisante à l'échelle d'une parcelle agricole.
export function computePolygonAreaHectares(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const meanLatRad = (points.reduce((s, p) => s + p.lat, 0) / points.length) * (Math.PI / 180);
  const toXY = (p: LatLng) => ({
    x: (p.lng * Math.PI / 180) * Math.cos(meanLatRad) * EARTH_RADIUS_M,
    y: (p.lat * Math.PI / 180) * EARTH_RADIUS_M,
  });
  const pts = points.map(toXY);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  const areaM2 = Math.abs(sum) / 2;
  return areaM2 / 10000;
}

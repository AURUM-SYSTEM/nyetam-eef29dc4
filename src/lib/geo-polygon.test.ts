import { describe, expect, it } from "vitest";
import { computePolygonAreaHectares, computePolygonCenter, haversineMeters, maxPairwiseDistanceMeters, type LatLng } from "./geo-polygon";

// Petit carré ~111m de côté autour de l'équateur/méridien de Greenwich
// (0.001° ≈ 111m en latitude) — surface attendue ≈ 111m × 111m ≈ 1.23 ha.
const SQUARE: LatLng[] = [
  { lat: 0, lng: 0 },
  { lat: 0.001, lng: 0 },
  { lat: 0.001, lng: 0.001 },
  { lat: 0, lng: 0.001 },
];

describe("computePolygonAreaHectares", () => {
  it("calcule une surface positive pour un polygone valide (3+ points)", () => {
    const area = computePolygonAreaHectares(SQUARE);
    expect(area).toBeGreaterThan(0);
    // ≈ 1.23 ha pour ce carré — tolérance large pour l'approximation
    // équirectangulaire utilisée par la fonction.
    expect(area).toBeCloseTo(1.23, 1);
  });

  it("calcule correctement pour un triangle (cas minimal, exactement 3 points)", () => {
    const triangle: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0 },
      { lat: 0, lng: 0.001 },
    ];
    expect(computePolygonAreaHectares(triangle)).toBeGreaterThan(0);
  });

  it("retourne 0 pour un polygone incomplet (moins de 3 points)", () => {
    expect(computePolygonAreaHectares([])).toBe(0);
    expect(computePolygonAreaHectares([{ lat: 0, lng: 0 }])).toBe(0);
    expect(computePolygonAreaHectares([{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }])).toBe(0);
  });

  it("ignore les coordonnées invalides (NaN/Infinity) au lieu de propager un résultat NaN", () => {
    const withGarbage: LatLng[] = [
      ...SQUARE,
      { lat: NaN, lng: 0.0005 },
      { lat: 0.0005, lng: Infinity },
    ];
    const area = computePolygonAreaHectares(withGarbage);
    expect(Number.isFinite(area)).toBe(true);
    expect(area).toBeCloseTo(1.23, 1);
  });

  it("retourne 0 si, une fois les coordonnées invalides filtrées, il ne reste plus assez de points", () => {
    const mostlyGarbage: LatLng[] = [
      { lat: 0, lng: 0 },
      { lat: NaN, lng: 0.001 },
      { lat: 0.001, lng: NaN },
    ];
    expect(computePolygonAreaHectares(mostlyGarbage)).toBe(0);
  });

  it("calcule la surface d'un rectangle réel (80m x 45m) proche de la valeur attendue calculée à la main", () => {
    // Rectangle 80m (est-ouest) x 45m (nord-sud) autour de 4.05°N — décalages
    // en degrés dérivés de la conversion standard (1° lat ≈ 111 320 m,
    // 1° lng ≈ 111 320 × cos(latitude) m), indépendante de la projection
    // équirectangulaire utilisée en interne par computePolygonAreaHectares.
    // Attendu : 80 × 45 = 3600 m² = 0.36 ha.
    const rectangle: LatLng[] = [
      { lat: 4.0511, lng: 9.7679 },
      { lat: 4.0511, lng: 9.76862044 },
      { lat: 4.05150425, lng: 9.76862044 },
      { lat: 4.05150425, lng: 9.7679 },
    ];
    expect(computePolygonAreaHectares(rectangle)).toBeCloseTo(0.36, 2);
  });

  it("calcule une surface positive et cohérente pour un pentagone irrégulier (5 points)", () => {
    const pentagon: LatLng[] = [
      { lat: 4.0511, lng: 9.7679 },
      { lat: 4.0511, lng: 9.7686 },
      { lat: 4.0514, lng: 9.7689 },
      { lat: 4.0517, lng: 9.7684 },
      { lat: 4.0515, lng: 9.7679 },
    ];
    const area = computePolygonAreaHectares(pentagon);
    // Enveloppe grossièrement ~70m x 70m — la surface d'un pentagone inscrit
    // est inférieure à celle du carré englobant, mais du même ordre de
    // grandeur (quelques dixièmes d'hectare), jamais nulle ni aberrante.
    expect(area).toBeGreaterThan(0.1);
    expect(area).toBeLessThan(0.6);
  });
});

describe("haversineMeters", () => {
  it("calcule une distance proche de la valeur attendue (45m, même rectangle que ci-dessus)", () => {
    const a: LatLng = { lat: 4.0511, lng: 9.7679 };
    const b: LatLng = { lat: 4.05150425, lng: 9.7679 };
    expect(haversineMeters(a, b)).toBeCloseTo(45, 0);
  });

  it("retourne 0 pour deux points identiques", () => {
    const p: LatLng = { lat: 4.0511, lng: 9.7679 };
    expect(haversineMeters(p, p)).toBeCloseTo(0, 6);
  });
});

describe("maxPairwiseDistanceMeters", () => {
  it("trouve la plus grande diagonale d'un rectangle réel (~92m)", () => {
    const rectangle: LatLng[] = [
      { lat: 4.0511, lng: 9.7679 },
      { lat: 4.0511, lng: 9.76862044 },
      { lat: 4.05150425, lng: 9.7679 },
    ];
    expect(maxPairwiseDistanceMeters(rectangle)).toBeCloseTo(91.7, 0);
  });

  it("détecte des points quasi identiques (bruit GPS) comme un écart minime", () => {
    const almostSamePoint: LatLng[] = [
      { lat: 4.05110, lng: 9.76790 },
      { lat: 4.05110002, lng: 9.76790001 },
      { lat: 4.05109998, lng: 9.76790002 },
    ];
    expect(maxPairwiseDistanceMeters(almostSamePoint)).toBeLessThan(1);
  });

  it("retourne 0 pour moins de 2 points valides", () => {
    expect(maxPairwiseDistanceMeters([])).toBe(0);
    expect(maxPairwiseDistanceMeters([{ lat: 0, lng: 0 }])).toBe(0);
  });
});

describe("computePolygonCenter", () => {
  it("calcule le centroïde d'un polygone valide", () => {
    const center = computePolygonCenter(SQUARE);
    expect(center.lat).toBeCloseTo(0.0005, 5);
    expect(center.lng).toBeCloseTo(0.0005, 5);
  });

  it("ignore les coordonnées invalides dans le calcul du centre", () => {
    const withGarbage: LatLng[] = [...SQUARE, { lat: NaN, lng: NaN }];
    const center = computePolygonCenter(withGarbage);
    expect(center.lat).toBeCloseTo(0.0005, 5);
    expect(center.lng).toBeCloseTo(0.0005, 5);
  });
});

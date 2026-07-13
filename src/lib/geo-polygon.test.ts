import { describe, expect, it } from "vitest";
import { computePolygonAreaHectares, computePolygonCenter, type LatLng } from "./geo-polygon";

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

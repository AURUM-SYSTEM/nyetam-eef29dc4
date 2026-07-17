import { describe, expect, it } from "vitest";
import { computePolygonAreaHectares, computePolygonCenter, haversineMeters, maxPairwiseDistanceMeters, isDuplicatePoint, DUPLICATE_POINT_THRESHOLD_M, type LatLng } from "./geo-polygon";

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

  it("retourne 0 pour un cas réel de terrain avec point dupliqué (régression) — pas un bug, la géométrie est bien dégénérée", () => {
    // Capture réelle du 14/07 (09:59:06 UTC) : les points 1 et 2 sont
    // rigoureusement identiques (repli GPS sur une estimation réseau
    // ±500m, deux lectures consécutives à 31s d'écart réel ayant renvoyé
    // la même position réseau grossière — voir le journal [GPS DEBUG]
    // correspondant). Avec 2 sommets confondus sur 3, le "triangle" est en
    // réalité un segment de droite : aire nulle par définition géométrique,
    // pas une erreur de calcul. Ce test fige ce cas comme comportement
    // attendu pour éviter qu'un futur changement du calcul d'aire y
    // introduise un résultat non nul incorrect.
    const realWorldDuplicatePoint: LatLng[] = [
      { lat: 3.837167, lng: 10.4472074 },
      { lat: 3.837167, lng: 10.4472074 },
      { lat: 3.8377674, lng: 10.4493149 },
    ];
    expect(computePolygonAreaHectares(realWorldDuplicatePoint)).toBe(0);
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

describe("isDuplicatePoint", () => {
  it("rejette un doublon exact — cas réel de terrain (14/07, minDist=0)", () => {
    // Deux points ajoutés à 95s d'écart réel avec les MÊMES coordonnées
    // exactes (repli GPS réseau ±700m figé sur la même estimation) :
    // {lat:3.8443792, lng:10.4717978} capté deux fois de suite. C'est le
    // point de départ du bug — le contrôle calculait bien minDist=0 mais
    // n'empêchait pas l'ajout. Ce test fige le rejet attendu.
    const existing: LatLng[] = [{ lat: 3.8443792, lng: 10.4717978 }];
    const duplicate: LatLng = { lat: 3.8443792, lng: 10.4717978 };
    expect(isDuplicatePoint(existing, duplicate)).toBe(true);
  });

  it("n'accepte PAS de rejeter un point réellement distinct malgré une précision GPS très mauvaise", () => {
    // Reproduit le cas où deux points sont à 243m l'un de l'autre avec une
    // précision de ±500m — un seuil qui suivrait l'accuracy (l'ancien bug)
    // rejetterait ce point à tort. Le seuil fixe (5m) ne doit PAS le
    // rejeter : 243m est très largement au-dessus de
    // DUPLICATE_POINT_THRESHOLD_M, qu'importe la précision GPS du moment.
    const existing: LatLng[] = [{ lat: 3.837167, lng: 10.4472074 }];
    const distinctButImprecise: LatLng = { lat: 3.8377674, lng: 10.4493149 };
    expect(haversineMeters(existing[0], distinctButImprecise)).toBeGreaterThan(200);
    expect(isDuplicatePoint(existing, distinctButImprecise)).toBe(false);
  });

  it("rejette un point à moins de 5m mais accepte un point à plus de 5m (seuil fixe)", () => {
    const existing: LatLng[] = [{ lat: 4.0511, lng: 9.7679 }];
    // ~2m au nord (0.00002° lat ≈ 2.2m)
    const tooClose: LatLng = { lat: 4.05112, lng: 9.7679 };
    // ~11m au nord (0.0001° lat ≈ 11m)
    const farEnough: LatLng = { lat: 4.0512, lng: 9.7679 };
    expect(isDuplicatePoint(existing, tooClose)).toBe(true);
    expect(isDuplicatePoint(existing, farEnough)).toBe(false);
  });

  it("n'affecte jamais l'aire calculée une fois les doublons exclus du tableau final", () => {
    // Simule le comportement attendu de handleAddBoundaryPoint : un
    // doublon rejeté en amont n'entre jamais dans boundaryPoints, donc le
    // polygone final reste non dégénéré.
    const traced: LatLng[] = [];
    const captured: LatLng[] = [
      { lat: 3.837167, lng: 10.4472074 },
      { lat: 3.837167, lng: 10.4472074 }, // doublon exact — doit être rejeté
      { lat: 3.8377674, lng: 10.4493149 },
      { lat: 3.8380000, lng: 10.4480000 },
    ];
    for (const candidate of captured) {
      if (!isDuplicatePoint(traced, candidate)) traced.push(candidate);
    }
    expect(traced).toHaveLength(3);
    expect(computePolygonAreaHectares(traced)).toBeGreaterThan(0);
  });

  it("utilise DUPLICATE_POINT_THRESHOLD_M = 5m par défaut", () => {
    expect(DUPLICATE_POINT_THRESHOLD_M).toBe(5);
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

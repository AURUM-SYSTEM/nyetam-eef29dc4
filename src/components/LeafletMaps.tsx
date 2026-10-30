// Cartes Leaflet / OpenStreetMap (gratuit, sans clé API) pour AURUM SYSTEM.
//
// Ce fichier n'est JAMAIS importé statiquement — toujours via un
// import() dynamique déclenché côté client (voir les composants
// consommateurs dans supervisor.tsx / record.$type.tsx). Deux raisons :
//   1. Poids : leaflet + react-leaflet n'alourdissent que les pages qui
//      affichent effectivement une carte.
//   2. SSR : leaflet touche au DOM dès la création d'une carte et n'est
//      pas sûr à évaluer côté serveur ; le chargement dynamique dans un
//      useEffect garantit qu'il ne s'exécute jamais pendant le rendu SSR.
import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, LayersControl, LayerGroup, useMap, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./leaflet-theme.css";

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Vue satellite optionnelle — Esri World Imagery, gratuite, sans clé API.
const SATELLITE_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION = "Tiles &copy; Esri";

// Couche de référence (noms de lieux, routes, frontières) superposée à
// l'imagerie satellite — Esri ne fournit ces labels que via ce service
// séparé (contrairement à OSM qui les intègre déjà à ses tuiles "Plan").
// Les deux TileLayer partagent le même pane Leaflet par défaut (tilePane) ;
// `zIndex` (option native de GridLayer, pas une pane séparée) suffit à
// garantir que les labels se dessinent au-dessus de l'imagerie.
const SATELLITE_LABELS_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

// Bascule Plan / Satellite — OpenStreetMap reste la vue par défaut. La
// couche de labels n'existe qu'à l'intérieur du groupe "Satellite" : elle
// s'active/se désactive donc automatiquement avec lui, jamais séparément.
function BaseLayers() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Plan">
        <TileLayer attribution={ATTRIBUTION} url={TILE_URL} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Satellite">
        <LayerGroup>
          <TileLayer attribution={SATELLITE_ATTRIBUTION} url={SATELLITE_TILE_URL} zIndex={1} />
          <TileLayer url={SATELLITE_LABELS_TILE_URL} zIndex={2} />
        </LayerGroup>
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}

function coloredDivIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "aurum-marker",
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(0,0,0,0.55);box-shadow:0 0 0 2px rgba(255,255,255,0.18)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// Recentre/zoome automatiquement la carte sur l'ensemble des points fournis
// (un seul point → simple recentrage ; plusieurs → fitBounds).
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 16);
      return;
    }
    // Cadre serré sur les parcelles : les activités GPS éloignées ne doivent
    // plus dézoomer toute la carte à l'échelle d'une région.
    map.fitBounds(points, { padding: [48, 48], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, JSON.stringify(points)]);
  return null;
}

const FALLBACK_CENTER: [number, number] = [7.37, 12.35]; // Cameroun, simple repli si aucun point

// ============================================================
// Carte de supervision (tableau de bord) — un marqueur par activité
// géolocalisée, couleur selon le module, popup avec les infos parcelle
// quand elles existent.
// ============================================================

export type SupervisorMapMarker = {
  id: string;
  lat: number;
  lng: number;
  moduleColor: string;
  moduleLabel: string;
  city?: string | null;
  culture?: string | null;
  producerName?: string | null;
  cooperativeName?: string | null;
  parcelId?: string | null;
};

export type SupervisorParcelShape = {
  id: string;
  code: string;
  culture: string;
  producerName: string | null;
  cooperativeName: string | null;
  surfaceHa: number | null;
  boundaryPoints: Array<{ lat: number; lng: number }>;
};

export function SupervisorLeafletMap({ markers, parcels = [] }: { markers: SupervisorMapMarker[]; parcels?: SupervisorParcelShape[] }) {
  const polygonPoints = parcels.flatMap((p) => p.boundaryPoints
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180)
    .map((v) => [v.lat, v.lng] as [number, number]));
  const markerPoints = markers.map((m) => [m.lat, m.lng] as [number, number]);
  // Dès qu'un périmètre existe, le zoom se cale sur les contours, pas sur
  // d'anciennes activités qui peuvent se trouver à des dizaines de kilomètres.
  const points = useMemo(() => polygonPoints.length > 0 ? polygonPoints : markerPoints, [markers, parcels]);

  return (
    <MapContainer
      center={points[0] ?? FALLBACK_CENTER}
      zoom={points.length > 0 ? 15 : 5}
      scrollWheelZoom={false}
      className="aurum-leaflet h-[65vh] min-h-[420px] w-full rounded-xl border border-border print:h-[180mm] print:min-h-0 print:rounded-none print:border-0"
    >
      <BaseLayers />
      <FitBounds points={points} />
      {parcels.map((p, index) => {
        const hue = (index * 47 + 142) % 300;
        const color = ["#087F5B", "#D97706", "#2563EB", "#9333EA", "#BE123C", "#0F766E"][index % 6];
        const positions = p.boundaryPoints.map((v) => [v.lat, v.lng] as [number, number]);
        return (
          <Polygon key={p.id} positions={positions} pathOptions={{ color, fillColor: color, fillOpacity: 0.38, weight: 4, opacity: 1, lineJoin: "round" }}>
            <Tooltip permanent direction="center" className="aurum-parcel-label">
              <strong>{p.code}</strong>
            </Tooltip>
            <Popup><strong>{p.code}</strong><div>Culture : {p.culture}</div>{p.producerName && <div>Producteur : {p.producerName}</div>}{p.cooperativeName && <div>Coopérative : {p.cooperativeName}</div>}{p.surfaceHa != null && <div>Superficie : {p.surfaceHa.toFixed(2)} ha</div>}</Popup>
          </Polygon>
        );
      })}
      {markers.filter((m) => !parcels.some((p) => p.id === m.parcelId)).map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={coloredDivIcon(m.moduleColor)}>
          <Popup><strong>{m.moduleLabel}</strong>{m.culture && <div>Culture : {m.culture}</div>}{m.producerName && <div>Producteur : {m.producerName}</div>}{m.cooperativeName && <div>Coopérative : {m.cooperativeName}</div>}{m.city && <div>{m.city}</div>}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

// ============================================================
// Carte d'une parcelle — polygone réel si boundary_points existe, sinon
// simple marqueur au point GPS unique.
// ============================================================

export function ParcelleLeafletMap({
  lat,
  lng,
  boundaryPoints,
}: {
  lat: number | null;
  lng: number | null;
  boundaryPoints: Array<{ lat: number; lng: number }> | null;
}) {
  const hasPolygon = !!boundaryPoints && boundaryPoints.length >= 3;
  const points: Array<[number, number]> = hasPolygon
    ? boundaryPoints!.map((p) => [p.lat, p.lng])
    : lat != null && lng != null
      ? [[lat, lng]]
      : [];

  if (points.length === 0) return null;

  return (
    <MapContainer
      center={points[0]}
      zoom={16}
      scrollWheelZoom
      className="aurum-leaflet h-[280px] w-full rounded-xl border border-border"
    >
      <BaseLayers />
      <FitBounds points={points} />
      {hasPolygon && (
        <Polygon positions={points} pathOptions={{ color: "#087F5B", fillColor: "#087F5B", fillOpacity: 0.22, weight: 3 }} />
      )}
      {hasPolygon && <Polyline positions={[...points, points[0]]} pathOptions={{ color: "#087F5B", weight: 3 }} />}
      {points.map((point, index) => (
        <Marker key={index} position={point} icon={numberedPointIcon(index, index === 0)}>
          <Popup><strong>{index === 0 ? "Départ du tracé" : `Sommet ${index + 1}`}</strong><div>{point[0].toFixed(6)}, {point[1].toFixed(6)}</div></Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

// ============================================================
// Carte de capture de périmètre (agent, écran de saisie) — trace en
// temps réel les points déjà capturés (polygone dès 3 points).
// ============================================================

function numberedPointIcon(index: number, isFirst: boolean): L.DivIcon {
  return L.divIcon({
    className: "aurum-boundary-point",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:${isFirst ? "#087F5B" : "#C9A84C"};color:#101010;border:2px solid white;font-size:11px;font-weight:800;box-shadow:0 2px 8px rgba(0,0,0,.45)">${index + 1}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export function PerimeterLeafletMap({
  points,
  closed = false,
}: {
  points: Array<{ lat: number; lng: number; accuracy?: number }>;
  closed?: boolean;
}) {
  const positions: Array<[number, number]> = points.map((p) => [p.lat, p.lng]);
  if (positions.length === 0) return null;
  const polygonPositions = closed && positions.length >= 3
    ? [...positions, positions[0]]
    : positions;

  return (
    <div className="space-y-1.5">
      <MapContainer
        center={positions[positions.length - 1]}
        zoom={17}
        scrollWheelZoom
        className="aurum-leaflet h-[260px] w-full rounded-xl border border-border"
      >
        <BaseLayers />
        <FitBounds points={positions} />
        {positions.length >= 2 && (
          <Polyline positions={polygonPositions} pathOptions={{ color: "#C9A84C", weight: 4, opacity: 0.95, dashArray: closed ? undefined : "8 7" }} />
        )}
        {closed && positions.length >= 3 && (
          <Polygon positions={positions} pathOptions={{ color: "#C9A84C", fillColor: "#C9A84C", fillOpacity: 0.2, weight: 2 }} />
        )}
        {points.map((point, index) => (
          <Marker key={index} position={[point.lat, point.lng]} icon={numberedPointIcon(index, index === 0)}>
            <Popup>
              <strong>{index === 0 ? "Point de départ" : `Sommet ${index + 1}`}</strong>
              {point.accuracy != null && <div>Précision : ±{Math.round(point.accuracy)} m</div>}
              <div>{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{points.length} sommet{points.length > 1 ? "s" : ""} enregistré{points.length > 1 ? "s" : ""}</span>
        <span>{closed ? "Contour fermé" : "Contour en cours — pointillés"}</span>
      </div>
    </div>
  );
}

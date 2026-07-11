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
import { MapContainer, TileLayer, Marker, Popup, Polygon, LayersControl, LayerGroup, Pane, useMap } from "react-leaflet";
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
const SATELLITE_LABELS_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_LABELS_PANE = "aurum-satellite-labels";

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
          <TileLayer attribution={SATELLITE_ATTRIBUTION} url={SATELLITE_TILE_URL} />
          {/* zIndex 450 : au-dessus des tuiles (tilePane=200) et en dessous
              des marqueurs (markerPane=600) — les labels ne doivent jamais
              masquer les points de la carte. */}
          <Pane name={SATELLITE_LABELS_PANE} style={{ zIndex: 450 }}>
            <TileLayer url={SATELLITE_LABELS_TILE_URL} />
          </Pane>
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
      map.setView(points[0], Math.max(map.getZoom(), 14));
      return;
    }
    map.fitBounds(points, { padding: [30, 30] });
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
};

export function SupervisorLeafletMap({ markers }: { markers: SupervisorMapMarker[] }) {
  const points = useMemo(() => markers.map((m) => [m.lat, m.lng] as [number, number]), [markers]);

  return (
    <MapContainer
      center={points[0] ?? FALLBACK_CENTER}
      zoom={points.length > 0 ? 8 : 5}
      scrollWheelZoom={false}
      className="aurum-leaflet h-64 w-full rounded-xl border border-border"
    >
      <BaseLayers />
      <FitBounds points={points} />
      {markers.map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={coloredDivIcon(m.moduleColor)}>
          <Popup>
            <strong>{m.moduleLabel}</strong>
            {m.culture && <div>Culture : {m.culture}</div>}
            {m.producerName && <div>Producteur : {m.producerName}</div>}
            {m.cooperativeName && <div>Coopérative : {m.cooperativeName}</div>}
            {m.city && <div>{m.city}</div>}
          </Popup>
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
      scrollWheelZoom={false}
      zoomControl={false}
      dragging={hasPolygon}
      className="aurum-leaflet h-36 w-36 shrink-0 rounded-lg border border-border"
    >
      <BaseLayers />
      <FitBounds points={points} />
      {hasPolygon ? (
        <Polygon positions={points} pathOptions={{ color: "#C9A84C", fillColor: "#C9A84C", fillOpacity: 0.25, weight: 2 }} />
      ) : (
        <Marker position={points[0]} icon={coloredDivIcon("#C9A84C")} />
      )}
    </MapContainer>
  );
}

// ============================================================
// Carte de capture de périmètre (agent, écran de saisie) — trace en
// temps réel les points déjà capturés (polygone dès 3 points).
// ============================================================

export function PerimeterLeafletMap({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const positions: Array<[number, number]> = points.map((p) => [p.lat, p.lng]);
  if (positions.length === 0) return null;

  return (
    <MapContainer
      center={positions[positions.length - 1]}
      zoom={17}
      scrollWheelZoom={false}
      zoomControl={false}
      className="aurum-leaflet h-40 w-full rounded-lg border border-border"
    >
      <TileLayer attribution={ATTRIBUTION} url={TILE_URL} />
      <FitBounds points={positions} />
      {positions.length >= 3 ? (
        <Polygon positions={positions} pathOptions={{ color: "#C9A84C", fillColor: "#C9A84C", fillOpacity: 0.2, weight: 2 }} />
      ) : (
        positions.map((p, i) => <Marker key={i} position={p} icon={coloredDivIcon("#C9A84C")} />)
      )}
    </MapContainer>
  );
}

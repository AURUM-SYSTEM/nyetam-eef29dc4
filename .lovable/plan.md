## Plan — AURUM Intelligent Reporting Engine

### 1. Mission type detection + 4 fixed templates

**File:** `src/lib/aurum.functions.ts`

- Extend `type` enum: keep backward compat by adding `"mission_terrain"` and `"enquete"`. Map legacy `"rapport"` → `"mission_terrain"`.
- New helper `detectMissionType(text)` using French/English keywords:
  - `recensement|census|registration` → `recensement`
  - `réunion|reunion|pv|meeting|procès-verbal` → `pv`
  - `enquête|enquete|survey|investigation` → `enquete`
  - `mission|terrain|visite|field|activité` or default → `mission_terrain`
- Replace `generateDocument` schemas with 4 strict templates matching the spec:
  - **MISSION TERRAIN**: Contexte, Objectifs, Activités, Constats, Difficultés, Recommandations, Conclusion
  - **PV RÉUNION**: Participants, Points discutés, Décisions, Actions, Conclusion
  - **RECENSEMENT**: Zone, Méthodologie, Données, Résultats, Observations, Conclusion
  - **ENQUÊTE**: Contexte, Objectif, Méthodologie, Résultats, Analyse, Conclusion
- Strict prompt rules: never invent data; use `"Non spécifié dans les données fournies"` for missing info.
- Add new server fn `suggestImprovements({ doc, type, lang })` → returns `string[]` (3–5 bullet suggestions specific to template type). No mutation of the report.
- Add optional `autoDetect: boolean` and `location?: { city?, country?, lat?, lng? }` to `generateDocument` input.

### 2. Document schema adjustments

Current DB columns (`introduction|faits|declarations|observations|conclusion`) are kept as a generic 5-slot store. To avoid a migration, map each template's sections into these existing columns (concatenate extras into `observations`). Title prefix shows detected type (e.g. `[Mission Terrain] …`).

Alternative (cleaner): add `sections jsonb` and `mission_type text` columns to `documents` table via migration, and `suggestions text[]`. Recommended.

### 3. GPS auto-capture

**Files:** `src/lib/geo.ts` (new), `src/routes/_authenticated.new.tsx`, `src/routes/_authenticated.record.$type.tsx`, `src/hooks/use-sync-engine.ts`

- `captureLocation()`: tries `navigator.geolocation.getCurrentPosition` (10s timeout). On success, reverse-geocode via free Nominatim API (`https://nominatim.openstreetmap.org/reverse?...&format=json`, requires UA header) to get city/country.
- Store `{ lat, lng, city, country, source: 'gps'|'text'|'none' }` in queue item `meta.location` (existing field becomes structured) and pass through to `generateDocument`.
- In template intro, server fn injects: `Lieu : {city}, {country} (GPS)\nCoordonnées : {lat}, {lng}` or fallback `Lieu : Non spécifié`.
- Text fallback: regex/keyword scan for known city patterns done inside the AI prompt (model instructed to extract a `location` field if found).

### 4. Post-generation suggestions UI

**Files:** `src/routes/_authenticated.document.$id.tsx`, `src/components/SuggestionsPanel.tsx` (new), DB migration for `suggestions` column.

- After `generateDocument` returns, sync engine calls `suggestImprovements` and stores result in `documents.suggestions`.
- Document detail page renders a separate `<SuggestionsPanel suggestions={...} />` card under the report — never inline. Clear heading: "💡 Suggestions d'amélioration".
- Suggestions excluded from PDF export.

### 5. Migration

```sql
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS mission_type text,
  ADD COLUMN IF NOT EXISTS suggestions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS location jsonb;
```
(GRANTs already exist on the table.)

### 6. Out of scope / unchanged

- Photo signed-URL pipeline (already fixed)
- Auth, offline queue plumbing, audio transcription
- PDF rendering (only template field mapping changes)

### Technical notes

- Keyword detection runs client-side (cheap, deterministic) before `generateDocument`; AI is only told the chosen `type`, never asked to pick.
- Nominatim has a 1 req/sec rate limit and requires a custom User-Agent → call from a server fn `reverseGeocode(lat,lng)` not the browser.
- Backward compat: existing documents with `type='rapport'` continue to render via fallback mapping.

### Questions before I build

1. **DB migration** — OK to add `mission_type`, `suggestions`, `location` columns? (Cleaner than overloading existing fields.)
2. **Legacy `rapport` type** — keep as alias for `mission_terrain`, or hard-rename in UI selector?
3. **Auto-detect override** — should the "Nouveau document" UI still let the user pick a type manually, or be fully auto?

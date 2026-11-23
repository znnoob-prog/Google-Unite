/// <reference types="google.maps" />
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Navigation, Plus, Search, Trash2, MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { MapLocationRecord } from '../types.ts';

interface MapsWorkspaceProps {
  mapsApiKey: string;
}

const DEFAULT_CENTER = { lat: 37.7749, lng: -122.4194 };

function checkQuotaError(err: unknown) {
  const msg = String(err instanceof Error ? err.message : err);
  if (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('QuotaExceeded') ||
    msg.includes('429')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

interface LocationMarkerProps {
  location: MapLocationRecord;
  isSelected: boolean;
  onSelect: (loc: MapLocationRecord) => void;
  onClose: () => void;
  onDelete: (id: number) => void;
  onSetOrigin: (loc: MapLocationRecord) => void;
  onSetDestination: (loc: MapLocationRecord) => void;
}

const LocationMarker: React.FC<LocationMarkerProps> = ({
  location,
  isSelected,
  onSelect,
  onClose,
  onDelete,
  onSetOrigin,
  onSetDestination,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();

  const pinColors: Record<string, { bg: string; border: string }> = {
    office: { bg: '#2563EB', border: '#1D4ED8' },
    client: { bg: '#16A34A', border: '#15803D' },
    meeting: { bg: '#D97706', border: '#B45309' },
    logistics: { bg: '#475569', border: '#334155' },
  };
  const colors = pinColors[location.category] || pinColors.office;

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: location.lat, lng: location.lng }}
        onClick={() => onSelect(location)}
        title={location.name}
      >
        <Pin background={colors.bg} borderColor={colors.border} glyphColor="#FFFFFF" />
      </AdvancedMarker>
      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={260}>
          <div className="p-1 text-slate-900 space-y-2">
            <div>
              <div className="font-semibold text-sm">{location.name}</div>
              <div className="text-xs text-slate-600">{location.address}</div>
              <div className="text-[11px] text-slate-500 mt-0.5 capitalize">
                {location.category} · {location.isShared ? 'Shared team pin' : 'Private pin'}
              </div>
            </div>
            {location.notes && <p className="text-xs text-slate-700">{location.notes}</p>}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => onSetOrigin(location)}
                className="px-2 py-1 text-[11px] font-medium rounded bg-slate-100 hover:bg-slate-200 text-slate-800"
              >
                Set Origin
              </button>
              <button
                type="button"
                onClick={() => onSetDestination(location)}
                className="px-2 py-1 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-700 text-white"
              >
                Route Here
              </button>
              <button
                type="button"
                onClick={() => onDelete(location.id)}
                className="px-2 py-1 text-[11px] font-medium rounded bg-red-50 hover:bg-red-100 text-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface MapInnerProps {
  locations: MapLocationRecord[];
  onSaveLocation: (loc: {
    placeId: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    category: 'office' | 'client' | 'meeting' | 'logistics';
    notes: string;
    isShared: boolean;
  }) => Promise<void>;
  onDeleteLocation: (id: number) => Promise<void>;
}

const MapWorkspaceInner: React.FC<MapInnerProps> = ({
  locations,
  onSaveLocation,
  onDeleteLocation,
}) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const [draftPlace, setDraftPlace] = useState<{
    placeId: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [draftCategory, setDraftCategory] = useState<'office' | 'client' | 'meeting' | 'logistics'>('office');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftShared, setDraftShared] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedLoc, setSelectedLoc] = useState<MapLocationRecord | null>(null);

  // Route calculation state
  const [originLoc, setOriginLoc] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [destLoc, setDestLoc] = useState<{ label: string; lat: number; lng: number } | null>(null);
  const [travelMode, setTravelMode] = useState<'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT'>('DRIVING');
  const [routeSummary, setRouteSummary] = useState<{ distanceKm: string; durationMin: number } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!placesLib || !query.trim()) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setSearching(true);
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
        }
        const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: sessionTokenRef.current,
        });
        if (!cancelled) {
          setSuggestions(res.suggestions ?? []);
        }
      } catch (err) {
        checkQuotaError(err);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placesLib, query]);

  const handleSelectSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!placesLib || !suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'viewport', 'id'],
      });
      sessionTokenRef.current = null;
      setSuggestions([]);
      setQuery('');

      if (place.location) {
        const lat = place.location.lat();
        const lng = place.location.lng();
        setDraftPlace({
          placeId: place.id || '',
          name: place.displayName || 'Selected Place',
          address: place.formattedAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          lat,
          lng,
        });
        if (map) {
          if (place.viewport) {
            map.fitBounds(place.viewport);
          } else {
            map.setCenter({ lat, lng });
            map.setZoom(14);
          }
        }
      }
    } catch (err) {
      checkQuotaError(err);
    }
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftPlace) return;
    setSaving(true);
    try {
      await onSaveLocation({
        ...draftPlace,
        category: draftCategory,
        notes: draftNotes,
        isShared: draftShared,
      });
      setDraftPlace(null);
      setDraftNotes('');
    } finally {
      setSaving(false);
    }
  };

  // Compute route using modern Routes SDK wrapper (Route.computeRoutes)
  const handleComputeRoute = useCallback(async () => {
    if (!routesLib || !map || !originLoc || !destLoc) return;
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    setRouteError(null);
    setRouteSummary(null);
    setRouteLoading(true);

    try {
      const request = {
        origin: { lat: originLoc.lat, lng: originLoc.lng },
        destination: { lat: destLoc.lat, lng: destLoc.lng },
        travelMode,
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
      };
      const { routes } = await (routesLib.Route as unknown as {
        computeRoutes: (req: unknown) => Promise<{
          routes: Array<{
            distanceMeters?: number;
            durationMillis?: number;
            viewport?: google.maps.LatLngBounds;
            createPolylines: () => google.maps.Polyline[];
          }>;
        }>;
      }).computeRoutes(request);

      if (!routes || routes.length === 0) {
        setRouteError('No route found for the selected travel mode.');
        return;
      }

      const primary = routes[0];
      const lines = primary.createPolylines();
      lines.forEach((p) => {
        p.setOptions({ strokeColor: '#2563EB', strokeWeight: 5 });
        p.setMap(map);
      });
      polylinesRef.current = lines;

      if (primary.viewport) {
        map.fitBounds(primary.viewport);
      }

      setRouteSummary({
        distanceKm: ((primary.distanceMeters ?? 0) / 1000).toFixed(1),
        durationMin: Math.max(1, Math.round((primary.durationMillis ?? 0) / 60000)),
      });
    } catch (err: unknown) {
      checkQuotaError(err);
      setRouteError(err instanceof Error ? err.message : 'Unable to compute route.');
    } finally {
      setRouteLoading(false);
    }
  }, [routesLib, map, originLoc, destLoc, travelMode]);

  useEffect(() => {
    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, []);

  const focusLocation = (loc: MapLocationRecord) => {
    setSelectedLoc(loc);
    if (map) {
      map.panTo({ lat: loc.lat, lng: loc.lng });
      map.setZoom(14);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Controls Panel */}
      <div className="lg:col-span-4 space-y-4">
        {/* Autocomplete Place Search */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Search Places (Places API New)
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search address, office, or venue..."
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {searching && <p className="text-xs text-slate-500">Searching places...</p>}
          {suggestions.length > 0 && (
            <ul className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 max-h-52 overflow-y-auto">
              {suggestions.map((s, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    onClick={() => void handleSelectSuggestion(s)}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    {s.placePrediction?.text.text}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {draftPlace && (
            <form onSubmit={handleSaveDraft} className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <div>
                <div className="text-sm font-semibold">{draftPlace.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{draftPlace.address}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value as typeof draftCategory)}
                  className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                >
                  <option value="office">Office</option>
                  <option value="client">Client Site</option>
                  <option value="meeting">Meeting Venue</option>
                  <option value="logistics">Logistics</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 px-2">
                  <input
                    type="checkbox"
                    checked={draftShared}
                    onChange={(e) => setDraftShared(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Share with team
                </label>
              </div>
              <input
                type="text"
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                placeholder="Optional site notes..."
                className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : 'Save Pin to SQL'}
                </button>
                <button
                  type="button"
                  onClick={() => setDraftPlace(null)}
                  className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Route Planner (Routes API) */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-sm font-semibold">Route Planner</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">Origin: </span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {originLoc ? originLoc.label : 'Click any pin and choose Set Origin'}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500">Destination: </span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {destLoc ? destLoc.label : 'Click any pin and choose Route Here'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={travelMode}
                onChange={(e) => setTravelMode(e.target.value as typeof travelMode)}
                className="flex-1 h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              >
                <option value="DRIVING">Driving</option>
                <option value="WALKING">Walking</option>
                <option value="BICYCLING">Bicycling</option>
                <option value="TRANSIT">Transit</option>
              </select>
              <button
                type="button"
                disabled={!originLoc || !destLoc || routeLoading}
                onClick={() => void handleComputeRoute()}
                className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap"
              >
                {routeLoading ? 'Routing...' : 'Compute Route'}
              </button>
            </div>
            {routeSummary && (
              <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 font-mono text-xs tabular-nums">
                {routeSummary.distanceKm} km · {routeSummary.durationMin} min
              </div>
            )}
            {routeError && (
              <p className="text-xs text-red-600 dark:text-red-400">{routeError}</p>
            )}
          </div>
        </div>

        {/* Saved Locations List */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold">Saved Locations</h3>
            <span className="font-mono text-xs text-slate-500 tabular-nums">{locations.length}</span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
            {locations.length === 0 ? (
              <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
                Search for an address above to pin your first location to Cloud SQL.
              </div>
            ) : (
              locations.map((loc) => (
                <div
                  key={loc.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <button
                    type="button"
                    onClick={() => focusLocation(loc)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {loc.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {loc.category} · {loc.address}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteLocation(loc.id)}
                    className="p-1.5 rounded text-slate-400 hover:text-red-600"
                    aria-label={`Delete ${loc.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right Interactive Map */}
      <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden h-[460px] lg:h-[680px]">
        <Map
          mapId="DEMO_MAP_ID"
          defaultCenter={locations[0] ? { lat: locations[0].lat, lng: locations[0].lng } : DEFAULT_CENTER}
          defaultZoom={locations[0] ? 11 : 4}
          gestureHandling="greedy"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          {locations.map((loc) => (
            <LocationMarker
              key={loc.id}
              location={loc}
              isSelected={selectedLoc?.id === loc.id}
              onSelect={setSelectedLoc}
              onClose={() => setSelectedLoc(null)}
              onDelete={(id) => void onDeleteLocation(id)}
              onSetOrigin={(l) => setOriginLoc({ label: l.name, lat: l.lat, lng: l.lng })}
              onSetDestination={(l) => setDestLoc({ label: l.name, lat: l.lat, lng: l.lng })}
            />
          ))}
          {draftPlace && (
            <AdvancedMarker position={{ lat: draftPlace.lat, lng: draftPlace.lng }} title={draftPlace.name}>
              <Pin background="#0F172A" borderColor="#020617" glyphColor="#FFFFFF" />
            </AdvancedMarker>
          )}
        </Map>
      </div>
    </div>
  );
};

export const MapsWorkspace: React.FC<MapsWorkspaceProps> = ({ mapsApiKey }) => {
  const { apiFetch, lastSyncEvent } = useAuth();
  const [locations, setLocations] = useState<MapLocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLocations = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch<{ locations: MapLocationRecord[] }>('/api/maps/locations');
      setLocations(res.locations);
    } catch (err: any) {
      setError(err?.message || 'Failed to load locations.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  useEffect(() => {
    if (lastSyncEvent?.type === 'maps:updated') {
      void loadLocations();
    }
  }, [lastSyncEvent, loadLocations]);

  const handleSaveLocation = async (loc: {
    placeId: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    category: 'office' | 'client' | 'meeting' | 'logistics';
    notes: string;
    isShared: boolean;
  }) => {
    await apiFetch('/api/maps/locations', {
      method: 'POST',
      body: JSON.stringify(loc),
    });
    await loadLocations();
  };

  const handleDeleteLocation = async (id: number) => {
    await apiFetch(`/api/maps/locations/${id}`, { method: 'DELETE' });
    await loadLocations();
  };

  if (!mapsApiKey) {
    return (
      <div className="p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-3">
        <MapPin className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="font-display text-base font-semibold">Google Maps Key Unavailable</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
          Configure <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> in AI Studio Secrets to render interactive maps, Place Autocomplete, and Routes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {loading ? (
        <div className="h-[500px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
      ) : (
        <APIProvider
          apiKey={mapsApiKey}
          language="en"
          region="US"
        >
          <MapWorkspaceInner
            locations={locations}
            onSaveLocation={handleSaveLocation}
            onDeleteLocation={handleDeleteLocation}
          />
        </APIProvider>
      )}
    </div>
  );
};

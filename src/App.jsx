import React, { useState, useEffect } from 'react';
import { Search, Map as MapIcon, List, Navigation, MapPin, Loader2, ChevronUp, ChevronDown, SlidersHorizontal, Info } from 'lucide-react';
import MapboxMap from './components/LeafletMap';
import RoadList from './components/RoadList';
import RoadDetail from './components/RoadDetail';
import LocationSearch from './components/LocationSearch';
import Terrain3D from './components/Terrain3D';
import { fetchRoads } from './services/overpass';
import { calculateScores } from './services/scoring';
import { getCachedRoads, saveToCache } from './services/cache';
import * as turf from '@turf/turf';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

function App() {
  const [location, setLocation] = useState(null);
  const [roads, setRoads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRoad, setSelectedRoad] = useState(null);
  const [generatedTurns, setGeneratedTurns] = useState([]);
  const [allRoads, setAllRoads] = useState([]); // all fetched roads, unfiltered
  const [view, setView] = useState('map'); // 'map' or 'list'
  const [radius, setRadius] = useState(10);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [selectedRoadElevation, setSelectedRoadElevation] = useState(null);
  
  // Custom thresholds
  const [minScore, setMinScore] = useState(30);
  const [minLength, setMinLength] = useState(2);
  const [maxHouseDensity, setMaxHouseDensity] = useState(15);

  // Load cached roads on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem('touge_roads');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) setRoads(parsed);
      }
    } catch (e) {
      localStorage.removeItem('touge_roads');
    }
    handleAutoDetect();
  }, []);

  // Cache roads — strip heavy GeoJSON objects before saving to avoid mobile storage crashes
  useEffect(() => {
    if (roads.length > 0) {
      try {
        const stripped = roads.map(({ lineString, ...rest }) => rest);
        localStorage.setItem('touge_roads', JSON.stringify(stripped));
      } catch (e) {
        // Storage quota exceeded on mobile — clear and move on
        localStorage.removeItem('touge_roads');
      }
    }
  }, [roads]);

  const handleAutoDetect = () => {
    setLoading(true);
    if ("geolocation" in navigator) {
      const timeoutId = setTimeout(() => {
        // Fallback to Boston if geolocation is too slow (5 seconds)
        const defaultLoc = { lat: 42.3601, lon: -71.0589 };
        setLocation(defaultLoc);
        searchNear(defaultLoc.lat, defaultLoc.lon);
        setError("Geolocation too slow. Defaulting to Boston.");
      }, 15000);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timeoutId);
          const { latitude, longitude } = position.coords;
          setLocation({ lat: latitude, lon: longitude });
          searchNear(latitude, longitude);
        },
        (err) => {
          clearTimeout(timeoutId);
          const defaultLoc = { lat: 42.3601, lon: -71.0589 };
          setLocation(defaultLoc);
          searchNear(defaultLoc.lat, defaultLoc.lon);
          setError("Location access denied. Showing Boston area.");
          setLoading(false);
        }
      );
    } else {
      const defaultLoc = { lat: 42.3601, lon: -71.0589 };
      setLocation(defaultLoc);
      searchNear(defaultLoc.lat, defaultLoc.lon);
      setLoading(false);
    }
  };

  const handleSelectRoad = (road, isShift) => {
    if (isShift && selectedRoad && selectedRoad.id !== road.id) {
      // Combine road with selectedRoad
      const r1 = selectedRoad.coordinates;
      const r2 = road.coordinates;
      
      const d1 = turf.distance(turf.point(r1[0]), turf.point(r2[0]));
      const d2 = turf.distance(turf.point(r1[0]), turf.point(r2[r2.length-1]));
      const d3 = turf.distance(turf.point(r1[r1.length-1]), turf.point(r2[0]));
      const d4 = turf.distance(turf.point(r1[r1.length-1]), turf.point(r2[r2.length-1]));
      
      const minDistance = Math.min(d1, d2, d3, d4);
      let newCoords = [];
      
      if (minDistance === d3) {
        newCoords = [...r1, ...r2];
      } else if (minDistance === d4) {
        newCoords = [...r1, ...[...r2].reverse()];
      } else if (minDistance === d1) {
        newCoords = [...[...r1].reverse(), ...r2];
      } else {
        newCoords = [...r2, ...r1];
      }
      
      const combinedRoad = {
        id: `${selectedRoad.id}-${road.id}`,
        name: `${selectedRoad.name || 'Unnamed'} + ${road.name || 'Unnamed'}`,
        type: road.type,
        tags: { ...selectedRoad.tags, ...road.tags },
        coordinates: newCoords,
        hasMajorIntersection: false, // bypass exclusion for user-combined roads
        residentialDensity: 0,
        intersections: (selectedRoad.intersections || 0) + (road.intersections || 0),
        stopSigns: (selectedRoad.stopSigns || 0) + (road.stopSigns || 0),
      };
      
      // Score with no exclusion filters so combined roads always get a rating
      const [scoredCombined] = calculateScores([combinedRoad], {
        minScore: 0,
        minLength: 0,
        maxHouseDensity: 100
      });
      
      const result = scoredCombined || { ...combinedRoad, totalScore: 0, curvatureScore: 0, flowScore: 0, lengthMiles: '?', lengthKm: '?' };
      setRoads(prev => [...prev.filter(r => r.id !== selectedRoad.id && r.id !== road.id), result]);
      setAllRoads(prev => [...prev.filter(r => r.id !== selectedRoad.id && r.id !== road.id), result]);
      setSelectedRoad(result);
      setGeneratedTurns([]);
    } else {
      // Normal click or Shift-click without a prior selection
      // Ensure the road is in the active list if it was clicked from unlisted roads
      const inList = roads.find(r => r.id === road.id);
      if (!inList) {
        setRoads(prev => [...prev, road]);
      }
      setSelectedRoad(road);
      setGeneratedTurns([]);
      if (window.innerWidth < 768 && !isShift) setView('map');
    }
  };

  const searchNear = async (lat, lon) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const thresholds = { minScore, minLength, maxHouseDensity };
      
      // Try cache first
      const cached = await getCachedRoads(lat, lon, radius, thresholds);
      if (cached) {
        setRoads(cached.roads || []);
        setAllRoads(cached.allRoads || []);
        setLocation({ lat, lon });
        setLoading(false);
        return;
      }

      const radiusKm = radius * 1.60934;
      const rawRoads = await fetchRoads(lat, lon, radiusKm);
      if (!rawRoads) throw new Error("No data received");

      // Store all raw roads (with basic scoring, no filter) for map display
      const allScored = calculateScores(rawRoads, { minScore: 0, minLength: 0, maxHouseDensity: 100 });
      const scoredRoads = calculateScores(rawRoads, thresholds);

      setAllRoads(allScored || []);
      setRoads(scoredRoads || []);
      setLocation({ lat, lon });

      // Save to cache
      await saveToCache(lat, lon, radius, thresholds, {
        roads: scoredRoads,
        allRoads: allScored
      });
    } catch (err) {
      console.error(err);
      setError("Search failed. Try a smaller radius or different area.");
    } finally {
      setLoading(false);
    }
  };

  const handleManualSearch = async (query) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
      const data = await response.json();
      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        searchNear(parseFloat(lat), parseFloat(lon));
      } else {
        setError("Location not found. Try a different zip or city.");
        setLoading(false);
      }
    } catch (err) {
      setError("Geocoding service unavailable.");
      setLoading(false);
    }
  };
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.elements) {
          setError("Raw OSM files require processing. Please use the search for now.");
        } else {
          setRoads(data);
          setError(null);
        }
      } catch (err) {
        setError("Invalid file format. Please provide a valid JSON file.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="relative h-screen w-full bg-black overflow-hidden flex flex-col md:flex-row">
      {/* Header - Fixed on mobile, part of sidebar on desktop */}
      <header className="absolute top-0 left-0 right-0 z-[1002] p-4 md:p-6 pointer-events-none">
        <div className="w-full flex justify-between items-center">
          <div className="flex items-center gap-4 pointer-events-auto">
            <img src="/logo.png" alt="Touge Finder Logo" className="w-14 h-14 object-contain filter drop-shadow-lg" />
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tighter text-white drop-shadow-md italic">TOUGE FINDER</h1>
              <p className="text-[10px] text-zinc-400 tracking-widest font-semibold uppercase">Discovery Engine</p>
            </div>
          </div>

          <div className="pointer-events-auto flex gap-2">
            <button 
              onClick={() => setView(view === 'map' ? 'list' : 'map')}
              className="glass p-3 rounded-xl md:hidden"
            >
              {view === 'map' ? <List className="w-5 h-5" /> : <MapIcon className="w-5 h-5" />}
            </button>
            <button 
              onClick={handleAutoDetect}
              className="glass p-3 rounded-xl"
              disabled={loading}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative">
        {/* Map always in background or side */}
        <div className={cn(
          "absolute inset-0 transition-all duration-500",
          view === 'list' && "md:translate-x-0 translate-y-[-20%] md:translate-y-0 opacity-50 md:opacity-100"
        )}>
          <MapboxMap 
            roads={roads} 
            unlistedRoads={allRoads}
            selectedRoad={selectedRoad} 
            onSelectRoad={handleSelectRoad}
            center={location}
            generatedTurns={generatedTurns}
          />
        </div>

        {/* Results Sidebar / Bottom Sheet */}
        {(view === 'list' || window.innerWidth > 768) && (
          <div 
            className={cn(
              "absolute inset-x-0 bottom-0 top-1/2 md:top-0 md:left-0 md:w-80 lg:w-1/4 bg-zinc-950/90 backdrop-blur-2xl border-t md:border-t-0 md:border-r border-white/10 z-[1001] overflow-hidden flex flex-col shadow-2xl",
              view === 'map' && "hidden md:flex"
            )}
          >
            {/* Drag Handle for mobile */}
            <div className="h-1 w-12 bg-white/20 rounded-full mx-auto my-3 md:hidden" />
            
            <div className="p-6 pt-2 md:pt-24 flex-1 overflow-y-auto no-scrollbar">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  Nearby Roads
                  <span className="text-sm font-normal text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full">
                    {roads.length}
                  </span>
                </h2>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn(
                      "p-2 rounded-lg transition-all",
                      showFilters ? "bg-touge-600 text-white" : "text-zinc-500 hover:text-white"
                    )}
                  >
                    <SlidersHorizontal className="w-5 h-5" />
                  </button>
                  <label className="text-zinc-500 hover:text-white transition-colors cursor-pointer p-2">
                    <input type="file" className="hidden" accept=".json" onChange={handleFileUpload} />
                    <Navigation className="w-5 h-5 rotate-90" />
                  </label>
                </div>
              </div>

              {showFilters && (
                <div className="mb-6 bg-zinc-900/50 rounded-3xl border border-white/5 p-6 space-y-6">
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <label className="text-xs font-bold uppercase text-zinc-500">Search Radius</label>
                      <span className="text-xs font-bold">{radius} miles</span>
                    </div>
                    <input 
                      type="range" min="5" max="50" step="5" value={radius} 
                      onChange={(e) => setRadius(parseInt(e.target.value))}
                      className="w-full accent-touge-500"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <label className="text-xs font-bold uppercase text-zinc-500">Min Touge Score</label>
                      <span className="text-xs font-bold">{minScore}+</span>
                    </div>
                    <input 
                      type="range" min="30" max="80" step="5" value={minScore} 
                      onChange={(e) => setMinScore(parseInt(e.target.value))}
                      className="w-full accent-touge-500"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <label className="text-xs font-bold uppercase text-zinc-500">Min Road Length</label>
                      <span className="text-xs font-bold">{minLength} mi</span>
                    </div>
                    <input 
                      type="range" min="0.25" max="5" step="0.25" value={minLength} 
                      onChange={(e) => setMinLength(parseFloat(e.target.value))}
                      className="w-full accent-touge-500"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <label className="text-xs font-bold uppercase text-zinc-500">Max Res. Density</label>
                      <span className="text-xs font-bold">{maxHouseDensity}</span>
                    </div>
                    <input 
                      type="range" min="1" max="50" step="1" value={maxHouseDensity} 
                      onChange={(e) => setMaxHouseDensity(parseInt(e.target.value))}
                      className="w-full accent-touge-500"
                    />
                  </div>
                  
                  <button 
                    onClick={() => location && searchNear(location.lat, location.lon)}
                    className="w-full py-3 bg-touge-600 hover:bg-touge-500 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-touge-900/20"
                  >
                    Apply & Re-scan
                  </button>
                </div>
              )}

              <LocationSearch onSearch={handleManualSearch} loading={loading} />

              {error && (
                <div className="p-4 bg-red-900/20 border border-red-500/20 rounded-2xl text-red-400 text-sm mb-6">
                  {error}
                </div>
              )}

              <RoadList 
                roads={roads} 
                loading={loading} 
                onSelectRoad={handleSelectRoad}
                selectedRoad={selectedRoad}
              />
            </div>
          </div>
        )}
      </main>

      {/* Road Detail Overlay */}
      {selectedRoad && (
        <RoadDetail 
          road={selectedRoad} 
            setGeneratedTurns([]);
            setShow3D(false);
            setSelectedRoadElevation(null);
          }} 
          onNotesGenerated={setGeneratedTurns}
          onElevationLoaded={(data) => setSelectedRoadElevation(data.profile)}
          onShow3D={() => setShow3D(true)}
        />
      )}

      {selectedRoad && show3D && (
        <Terrain3D 
          road={selectedRoad} 
          elevationProfile={selectedRoadElevation}
          onClose={() => setShow3D(false)} 
        />
      )}

      {/* Floating Search Controls for mobile if map is active */}
      {view === 'map' && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[1001] md:hidden">
          <button 
            onClick={() => setView('list')}
            className="btn-primary flex items-center gap-2 shadow-2xl shadow-touge-900/40"
          >
            <List className="w-4 h-4" />
            View Results
          </button>
        </div>
      )}
    </div>
  );
}

export default App;

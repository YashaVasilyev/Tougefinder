import React, { useState, useEffect } from 'react';
import { Search, Map as MapIcon, List, Navigation, MapPin, Loader2, ChevronUp, ChevronDown, SlidersHorizontal, Info, Compass, Trash2, Sparkles } from 'lucide-react';
import MapboxMap from './components/LeafletMap';
import RoadList from './components/RoadList';
import RoadDetail from './components/RoadDetail';
import LocationSearch from './components/LocationSearch';
import Terrain3D from './components/Terrain3D';
import { fetchRoads, fetchRoadsInBBox } from './services/overpass';
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
  
  // Route Planning States & Helpers
  const [routeWaypoints, setRouteWaypoints] = useState([]);
  const [routePlannerActive, setRoutePlannerActive] = useState(false);
  const [stitchedRoute, setStitchedRoute] = useState(null);
  const [stitchingLoading, setStitchingLoading] = useState(false);

  // Corridor route planning states
  const [routeStartPoint, setRouteStartPoint] = useState(null);
  const [routeEndPoint, setRouteEndPoint] = useState(null);
  const [mapClickMode, setMapClickMode] = useState('start'); // 'start' or 'end'

  // Trigger corridor search when start or end points are set/changed
  useEffect(() => {
    if (!routeStartPoint || !routeEndPoint) return;

    const searchCorridor = async () => {
      setLoading(true);
      setError(null);
      try {
        const startPoint = turf.point([routeStartPoint.lon, routeStartPoint.lat]);
        const endPoint = turf.point([routeEndPoint.lon, routeEndPoint.lat]);
        
        // Calculate point to point distance in km
        const distanceKm = turf.distance(startPoint, endPoint, { units: 'kilometers' });
        
        // Calculate corridor radius in km: 15 + 0.1 * distance
        const corridorRadiusKm = 15 + 0.1 * distanceKm;

        const straightLine = turf.lineString([
          [routeStartPoint.lon, routeStartPoint.lat],
          [routeEndPoint.lon, routeEndPoint.lat]
        ]);
        
        // Bounding box of the buffered line to query Overpass
        const buffered = turf.buffer(straightLine, corridorRadiusKm, { units: 'kilometers' });
        const bbox = turf.bbox(buffered); // [minLon, minLat, maxLon, maxLat]

        // Fetch all roads in bounding box
        const rawRoads = await fetchRoadsInBBox(bbox[1], bbox[0], bbox[3], bbox[2]);
        if (!rawRoads) throw new Error("No data received");

        // Filter ways: keep only those within corridorRadiusKm of the straightLine
        const filteredRoads = rawRoads.filter(road => {
          return road.coordinates.some(coord => {
            const pt = turf.point(coord);
            const dist = turf.pointToLineDistance(pt, straightLine, { units: 'kilometers' });
            return dist <= corridorRadiusKm;
          });
        });

        const thresholds = { minScore, minLength, maxHouseDensity };
        const allScored = calculateScores(filteredRoads, { minScore: 0, minLength: 0, maxHouseDensity: 100 });
        const scoredRoads = calculateScores(filteredRoads, thresholds);

        setAllRoads(allScored || []);
        setRoads(scoredRoads || []);
        
        // Center view between start and end
        setLocation({
          lat: (routeStartPoint.lat + routeEndPoint.lat) / 2,
          lon: (routeStartPoint.lon + routeEndPoint.lon) / 2
        });
      } catch (err) {
        console.error("Corridor scan failed:", err);
        setError("Failed to fetch corridor segments. Please try different coordinates.");
      } finally {
        setLoading(false);
      }
    };

    searchCorridor();
  }, [routeStartPoint, routeEndPoint]);

  const handleMapClick = async (coords) => {
    if (!routePlannerActive) return;

    let name = `Location (${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)})`;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lon}&zoom=14`);
      if (res.ok) {
        const data = await res.json();
        name = data.display_name.split(',').slice(0, 2).join(',');
      }
    } catch (err) {
      console.error("Reverse geocoding failed:", err);
    }

    const pointObj = { ...coords, name };

    if (mapClickMode === 'start') {
      setRouteStartPoint(pointObj);
      setMapClickMode('end');
    } else {
      setRouteEndPoint(pointObj);
    }
  };

  // Tolerable distance surplus and routing solvers
  const [distanceSurplus, setDistanceSurplus] = useState(50); // in percent, default 50%
  const [autoRouteLoading, setAutoRouteLoading] = useState(false);

  const fetchFastestRouteDistance = async (startPt, endPt) => {
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${startPt.lon},${startPt.lat};${endPt.lon},${endPt.lat}?overview=false`);
      if (response.ok) {
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
          return data.routes[0].distance / 1000; // in km
        }
      }
    } catch (e) {
      console.error("OSRM fastest route check failed, using direct distance proxy:", e);
    }
    const startPoint = turf.point([startPt.lon, startPt.lat]);
    const endPoint = turf.point([endPt.lon, endPt.lat]);
    return turf.distance(startPoint, endPoint, { units: 'kilometers' }) * 1.25;
  };

  const handleGenerateCurvatureRoute = async () => {
    if (!routeStartPoint || !routeEndPoint) {
      setError("Please set both Start and End points first.");
      return;
    }
    
    setAutoRouteLoading(true);
    setError(null);
    
    try {
      const baseDistKm = await fetchFastestRouteDistance(routeStartPoint, routeEndPoint);
      const maxAllowedDistKm = baseDistKm * (1 + distanceSurplus / 100);
      
      const dist = (c1, c2) => {
        return turf.distance(turf.point(c1), turf.point(c2), { units: 'kilometers' });
      };

      const startCoords = [routeStartPoint.lon, routeStartPoint.lat];
      const endCoords = [routeEndPoint.lon, routeEndPoint.lat];
      
      const candidates = roads.filter(r => r.coordinates && r.coordinates.length > 1);
      
      let bestPath = [];
      let maxCurvature = -1;
      let iterations = 0;
      const MAX_ITERATIONS = 4000;
      
      const dfs = (currCoords, currDist, currCurv, visitedIds, currentPath) => {
        iterations++;
        if (iterations > MAX_ITERATIONS) return;
        if (currentPath.length >= 6) return; // Limit route to 6 segments max to prevent stack explosion

        const distToEnd = dist(currCoords, endCoords);
        const finalDist = currDist + distToEnd;
        
        if (finalDist <= maxAllowedDistKm) {
          if (currCurv > maxCurvature) {
            maxCurvature = currCurv;
            bestPath = [...currentPath];
          }
        }
        
        // Dynamic Proximity Sorting & Directional Pruning
        const distCurrToEnd = dist(currCoords, endCoords);

        const sortedCandidates = candidates
          .filter(r => !visitedIds.has(r.id))
          .map(road => {
            const A = road.coordinates[0];
            const B = road.coordinates[road.coordinates.length - 1];
            const distToA = dist(currCoords, A);
            const distToB = dist(currCoords, B);
            return {
              road,
              A,
              B,
              distToA,
              distToB,
              minDist: Math.min(distToA, distToB)
            };
          })
          .filter(item => {
            if (item.minDist > 50) return false; // Keep connections localized

            // Directional progress: exit node must get us closer to the destination than currCoords
            const distBToEnd = dist(item.B, endCoords);
            const distAToEnd = dist(item.A, endCoords);
            const validAtoB = distBToEnd < distCurrToEnd && distAToEnd <= distCurrToEnd + 5;
            const validBtoA = distAToEnd < distCurrToEnd && distBToEnd <= distCurrToEnd + 5;

            return validAtoB || validBtoA;
          })
          .sort((a, b) => a.minDist - b.minDist)
          .slice(0, 8); // Branch factor limit: check only top 8 closest forward-moving touges
          
        for (const item of sortedCandidates) {
          const road = item.road;
          const roadLenKm = parseFloat(road.lengthMiles || '0') * 1.60934;
          const roadCurvVal = (road.curvatureScore || 0) * parseFloat(road.lengthMiles || '0');

          const distBToEnd = dist(item.B, endCoords);
          const distAToEnd = dist(item.A, endCoords);

          // Entry A, Exit B
          const validAtoB = distBToEnd < distCurrToEnd && distAToEnd <= distCurrToEnd + 5;
          if (validAtoB) {
            const totalEstDistA = currDist + item.distToA + roadLenKm + distBToEnd;
            if (totalEstDistA <= maxAllowedDistKm) {
              visitedIds.add(road.id);
              dfs(
                item.B,
                currDist + item.distToA + roadLenKm,
                currCurv + roadCurvVal,
                visitedIds,
                [...currentPath, road]
              );
              visitedIds.delete(road.id);
            }
          }
          
          // Entry B, Exit A
          const validBtoA = distAToEnd < distCurrToEnd && distBToEnd <= distCurrToEnd + 5;
          if (validBtoA) {
            const totalEstDistB = currDist + item.distToB + roadLenKm + distAToEnd;
            if (totalEstDistB <= maxAllowedDistKm) {
              visitedIds.add(road.id);
              const reversedRoad = {
                ...road,
                coordinates: [...road.coordinates].reverse()
              };
              dfs(
                item.A,
                currDist + item.distToB + roadLenKm,
                currCurv + roadCurvVal,
                visitedIds,
                [...currentPath, reversedRoad]
              );
              visitedIds.delete(road.id);
            }
          }
        }
      };

      dfs(startCoords, 0, 0, new Set(), []);

      if (bestPath.length === 0) {
        setError("No optimal winding routes found within the distance surplus budget. Try increasing distance surplus!");
      } else {
        setRouteWaypoints(bestPath);
      }
    } catch (err) {
      console.error("Failed to generate optimal curvature route:", err);
      setError("Winding routing engine failed.");
    } finally {
      setAutoRouteLoading(false);
    }
  };

  const fetchOSRMRoute = async (coord1, coord2) => {
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coord1[0]},${coord1[1]};${coord2[0]},${coord2[1]}?overview=full&geometries=geojson`);
      if (!response.ok) throw new Error("OSRM failed");
      const data = await response.json();
      if (data.routes && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates;
      }
    } catch (err) {
      console.error("OSRM failed, falling back to direct line:", err);
    }
    return [coord1, coord2];
  };

  const exportToGPX = (route) => {
    if (!route || !route.coordinates) return;
    let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Tougefinder" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${route.name}</name>
    <desc>Planned driving route via Tougefinder</desc>
  </metadata>
  <trk>
    <name>${route.name}</name>
    <trkseg>`;

    route.coordinates.forEach(coord => {
      gpxContent += `
        <trkpt lat="${coord[1]}" lon="${coord[0]}" />`;
    });

    gpxContent += `
      </trkseg>
    </trk>
</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${route.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (routeWaypoints.length === 0) {
      setStitchedRoute(null);
      return;
    }
    if (routeWaypoints.length === 1) {
      const road = routeWaypoints[0];
      setStitchedRoute({
        id: 'planned-route',
        name: `Planned Route: ${road.name}`,
        type: 'Planned Route',
        coordinates: road.coordinates,
        curvatureScore: road.curvatureScore,
        flowScore: road.flowScore,
        totalScore: road.totalScore,
        lengthMiles: road.lengthMiles,
        maxIntensity: road.maxIntensity,
        lineString: road.lineString
      });
      return;
    }

    const stitch = async () => {
      setStitchingLoading(true);
      try {
        let allCoordinates = [];
        let totalLengthMiles = 0;
        let avgCurvatureSum = 0;
        let avgFlowSum = 0;
        
        for (let i = 0; i < routeWaypoints.length; i++) {
          const currentRoad = routeWaypoints[i];
          allCoordinates.push(...currentRoad.coordinates);
          totalLengthMiles += parseFloat(currentRoad.lengthMiles || '0');
          avgCurvatureSum += currentRoad.curvatureScore || 0;
          avgFlowSum += currentRoad.flowScore || 0;

          if (i < routeWaypoints.length - 1) {
            const nextRoad = routeWaypoints[i + 1];
            const startCoord = currentRoad.coordinates[currentRoad.coordinates.length - 1];
            const endCoord = nextRoad.coordinates[0];
            
            const connectionCoords = await fetchOSRMRoute(startCoord, endCoord);
            if (connectionCoords && connectionCoords.length > 0) {
              allCoordinates.push(...connectionCoords);
              const connLine = turf.lineString(connectionCoords);
              const connLenMiles = turf.length(connLine, { units: 'kilometers' }) * 0.621371;
              totalLengthMiles += connLenMiles;
            }
          }
        }

        const avgCurvature = Math.round(avgCurvatureSum / routeWaypoints.length);
        const avgFlow = Math.round(avgFlowSum / routeWaypoints.length);
        const totalScore = Math.min(100, Math.round(avgCurvature + avgFlow));
        const line = turf.lineString(allCoordinates);

        setStitchedRoute({
          id: 'planned-route',
          name: `Custom Route (${routeWaypoints.length} Segments)`,
          type: 'Planned Route',
          coordinates: allCoordinates,
          curvatureScore: avgCurvature,
          flowScore: avgFlow,
          totalScore,
          lengthMiles: totalLengthMiles.toFixed(2),
          maxIntensity: Math.max(...routeWaypoints.map(w => w.maxIntensity || 0)),
          lineString: line
        });
      } catch (err) {
        console.error("Stitching failed:", err);
      } finally {
        setStitchingLoading(false);
      }
    };

    stitch();
  }, [routeWaypoints]);

  const handleAddToRoute = (road) => {
    setRouteWaypoints(prev => {
      if (prev.some(r => r.id === road.id)) return prev;
      return [...prev, road];
    });
  };

  const handleRemoveFromRoute = (road) => {
    setRouteWaypoints(prev => prev.filter(r => r.id !== road.id));
  };
  
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
            plannedRoute={stitchedRoute}
            plannedRouteWaypoints={routeWaypoints}
            routeStartPoint={routeStartPoint}
            routeEndPoint={routeEndPoint}
            onMapClick={handleMapClick}
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
                <div className="flex gap-2 items-center">
                  <button 
                    onClick={() => setRoutePlannerActive(!routePlannerActive)}
                    className={cn(
                      "p-2 rounded-lg transition-all relative flex items-center justify-center",
                      routePlannerActive ? "bg-purple-600 text-white" : "text-zinc-500 hover:text-white"
                    )}
                    title="Route Planner"
                  >
                    <Compass className="w-5 h-5 animate-pulse-soft" />
                    {routeWaypoints.length > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">
                        {routeWaypoints.length}
                      </span>
                    )}
                  </button>
                  <button 
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn(
                      "p-2 rounded-lg transition-all",
                      showFilters ? "bg-touge-600 text-white" : "text-zinc-500 hover:text-white"
                    )}
                    title="Filters"
                  >
                    <SlidersHorizontal className="w-5 h-5" />
                  </button>
                  <label className="text-zinc-500 hover:text-white transition-colors cursor-pointer p-2" title="Upload JSON Route">
                    <input type="file" className="hidden" accept=".json" onChange={handleFileUpload} />
                    <Navigation className="w-5 h-5 rotate-90" />
                  </label>
                </div>
              </div>

              {routePlannerActive ? (
                <div className="space-y-6">
                  <div className="p-4 bg-purple-950/20 border border-purple-500/20 rounded-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Compass className="w-4 h-4 text-purple-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300">Touge Route Builder</h3>
                      </div>
                      {routeWaypoints.length > 0 && (
                        <button 
                          onClick={() => setRouteWaypoints([])}
                          className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1 font-semibold"
                        >
                          <Trash2 size={11} />
                          Clear All
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-relaxed">
                      Chain multiple mountain passes together to construct a continuous planned drive. Click <b className="text-purple-300">+ Route</b> on any road's card to add it to your custom route sequence!
                    </p>
                  </div>

                  {/* Start / End corridor builder */}
                  <div className="space-y-4 bg-zinc-900/40 p-4 rounded-2xl border border-white/5">
                    <div className="flex justify-between items-center">
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Corridor Bounds</h4>
                      {(routeStartPoint || routeEndPoint) && (
                        <button
                          onClick={() => {
                            setRouteStartPoint(null);
                            setRouteEndPoint(null);
                            setMapClickMode('start');
                          }}
                          className="text-[9px] font-bold text-rose-400 hover:underline uppercase transition-all"
                        >
                          Reset Points
                        </button>
                      )}
                    </div>
                    
                    <div className="space-y-2.5">
                      {/* Start Point Input Card */}
                      <div 
                        onClick={() => setMapClickMode('start')}
                        className={cn(
                          "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between",
                          mapClickMode === 'start' 
                            ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300 animate-pulse-soft" 
                            : "bg-zinc-950/50 border-white/5 hover:border-white/10 text-zinc-400"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-emerald-500 text-white font-mono text-[10px] font-extrabold flex items-center justify-center flex-shrink-0">S</span>
                          <div className="truncate">
                            <span className="text-[8px] font-bold uppercase block text-zinc-500">Start Location</span>
                            <span className="text-xs font-bold truncate block">
                              {routeStartPoint ? routeStartPoint.name : "Click map to assign start"}
                            </span>
                          </div>
                        </div>
                        {mapClickMode === 'start' && <span className="text-[8px] font-bold uppercase tracking-wider bg-emerald-500/25 px-1.5 py-0.5 rounded-md">Active</span>}
                      </div>

                      {/* End Point Input Card */}
                      <div 
                        onClick={() => setMapClickMode('end')}
                        className={cn(
                          "p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between",
                          mapClickMode === 'end' 
                            ? "bg-rose-950/20 border-rose-500/30 text-rose-300 animate-pulse-soft" 
                            : "bg-zinc-950/50 border-white/5 hover:border-white/10 text-zinc-400"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-rose-500 text-white font-mono text-[10px] font-extrabold flex items-center justify-center flex-shrink-0">E</span>
                          <div className="truncate">
                            <span className="text-[8px] font-bold uppercase block text-zinc-500">End Location</span>
                            <span className="text-xs font-bold truncate block">
                              {routeEndPoint ? routeEndPoint.name : "Click map to assign end"}
                            </span>
                          </div>
                        </div>
                        {mapClickMode === 'end' && <span className="text-[8px] font-bold uppercase tracking-wider bg-rose-500/25 px-1.5 py-0.5 rounded-md">Active</span>}
                      </div>
                    </div>

                    {/* Calculated Corridor Radius Display */}
                    {(() => {
                      if (!routeStartPoint || !routeEndPoint) return null;
                      const startPoint = turf.point([routeStartPoint.lon, routeStartPoint.lat]);
                      const endPoint = turf.point([routeEndPoint.lon, routeEndPoint.lat]);
                      const distanceKm = turf.distance(startPoint, endPoint, { units: 'kilometers' });
                      const corridorRadiusKm = 15 + 0.1 * distanceKm;

                      return (
                        <div className="pt-2 border-t border-white/5 space-y-1.5">
                          <div className="flex justify-between text-[10px] text-zinc-400 font-mono">
                            <span>Axis distance:</span>
                            <span className="font-bold text-white">{(distanceKm * 0.621371).toFixed(1)} miles ({distanceKm.toFixed(1)} km)</span>
                          </div>
                          <div className="flex justify-between text-[10px] text-zinc-400 font-mono">
                            <span>Corridor buffer:</span>
                            <span className="font-bold text-purple-300">{(corridorRadiusKm * 0.621371).toFixed(1)} miles ({corridorRadiusKm.toFixed(1)} km)</span>
                          </div>
                          <p className="text-[9px] text-zinc-500 italic mt-1 leading-normal">
                            All passes within buffer are gathered automatically. Click any pass on the map to add it between your Start and End targets.
                          </p>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Curvature Optimization Routing Panel */}
                  {routeStartPoint && routeEndPoint && (
                    <div className="space-y-4 bg-purple-950/15 border border-purple-500/20 p-4 rounded-2xl">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-purple-400">
                          <Sparkles className="w-4 h-4 text-purple-400" />
                          <h4 className="text-xs font-bold uppercase tracking-wider">Curvature Optimizer</h4>
                        </div>
                        <span className="text-[9px] font-bold text-zinc-500 uppercase">Engine</span>
                      </div>
                      
                      <p className="text-[10px] text-zinc-400 leading-normal">
                        Automatically construct the absolute most winding route connecting your targets, detouring onto corridor mountain passes!
                      </p>

                      {/* Tolerable distance surplus slider */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase text-zinc-400">
                          <span>Max Distance Surplus</span>
                          <span className="text-purple-400">+{distanceSurplus}%</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="200"
                          step="10"
                          value={distanceSurplus}
                          onChange={(e) => setDistanceSurplus(parseInt(e.target.value))}
                          className="w-full accent-purple-500"
                        />
                        <p className="text-[9px] text-zinc-500 leading-normal italic">
                          Allows the router to detour up to {(1 + distanceSurplus / 100).toFixed(1)}x of the direct distance to pack more twisty mountain passes.
                        </p>
                      </div>

                      <button
                        onClick={handleGenerateCurvatureRoute}
                        disabled={autoRouteLoading}
                        className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-900/30"
                      >
                        {autoRouteLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Finding Twisty Path...</span>
                          </>
                        ) : (
                          <>
                            <Compass className="w-4 h-4 animate-spin-slow" />
                            <span>Generate Winding Route</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Waypoint List */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Route Waypoints</h4>
                    {routeWaypoints.length === 0 ? (
                      <div className="text-center py-8 border border-dashed border-white/5 rounded-2xl text-zinc-500 text-xs">
                        No segments selected yet. Click a road on the map and add it to your custom driving route.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {routeWaypoints.map((waypoint, idx) => (
                          <div 
                            key={`wp-${waypoint.id}-${idx}`}
                            className="group p-3 bg-zinc-900/60 hover:bg-zinc-900 border border-white/5 hover:border-white/10 rounded-xl flex items-center justify-between transition-all"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-500/30 w-5 h-5 rounded-full flex items-center justify-center font-mono">
                                {idx + 1}
                              </span>
                              <div>
                                <h5 className="text-xs font-bold text-zinc-100 group-hover:text-purple-400 transition-colors">{waypoint.name}</h5>
                                <p className="text-[10px] text-zinc-500">{waypoint.lengthMiles} miles • Score {waypoint.totalScore}</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => handleRemoveFromRoute(waypoint)}
                              className="text-zinc-600 hover:text-red-400 p-1.5 transition-colors"
                              title="Remove from Route"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Stitched Route Summary Details */}
                  {stitchedRoute && (
                    <div className="p-5 bg-zinc-900/50 rounded-2xl border border-white/5 space-y-4">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Joint Route Telemetry</h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-zinc-950/40 rounded-xl border border-white/5">
                          <span className="text-[8px] font-bold uppercase text-zinc-500 block">Total Distance</span>
                          <span className="text-xs font-mono font-bold text-white">{stitchedRoute.lengthMiles} miles</span>
                        </div>
                        <div className="p-3 bg-zinc-950/40 rounded-xl border border-white/5">
                          <span className="text-[8px] font-bold uppercase text-zinc-500 block">Route Rating</span>
                          <span className="text-xs font-mono font-bold text-purple-400">{stitchedRoute.totalScore} / 100</span>
                        </div>
                      </div>

                      {/* Connection Loader Status */}
                      {stitchingLoading ? (
                        <div className="flex items-center justify-center gap-2 py-2 text-zinc-500 text-xs font-mono">
                          <Loader2 size={12} className="animate-spin" />
                          Calculating Scenic Connections...
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <button 
                            onClick={() => {
                              setSelectedRoad(stitchedRoute);
                              setShow3D(true);
                            }}
                            className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2"
                          >
                            <Sparkles size={12} />
                            Flyover Planned Route (3D)
                          </button>
                          <button 
                            onClick={() => exportToGPX(stitchedRoute)}
                            className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                          >
                            📥 Export Route (GPX)
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Road Detail Overlay */}
      {selectedRoad && (
        <RoadDetail 
          road={selectedRoad} 
          onClose={() => {
            setSelectedRoad(null);
            setGeneratedTurns([]);
            setShow3D(false);
            setSelectedRoadElevation(null);
          }} 
          onNotesGenerated={setGeneratedTurns}
          onElevationLoaded={(data) => setSelectedRoadElevation(data.profile)}
          onShow3D={() => setShow3D(true)}
          onAddToRoute={handleAddToRoute}
          onRemoveFromRoute={handleRemoveFromRoute}
          isInRoute={routeWaypoints.some(r => r.id === selectedRoad.id)}
          onSetStartPoint={(pt) => {
            setRouteStartPoint(pt);
            setRoutePlannerActive(true);
          }}
          onSetEndPoint={(pt) => {
            setRouteEndPoint(pt);
            setRoutePlannerActive(true);
          }}
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

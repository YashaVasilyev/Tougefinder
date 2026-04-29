import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Use environment variable or fallback to demo token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4M29iazA2Z2gycXA4N2pmbDg5M3oifQ.0E_U89G7iQfT65tFywzHMA';

const MapboxMap = ({ roads, unlistedRoads = [], selectedRoad, onSelectRoad, center, generatedTurns = [] }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);

  useEffect(() => {
    if (map.current) return;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: center ? [center.lon, center.lat] : [-122.4194, 37.7749],
      zoom: 12,
      pitch: 45,
      bearing: 0,
      antialias: true
    });

    map.current.on('load', () => {
      // Add 3D Terrain
      map.current.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
      });
      map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });

      // Add Sky Layer
      map.current.addLayer({
        'id': 'sky',
        'type': 'sky',
        'paint': {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 0.0],
          'sky-atmosphere-sun-intensity': 15
        }
      });

      // Sources for roads
      map.current.addSource('unlisted-roads', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addSource('active-roads', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Layers
      map.current.addLayer({
        id: 'unlisted-roads-layer',
        type: 'line',
        source: 'unlisted-roads',
        paint: {
          'line-color': '#3f3f46',
          'line-width': 3,
          'line-opacity': 0.4
        }
      });

      map.current.addLayer({
        id: 'active-roads-layer',
        type: 'line',
        source: 'active-roads',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'isSelected'], 8, 4],
          'line-opacity': ['case', ['get', 'isSelected'], 1, 0.8]
        }
      });

      // Interaction
      map.current.on('click', 'active-roads-layer', (e) => {
        const road = JSON.parse(e.features[0].properties.roadData);
        onSelectRoad(road, e.originalEvent.shiftKey);
      });

      map.current.on('click', 'unlisted-roads-layer', (e) => {
        const road = JSON.parse(e.features[0].properties.roadData);
        onSelectRoad(road, e.originalEvent.shiftKey);
      });

      const setupCursor = (layer) => {
        map.current.on('mouseenter', layer, () => map.current.getCanvas().style.cursor = 'pointer');
        map.current.on('mouseleave', layer, () => map.current.getCanvas().style.cursor = '');
      };
      setupCursor('active-roads-layer');
      setupCursor('unlisted-roads-layer');
    });
  }, []);

  // Update Roads Data
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    const getScoreColor = (score) => {
      if (score >= 80) return '#ef4444';
      if (score >= 50) return '#facc15';
      return '#4ade80';
    };

    const activeFeatures = roads.map(r => ({
      type: 'Feature',
      properties: {
        id: r.id,
        color: getScoreColor(r.totalScore),
        isSelected: selectedRoad?.id === r.id,
        roadData: JSON.stringify(r)
      },
      geometry: { type: 'LineString', coordinates: r.coordinates }
    }));

    const filteredUnlisted = unlistedRoads.filter(ur => !roads.find(r => r.id === ur.id));
    const unlistedFeatures = filteredUnlisted.map(r => ({
      type: 'Feature',
      properties: { roadData: JSON.stringify(r) },
      geometry: { type: 'LineString', coordinates: r.coordinates }
    }));

    map.current.getSource('active-roads').setData({ type: 'FeatureCollection', features: activeFeatures });
    map.current.getSource('unlisted-roads').setData({ type: 'FeatureCollection', features: unlistedFeatures });
  }, [roads, unlistedRoads, selectedRoad]);

  // Update Turns / Markers
  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach(m => m.remove());
    markers.current = [];

    generatedTurns.forEach(turn => {
      const el = document.createElement('div');
      el.className = 'bg-black/80 text-white border border-white/20 font-bold px-2 py-1 text-[10px] uppercase rounded shadow-xl backdrop-blur-sm pointer-events-none';
      el.innerHTML = turn.text;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(turn.coordinate)
        .addTo(map.current);
      markers.current.push(marker);
    });
  }, [generatedTurns]);

  // Handle Selection / FitBounds
  useEffect(() => {
    if (!map.current || !selectedRoad) return;

    const coords = selectedRoad.coordinates;
    const bounds = coords.reduce((acc, coord) => acc.extend(coord), new mapboxgl.LngLatBounds(coords[0], coords[0]));

    const isDesktop = window.innerWidth > 768;
    const sidebarWidth = window.innerWidth > 1024 ? window.innerWidth * 0.25 : 320;

    map.current.fitBounds(bounds, {
      padding: {
        top: 60,
        bottom: 60,
        left: isDesktop ? sidebarWidth + 60 : 60,
        right: isDesktop ? 420 + 60 : 60
      },
      duration: 2000,
      pitch: 60,
      essential: true
    });
  }, [selectedRoad]);

  // Handle Initial Center
  useEffect(() => {
    if (center && map.current && !selectedRoad) {
      map.current.flyTo({ center: [center.lon, center.lat], zoom: 12, pitch: 45, duration: 2000 });
    }
  }, [center]);

  return (
    <div className="w-full h-full relative bg-zinc-950">
      <div ref={mapContainer} className="absolute inset-0" />
      
      {/* 3D Attribution/Controls overlay */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
         <div className="glass px-3 py-1.5 rounded-full text-[10px] font-bold uppercase text-white/50 border-white/5">
           3D Terrain Active
         </div>
      </div>

      <div className="absolute bottom-6 right-16 z-10 flex flex-col gap-2">
        <div className="glass p-3 rounded-xl flex flex-col gap-2 text-[10px] font-bold uppercase tracking-tighter">
          <div className="flex items-center gap-2">
            <div className="w-4 h-1.5 bg-red-500 rounded-full" />
            <span>Extreme (80+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1.5 bg-yellow-400 rounded-full" />
            <span>Spirited (50+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1.5 bg-green-400 rounded-full" />
            <span>Scenic (&lt; 50)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapboxMap;

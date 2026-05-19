import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Use environment variable or fallback to demo token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4M29iazA2Z2gycXA4N2pmbDg5M3oifQ.0E_U89G7iQfT65tFywzHMA';

const MapboxMap = ({ roads, selectedRoad, onSelectRoad, center }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    if (map.current) return; // initialize map only once
    
    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: center ? [center.lon, center.lat] : [-74.006, 40.7128], // Default NYC
        zoom: 12,
        pitch: 45,
      });

      map.current.on('error', (e) => {
        console.error('Mapbox error:', e);
      });
    } catch (err) {
      console.error('Mapbox initialization failed:', err);
    }

    map.current.on('load', () => {
      // Add source for roads
      map.current.addSource('roads', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });

      // Add layer for roads
      map.current.addLayer({
        id: 'roads-layer',
        type: 'line',
        source: 'roads',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': [
            'interpolate',
            ['linear'],
            ['get', 'score'],
            0, '#4ade80',   // Green
            50, '#facc15',  // Yellow
            80, '#ef4444'   // Red
          ],
          'line-width': 4,
          'line-opacity': 0.8
        }
      });

      // Click event
      map.current.on('click', 'roads-layer', (e) => {
        const roadId = e.features[0].properties.id;
        const road = roads.find(r => r.id === roadId);
        if (road) onSelectRoad(road);
      });

      // Hover cursor
      map.current.on('mouseenter', 'roads-layer', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current.on('mouseleave', 'roads-layer', () => {
        map.current.getCanvas().style.cursor = '';
      });
    });
  }, []);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    const features = roads.map(road => ({
      type: 'Feature',
      properties: {
        id: road.id,
        score: road.totalScore,
        name: road.name
      },
      geometry: road.lineString.geometry
    }));

    const source = map.current.getSource('roads');
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features
      });
    }

    if (center && map.current) {
      map.current.flyTo({
        center: [center.lon, center.lat],
        essential: true,
        zoom: 12
      });
    }
  }, [roads, center]);

  useEffect(() => {
    if (!map.current || !selectedRoad) return;

    map.current.flyTo({
      center: selectedRoad.coordinates[0],
      zoom: 14,
      pitch: 60,
      bearing: 45,
      essential: true
    });
  }, [selectedRoad]);

  return (
    <div className="w-full h-full relative">
      <div ref={mapContainer} className="absolute inset-0" />
      <div className="absolute bottom-6 right-6 flex flex-col gap-2">
        <div className="glass p-2 rounded-lg flex flex-col gap-1 text-[10px] font-bold uppercase tracking-tighter">
          <div className="flex items-center gap-2">
            <div className="w-3 h-1 bg-red-500 rounded-full" />
            <span>Extreme Touge (80+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-1 bg-yellow-400 rounded-full" />
            <span>Spirited (50+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-1 bg-green-400 rounded-full" />
            <span>Scenic (0+)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapboxMap;

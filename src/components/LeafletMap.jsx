import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, ZoomControl, Marker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import '../utils/SmoothWheelZoom';

// Fix Leaflet icon issue
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Helper to update map view
const ChangeView = ({ center, zoom, bounds }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      const isDesktop = window.innerWidth > 768;
      // Estimate sidebar width based on App.jsx classes (md:w-80 = 320px, lg:w-1/4 = 25%)
      const sidebarWidth = window.innerWidth > 1024 ? window.innerWidth * 0.25 : 320;
      
      map.fitBounds(bounds, { 
        paddingTopLeft: [isDesktop ? sidebarWidth + 60 : 60, 60],
        paddingBottomRight: [isDesktop ? 420 + 60 : 60, 60],
        animate: true, 
        duration: 1.5 
      });
      return;
    }
    if (center) {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        map.setView([center.lat, center.lon], zoom);
      } else {
        map.flyTo([center.lat, center.lon], zoom, { animate: true, duration: 1.5 });
      }
    }
  }, [center, zoom, bounds, map]);
  return null;
};

const LeafletMap = ({ roads, unlistedRoads = [], selectedRoad, onSelectRoad, center, generatedTurns = [] }) => {
  const [zoom, setZoom] = useState(13);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const getScoreColor = (score) => {
    if (score >= 80) return '#ef4444'; // Red
    if (score >= 50) return '#facc15'; // Yellow
    return '#4ade80'; // Green
  };

  // Filter unlisted roads to only those not in the main roads list
  const filteredUnlisted = unlistedRoads.filter(ur => !roads.find(r => r.id === ur.id));

  return (
    <div className="w-full h-full relative bg-zinc-950">
      <MapContainer 
        center={center ? [center.lat, center.lon] : [40.7128, -74.006]} 
        zoom={zoom} 
        scrollWheelZoom={false}
        smoothWheelZoom={true}
        smoothSensitivity={3}
        zoomSnap={0}
        zoomDelta={0.25}
        inertia={true}
        inertiaDeceleration={3000}
        inertiaMaxSpeed={Infinity}
        dragging={true}
        tap={false}
        className="w-full h-full"
        zoomControl={false}
      >
        {/* Base topo layer — ESRI World Topo provides geometry and blue water, darkened via CSS filter */}
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
          className="map-tiles-dark"
          maxZoom={20}
          keepBuffer={16}
          updateWhenIdle={false}
        />
        
        <ZoomControl position="bottomright" />
        <ChangeView center={center} zoom={zoom} />

        {/* Render unlisted (filtered out) roads in a subtle grey */}
        {filteredUnlisted.map((road, idx) => (
          <Polyline
            key={`unlisted-${road.id}-${idx}`}
            positions={road.coordinates.map(c => [c[1], c[0]])}
            pathOptions={{
              color: '#3f3f46', // zinc-700
              weight: 3,
              opacity: 0.4,
              lineJoin: 'round'
            }}
            eventHandlers={{
              click: (e) => onSelectRoad(road, e.originalEvent.shiftKey)
            }}
          />
        ))}

        {roads.map((road, idx) => (
          <Polyline
            key={`${road.id}-${idx}`}
            positions={road.coordinates.map(c => [c[1], c[0]])}
            pathOptions={{
              color: getScoreColor(road.totalScore),
              weight: selectedRoad?.id === road.id ? 8 : 4,
              opacity: selectedRoad?.id === road.id ? 1 : 0.7,
              lineJoin: 'round'
            }}
            eventHandlers={{
              click: (e) => onSelectRoad(road, e.originalEvent.shiftKey)
            }}
          />
        ))}

        {selectedRoad && selectedRoad.coordinates && selectedRoad.coordinates.length > 0 && (
          <ChangeView 
            bounds={L.latLngBounds(selectedRoad.coordinates.map(c => [c[1], c[0]]))}
          />
        )}

        {generatedTurns.map((turn, idx) => (
          <Marker 
            key={`turn-${idx}`} 
            position={[turn.coordinate[1], turn.coordinate[0]]}
          >
            <Tooltip permanent direction="top" className="bg-black/80 text-white border-white/20 font-bold px-2 py-1 text-[10px] uppercase">
              {turn.text}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-6 right-16 z-[1000] flex flex-col gap-2">
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

export default LeafletMap;

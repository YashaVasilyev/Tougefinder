import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

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
const ChangeView = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        // setView is instant and safe on mobile — flyTo can crash low-RAM devices
        map.setView([center.lat, center.lon], zoom);
      } else {
        map.flyTo([center.lat, center.lon], zoom, { animate: true, duration: 1.5 });
      }
    }
  }, [center, zoom, map]);
  return null;
};

const LeafletMap = ({ roads, selectedRoad, onSelectRoad, center }) => {
  const [zoom, setZoom] = useState(13);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const getScoreColor = (score) => {
    if (score >= 80) return '#ef4444'; // Red
    if (score >= 50) return '#facc15'; // Yellow
    return '#4ade80'; // Green
  };

  return (
    <div className="w-full h-full relative bg-zinc-950">
      <MapContainer 
        center={center ? [center.lat, center.lon] : [40.7128, -74.006]} 
        zoom={zoom} 
        scrollWheelZoom={!isMobile}
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
        />
        
        <ZoomControl position="bottomright" />
        <ChangeView center={center} zoom={zoom} />

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
              click: () => onSelectRoad(road)
            }}
          />
        ))}

        {selectedRoad && selectedRoad.coordinates && selectedRoad.coordinates[0] && (
          <ChangeView 
            center={{ lat: selectedRoad.coordinates[0][1], lon: selectedRoad.coordinates[0][0] }} 
            zoom={14} 
          />
        )}
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

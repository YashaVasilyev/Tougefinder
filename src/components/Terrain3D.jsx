import React, { useMemo, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Environment, Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import { fetchTerrainGrid } from '../services/elevation';
import { Loader2, X, Maximize2, Minimize2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const TerrainMesh = ({ gridData }) => {
  const { grid, minLat, maxLat, minLon, maxLon } = gridData;
  const resolution = grid.length;
  
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(100, 100, resolution - 1, resolution - 1);
    const vertices = geo.attributes.position.array;
    
    // Find min/max elevation to normalize height
    let minE = Infinity;
    let maxE = -Infinity;
    grid.flat().forEach(e => {
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
    });
    
    const range = maxE - minE || 100;
    const heightScale = 20; // Max height in 3D units

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const index = (i * resolution + j) * 3;
        // Map grid [i][j] to plane vertices
        // Note: PlaneGeometry vertices go from top-left to bottom-right
        vertices[index + 2] = ((grid[i][j] - minE) / range) * heightScale;
      }
    }
    
    geo.computeVertexNormals();
    return geo;
  }, [grid, resolution]);

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial 
        color="#18181b" 
        wireframe={false} 
        roughness={0.8}
        metalness={0.2}
        flatShading={true}
      />
      <gridHelper args={[100, 10, '#ffffff05', '#ffffff05']} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.01]} />
    </mesh>
  );
};

const RoadLine = ({ roadCoords, gridData, elevationProfile }) => {
  const { grid, minLat, maxLat, minLon, maxLon } = gridData;
  
  // Find min/max elevation to normalize height same as terrain
  const minE = useMemo(() => Math.min(...grid.flat()), [grid]);
  const maxE = useMemo(() => Math.max(...grid.flat()), [grid]);
  const range = maxE - minE || 100;
  const heightScale = 20;

  const points = useMemo(() => {
    // If we have a profile, interpolate it to match roadCoords length
    // For now, if sizes don't match, we'll just use a sample or a fixed height fallback
    return roadCoords.map((c, i) => {
      const lon = c[0];
      const lat = c[1];
      
      const x = ((lon - minLon) / (maxLon - minLon)) * 100 - 50;
      const z = ((lat - minLat) / (maxLat - minLat)) * 100 - 50;
      
      let y = 0.5;
      if (elevationProfile && elevationProfile.length > 0) {
        // Find nearest point in profile
        const profileIndex = Math.floor((i / roadCoords.length) * elevationProfile.length);
        const elev = elevationProfile[profileIndex];
        y = ((elev - minE) / range) * heightScale + 0.5;
      }
      
      return new THREE.Vector3(x, y, -z);
    });
  }, [roadCoords, elevationProfile, minLat, maxLat, minLon, maxLon, minE, maxE, range]);

  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);
  const tubeGeometry = useMemo(() => new THREE.TubeGeometry(curve, 100, 0.4, 8, false), [curve]);

  return (
    <mesh geometry={tubeGeometry}>
      <meshStandardMaterial 
        color="#facc15" 
        emissive="#facc15" 
        emissiveIntensity={2} 
        toneMapped={false}
      />
    </mesh>
  );
};

const Terrain3D = ({ road, onClose, elevationProfile }) => {
  const [gridData, setGridData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = await fetchTerrainGrid(road.coordinates, 15);
      setGridData(data);
      setLoading(false);
    };
    loadData();
  }, [road]);

  return (
    <div className={cn(
      "fixed z-[2000] bg-zinc-950/95 backdrop-blur-3xl border border-white/10 shadow-2xl transition-all duration-500 overflow-hidden rounded-3xl",
      isFullscreen 
        ? "inset-4" 
        : "bottom-6 right-6 w-[420px] h-[420px]"
    )}>
      {/* Header */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-touge-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">3D Terrain Scan</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 text-touge-500 animate-spin" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Processing Mesh...</span>
        </div>
      ) : (
        <div className="w-full h-full">
          <Canvas shadows gl={{ antialias: true }}>
            <PerspectiveCamera makeDefault position={[80, 80, 80]} fov={35} />
            <OrbitControls 
              enableDamping 
              dampingFactor={0.05} 
              maxPolarAngle={Math.PI / 2.1}
              minDistance={30}
              maxDistance={150}
            />
            
            <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
            <ambientLight intensity={0.2} />
            <pointLight position={[100, 100, 100]} intensity={1} castShadow />
            <spotLight position={[-100, 100, -100]} intensity={0.5} />
            
            <TerrainMesh gridData={gridData} />
            <RoadLine roadCoords={road.coordinates} gridData={gridData} elevationProfile={elevationProfile} />
            
            <Environment preset="night" />

            <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
              <Text
                position={[0, 40, 0]}
                fontSize={3}
                color="white"
                font="https://fonts.gstatic.com/s/outfit/v11/Q_TX9S3nPTHL33nw17MxrCPN.woff"
                anchorX="center"
                anchorY="middle"
              >
                {road.name?.toUpperCase() || 'UNNAMED TOUGE'}
              </Text>
            </Float>
          </Canvas>
          
          <div className="absolute bottom-4 left-4 p-3 glass rounded-xl pointer-events-none">
            <div className="text-[8px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Telemetry</div>
            <div className="text-xs font-mono text-touge-400">ALT: {Math.max(...gridData.grid.flat()).toFixed(0)}m MAX</div>
            <div className="text-xs font-mono text-zinc-400">LAT: {gridData.minLat.toFixed(4)}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Terrain3D;

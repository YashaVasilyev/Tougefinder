import React, { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stars, Environment, Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import { fetchTerrainGrid } from '../services/elevation';
import { Loader2, X, Maximize2, Minimize2, Mountain, Play, Pause, RotateCcw, Video } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) { return twMerge(clsx(inputs)); }

// ─── Geo helpers ──────────────────────────────────────────────────────────────
function haversine([lon1, lat1], [lon2, lat2]) {
  const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function totalRoadLengthM(coords) {
  let d=0; for(let i=1;i<coords.length;i++) d+=haversine(coords[i-1],coords[i]); return d;
}
function makeSampler(grid, minLat, maxLat, minLon, maxLon) {
  const res = grid.length;
  return (lat, lon) => {
    const u=(lon-minLon)/(maxLon-minLon), v=(lat-minLat)/(maxLat-minLat);
    const col=u*(res-1), row=v*(res-1);
    const c0=Math.max(0,Math.min(res-2,Math.floor(col))), r0=Math.max(0,Math.min(res-2,Math.floor(row)));
    const fc=col-c0, fr=row-r0;
    return grid[r0][c0]*(1-fr)*(1-fc)+grid[r0][c0+1]*(1-fr)*fc
          +grid[r0+1][c0]*fr*(1-fc)+grid[r0+1][c0+1]*fr*fc;
  };
}

// ─── Speed profile from 3D curvature ─────────────────────────────────────────
function computeSpeedProfile(points) {
  const n = points.length;
  if (n < 3) return new Array(n).fill(1);
  const raw = new Array(n).fill(0);
  for (let i=1;i<n-1;i++) {
    const v1=new THREE.Vector3().subVectors(points[i],points[i-1]).normalize();
    const v2=new THREE.Vector3().subVectors(points[i+1],points[i]).normalize();
    raw[i]=Math.acos(Math.max(-1,Math.min(1,v1.dot(v2))));
  }
  raw[0]=raw[1]; raw[n-1]=raw[n-2];
  const win=Math.max(3,Math.floor(n*0.05));
  const sm=raw.map((_,i)=>{
    const lo=Math.max(0,i-win),hi=Math.min(n-1,i+win);
    let s=0; for(let k=lo;k<=hi;k++) s+=raw[k]; return s/(hi-lo+1);
  });
  const maxK=Math.max(...sm,0.001);
  const mult=sm.map(k=>0.25+(1-k/maxK)*1.05);
  const mean=mult.reduce((a,b)=>a+b,0)/n;
  return mult.map(v=>v/mean);
}

// ─── Turn markers from geo coordinates (radius method, matching pacenotes.js) ─
function computeTurnMarkers(coords) {
  if (coords.length < 5) return [];
  // Compute cumulative distance for progress mapping
  const cumd = [0];
  for (let i=1;i<coords.length;i++) cumd.push(cumd[i-1]+haversine(coords[i-1],coords[i]));
  const totalLen = cumd[cumd.length-1];

  const markers = [];
  const minGapM = 30; // minimum metres between reported turns
  let lastMarkerDist = -minGapM;

  const STEP = 2;
  for (let i=STEP; i<coords.length-STEP; i++) {
    const a=coords[i-STEP], b=coords[i], c=coords[i+STEP];
    const ab=haversine(a,b), bc=haversine(b,c), ac=haversine(a,c);
    const s=(ab+bc+ac)/2;
    const areaSq=Math.max(0,s*(s-ab)*(s-bc)*(s-ac));
    const radius = areaSq<=0 ? Infinity : (ab*bc*ac)/(4*Math.sqrt(areaSq));

    let label=null, color=null;
    if      (radius < 15)  { label='HP'; color='#ef4444'; }
    else if (radius < 25)  { label='K1'; color='#ef4444'; }
    else if (radius < 50)  { label='K2'; color='#f97316'; }
    else if (radius < 100) { label='K3'; color='#facc15'; }

    if (label && cumd[i]-lastMarkerDist >= minGapM) {
      // Bearing to decide L/R
      const dLon=coords[i+1][0]-coords[i-1][0], dLat=coords[i+1][1]-coords[i-1][1];
      const cross=(coords[i][0]-coords[i-1][0])*(coords[i+1][1]-coords[i-1][1])
                 -(coords[i][1]-coords[i-1][1])*(coords[i+1][0]-coords[i-1][0]);
      const dir = cross > 0 ? 'R' : 'L';
      markers.push({ progress: cumd[i]/totalLen, label, color, dir, radius: Math.round(radius) });
      lastMarkerDist = cumd[i];
    }
  }
  return markers;
}

// ─── Three.js components ──────────────────────────────────────────────────────
const TerrainMesh = ({ gridData, heightScale }) => {
  const { grid } = gridData;
  const res = grid.length;
  const { minE, maxE } = useMemo(()=>{ const f=grid.flat(); return{minE:Math.min(...f),maxE:Math.max(...f)}; },[grid]);
  const geometry = useMemo(()=>{
    const geo=new THREE.PlaneGeometry(100,100,res-1,res-1);
    const v=geo.attributes.position.array, range=maxE-minE||100;
    for(let i=0;i<res;i++) for(let j=0;j<res;j++) v[(i*res+j)*3+2]=((grid[i][j]-minE)/range)*heightScale;
    geo.computeVertexNormals(); geo.attributes.position.needsUpdate=true; return geo;
  },[grid,res,minE,maxE,heightScale]);
  return (
    <mesh geometry={geometry} rotation={[-Math.PI/2,0,0]} receiveShadow>
      <meshStandardMaterial color="#2d2d35" roughness={0.8} metalness={0.05} flatShading={false}/>
      <gridHelper args={[100,20,'#2a2a35','#1a1a22']} rotation={[Math.PI/2,0,0]} position={[0,0,0.01]}/>
    </mesh>
  );
};

const RoadLine = ({ roadCoords, gridData, heightScale, onPoints }) => {
  const { grid, minLat, maxLat, minLon, maxLon } = gridData;
  const minE=useMemo(()=>Math.min(...grid.flat()),[grid]);
  const maxE=useMemo(()=>Math.max(...grid.flat()),[grid]);
  const range=maxE-minE||100;
  const sample=useMemo(()=>makeSampler(grid,minLat,maxLat,minLon,maxLon),[grid,minLat,maxLat,minLon,maxLon]);
  const points=useMemo(()=>roadCoords.map(c=>{
    const x=((c[0]-minLon)/(maxLon-minLon))*100-50;
    const z=((c[1]-minLat)/(maxLat-minLat))*100-50;
    const y=((sample(c[1],c[0])-minE)/range)*heightScale+0.6;
    return new THREE.Vector3(x,y,z);
  }),[roadCoords,minLat,maxLat,minLon,maxLon,minE,range,heightScale,sample]);
  useEffect(()=>{ if(onPoints) onPoints(points); },[points,onPoints]);
  const curve=useMemo(()=>new THREE.CatmullRomCurve3(points),[points]);
  const geo=useMemo(()=>new THREE.TubeGeometry(curve,200,0.35,8,false),[curve]);
  return <mesh geometry={geo}><meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={2} toneMapped={false}/></mesh>;
};

const FlyoverCamera = ({ roadPoints, progress }) => {
  const { camera } = useThree();
  useEffect(()=>{
    if (!roadPoints||roadPoints.length<2) return;
    const curve=new THREE.CatmullRomCurve3(roadPoints);
    const t=Math.min(progress,0.9999), tL=Math.min(t+0.025,0.9999);
    const pos=curve.getPointAt(t), look=curve.getPointAt(tL);
    camera.position.set(pos.x,pos.y+5,pos.z);
    camera.lookAt(look.x,look.y+2.5,look.z);
  },[progress,roadPoints,camera]);
  return null;
};

// ─── Scrollable progress bar ──────────────────────────────────────────────────
const BAR_WIDTH = 1200; // px – wider than the panel, making it scrollable
const SEGMENTS  = 200;

const FlyoverBar = ({ progress, speedProfile, turnMarkers, onSeek }) => {
  const scrollRef = useRef(null);

  // Auto-scroll to keep playhead visible
  useEffect(()=>{
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const playheadX = progress * BAR_WIDTH;
    const halfW = container.clientWidth / 2;
    container.scrollLeft = Math.max(0, playheadX - halfW);
  },[progress]);

  // Build segment colour map from speedProfile
  const segColors = useMemo(()=>{
    if (!speedProfile) return [];
    return Array.from({length:SEGMENTS},(_,i)=>{
      const t = i/SEGMENTS;
      const idx = Math.min(Math.floor(t*(speedProfile.length-1)),speedProfile.length-1);
      const m = speedProfile[idx];
      if (m < 0.5) return '#ef4444';
      if (m < 0.8) return '#facc15';
      return '#22c55e';
    });
  },[speedProfile]);

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg" style={{WebkitOverflowScrolling:'touch'}}>
      <div style={{width:BAR_WIDTH, position:'relative', height:52, flexShrink:0}}>
        {/* Coloured speed-profile track */}
        <div style={{position:'absolute',bottom:0,left:0,right:0,height:8,display:'flex',borderRadius:4,overflow:'hidden'}}>
          {segColors.map((c,i)=>(
            <div key={i} style={{flex:1,background:c,opacity:0.35}}/>
          ))}
        </div>
        {/* Progress fill */}
        <div style={{
          position:'absolute',bottom:0,left:0,height:8,borderRadius:4,
          background:'white',opacity:0.9,transition:'none',
          width:`${progress*100}%`
        }}/>
        {/* Turn markers */}
        {turnMarkers.map((m,i)=>(
          <div key={i} style={{position:'absolute',bottom:0,left:`${m.progress*100}%`,transform:'translateX(-50%)',display:'flex',flexDirection:'column',alignItems:'center'}}>
            <div style={{
              fontSize:8,fontWeight:700,color:m.color,lineHeight:1.1,
              textShadow:'0 1px 4px #000',fontFamily:'monospace',
              marginBottom:2,whiteSpace:'nowrap',letterSpacing:'0.05em'
            }}>
              {m.dir}{m.label}
            </div>
            <div style={{width:1.5,height:14,background:m.color,opacity:0.8,borderRadius:1}}/>
            {/* Tick at bar bottom */}
            <div style={{width:1.5,height:8,background:m.color,opacity:0.8,borderRadius:1}}/>
          </div>
        ))}
        {/* Playhead */}
        <div style={{
          position:'absolute',bottom:-2,left:`${progress*100}%`,transform:'translateX(-50%)',
          width:2,height:14,background:'white',borderRadius:2,boxShadow:'0 0 6px #fff'
        }}/>
        {/* Clickable seek layer */}
        <div
          style={{position:'absolute',inset:0,cursor:'pointer'}}
          onClick={e=>{
            const rect=e.currentTarget.getBoundingClientRect();
            onSeek((e.clientX-rect.left)/rect.width);
          }}
        />
      </div>
    </div>
  );
};

// ─── Main Terrain3D component ─────────────────────────────────────────────────
const CAR_SPEED_MS = 50000/3600;

const Terrain3D = ({ road, onClose }) => {
  const [gridData, setGridData]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [heightScale, setHeightScale] = useState(30);
  const [roadPoints, setRoadPoints]   = useState(null);
  const [flyoverActive, setFlyoverActive] = useState(false);
  const [flyoverPlaying, setFlyoverPlaying] = useState(false);
  const [flyoverProgress, setFlyoverProgress] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [speedProfile, setSpeedProfile] = useState(null);
  const [baseProgressPerMs, setBaseProgressPerMs] = useState(null);
  const [turnMarkers, setTurnMarkers] = useState([]);
  const animRef = useRef(null);
  const lastTimeRef = useRef(null);

  useEffect(()=>{
    const load=async()=>{ setLoading(true); setGridData(await fetchTerrainGrid(road.coordinates)); setLoading(false); };
    load();
  },[road]);

  useEffect(()=>{
    if (!road?.coordinates?.length) return;
    const lenM=totalRoadLengthM(road.coordinates);
    setBaseProgressPerMs(1/((lenM/CAR_SPEED_MS)*1000));
    setTurnMarkers(computeTurnMarkers(road.coordinates));
  },[road]);

  useEffect(()=>{ if(roadPoints) setSpeedProfile(computeSpeedProfile(roadPoints)); },[roadPoints]);

  // Animation loop
  useEffect(()=>{
    if (!flyoverPlaying||!baseProgressPerMs||!speedProfile) {
      if(animRef.current) cancelAnimationFrame(animRef.current);
      lastTimeRef.current=null; return;
    }
    const tick=now=>{
      if(lastTimeRef.current!==null){
        const dt=now-lastTimeRef.current;
        setFlyoverProgress(p=>{
          if(p>=1){setFlyoverPlaying(false);return 1;}
          const idx=Math.min(Math.floor(p*(speedProfile.length-1)),speedProfile.length-1);
          return Math.min(1,p+baseProgressPerMs*speedMultiplier*speedProfile[idx]*dt);
        });
      }
      lastTimeRef.current=now;
      animRef.current=requestAnimationFrame(tick);
    };
    animRef.current=requestAnimationFrame(tick);
    return()=>{ if(animRef.current) cancelAnimationFrame(animRef.current); };
  },[flyoverPlaying,baseProgressPerMs,speedProfile,speedMultiplier]);

  const startFlyover=useCallback(()=>{ setFlyoverProgress(0);setFlyoverActive(true);setFlyoverPlaying(true); },[]);
  const resetFlyover=useCallback(()=>{ setFlyoverPlaying(false);setFlyoverProgress(0);setFlyoverActive(false); },[]);
  const handleSeek=useCallback(t=>{ setFlyoverProgress(Math.max(0,Math.min(1,t))); },[]);

  const localMult = speedProfile
    ? speedProfile[Math.min(Math.floor(flyoverProgress*(speedProfile.length-1)),speedProfile.length-1)]
    : 1;
  const displayKmh = Math.round(CAR_SPEED_MS*speedMultiplier*localMult*3.6);

  return (
    <div className={cn(
      "fixed z-[2000] bg-zinc-950/95 backdrop-blur-3xl border border-white/10 shadow-2xl transition-all duration-500 overflow-hidden rounded-3xl",
      isFullscreen ? "inset-4" : "bottom-6 right-6 w-[480px] h-[480px]"
    )}>
      {/* Header */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-touge-500 rounded-full animate-pulse"/>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
            {flyoverActive ? '⬤ FLYOVER' : '3D Terrain Scan'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!flyoverActive
            ? <button onClick={startFlyover} disabled={!roadPoints||!speedProfile}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-touge-500/20 border border-touge-500/40 text-touge-400 hover:bg-touge-500 hover:text-white transition-all disabled:opacity-30">
                <Video size={12}/> Flyover
              </button>
            : <>
                <button onClick={()=>setFlyoverPlaying(p=>!p)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white">
                  {flyoverPlaying ? <Pause size={14}/> : <Play size={14}/>}
                </button>
                <button onClick={resetFlyover} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white">
                  <RotateCcw size={14}/>
                </button>
              </>
          }
          <button onClick={()=>setIsFullscreen(!isFullscreen)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
            {isFullscreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}
          </button>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/50 hover:text-white">
            <X size={16}/>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 text-touge-500 animate-spin"/>
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Processing Mesh...</span>
        </div>
      ) : (
        <div className="w-full h-full">
          <Canvas shadows gl={{antialias:true}}>
            {!flyoverActive && <PerspectiveCamera makeDefault position={[80,80,80]} fov={45}/>}
            {flyoverActive  && <PerspectiveCamera makeDefault fov={75} near={0.1} far={1000}/>}
            {!flyoverActive && <OrbitControls enableDamping dampingFactor={0.05} maxPolarAngle={Math.PI/2.1} minDistance={10} maxDistance={500}/>}
            {flyoverActive && roadPoints && <FlyoverCamera roadPoints={roadPoints} progress={flyoverProgress}/>}
            <Stars radius={300} depth={60} count={10000} factor={7} saturation={0} fade speed={1}/>
            <color attach="background" args={['#020205']}/>
            <ambientLight intensity={0.5}/><pointLight position={[100,150,100]} intensity={2} castShadow/><spotLight position={[-100,100,-100]} intensity={1}/>
            <TerrainMesh gridData={gridData} heightScale={heightScale}/>
            <RoadLine roadCoords={road.coordinates} gridData={gridData} heightScale={heightScale} onPoints={setRoadPoints}/>
            <Environment preset="city"/>
            {!flyoverActive && (
              <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
                <Text position={[0,heightScale+20,0]} rotation={[0,Math.PI,0]} fontSize={5} color="#facc15" anchorX="center" anchorY="middle" maxWidth={100} textAlign="center">
                  {road.name?.toUpperCase()||'UNNAMED TOUGE'}
                </Text>
              </Float>
            )}
          </Canvas>

          {/* Bottom controls */}
          <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2">
            {flyoverActive && (
              <div className="p-3 bg-black/70 backdrop-blur border border-white/10 rounded-xl pointer-events-auto">
                {/* Speed & % */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">Route</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-touge-400">{displayKmh} km/h</span>
                    <span className="text-[10px] font-mono text-zinc-400">{(flyoverProgress*100).toFixed(1)}%</span>
                  </div>
                </div>
                {/* Scrollable progress bar */}
                <FlyoverBar
                  progress={flyoverProgress}
                  speedProfile={speedProfile}
                  turnMarkers={turnMarkers}
                  onSeek={handleSeek}
                />
                {/* Speed multiplier */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[8px] uppercase tracking-widest text-zinc-600 whitespace-nowrap w-12">{speedMultiplier.toFixed(2)}×</span>
                  <input type="range" min={0.25} max={5} step={0.05} value={speedMultiplier}
                    onChange={e=>setSpeedMultiplier(Number(e.target.value))}
                    className="flex-1 h-1 appearance-none rounded-full cursor-pointer"
                    style={{background:`linear-gradient(to right,#f97316 0%,#f97316 ${((speedMultiplier-0.25)/4.75)*100}%,#3f3f46 ${((speedMultiplier-0.25)/4.75)*100}%,#3f3f46 100%)`}}/>
                  <span className="text-[8px] text-zinc-600">5×</span>
                </div>
              </div>
            )}
            {!flyoverActive && (
              <div className="flex items-end gap-3 pointer-events-none">
                <div className="p-3 bg-black/60 backdrop-blur border border-white/10 rounded-xl pointer-events-none">
                  <div className="text-[8px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Telemetry</div>
                  <div className="text-xs font-mono text-touge-400">ALT: {Math.max(...gridData.grid.flat()).toFixed(0)}m MAX</div>
                  <div className="text-xs font-mono text-zinc-400">LAT: {gridData.minLat.toFixed(4)}</div>
                </div>
                <div className="flex-1 p-3 bg-black/60 backdrop-blur border border-white/10 rounded-xl pointer-events-auto">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Mountain size={10} className="text-zinc-500"/>
                      <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-500">Exaggeration</span>
                    </div>
                    <span className="text-[10px] font-mono text-touge-400">{heightScale}×</span>
                  </div>
                  <input type="range" min={1} max={100} step={1} value={heightScale}
                    onChange={e=>setHeightScale(Number(e.target.value))}
                    className="w-full h-1 appearance-none rounded-full cursor-pointer"
                    style={{background:`linear-gradient(to right,#f97316 0%,#f97316 ${(heightScale-1)/99*100}%,#3f3f46 ${(heightScale-1)/99*100}%,#3f3f46 100%)`}}/>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Terrain3D;

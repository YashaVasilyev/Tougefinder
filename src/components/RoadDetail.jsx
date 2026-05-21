import React, { useEffect, useState } from 'react';
import { X, ExternalLink, TrendingUp, ArrowUpRight, Clock, Ruler, Clipboard, Check, ArrowRightLeft, Box, Compass } from 'lucide-react';
import { fetchElevationForRoad } from '../services/elevation';
import { generatePacenotes, getCardinalDirection } from '../services/pacenotes';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const RoadDetail = ({ road, onClose, onNotesGenerated, onShow3D, onElevationLoaded, onAddToRoute, onRemoveFromRoute, isInRoute }) => {
  const [elevationData, setElevationData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isReversed, setIsReversed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [noteFormat, setNoteFormat] = useState('rally');

  useEffect(() => {
    const loadElevation = async () => {
      setLoading(true);
      const data = await fetchElevationForRoad(road.coordinates);
      setElevationData(data);
      if (onElevationLoaded) onElevationLoaded(data);
      setLoading(false);
    };
    loadElevation();
    setIsReversed(false); // Reset to forward when road changes
  }, [road]);

  const startDir = getCardinalDirection(road.coordinates[0], road.coordinates[road.coordinates.length - 1]);
  const endDir = getCardinalDirection(road.coordinates[road.coordinates.length - 1], road.coordinates[0]);

  const handleOpenMaps = () => {
    const [lon, lat] = road.coordinates[0];
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    if (isIOS) {
      // iOS: open Apple Maps showing the location
      window.open(`https://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(road.name)}`, '_blank');
    } else if (isAndroid) {
      // Android: open Google Maps at the location
      window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, '_blank');
    } else {
      // Desktop: open Google Maps at the location
      window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, '_blank');
    }
  };

  return (
    // Mobile: slides up from bottom covering ~33% of screen
    // Desktop: floats as a card on the bottom-right
    <div className="fixed inset-x-0 bottom-0 md:bottom-6 md:left-auto md:right-6 md:w-[420px] md:inset-x-auto z-[1003] flex flex-col"
      style={{ maxHeight: '67vh' }}
    >
      {/* Pull handle (mobile only) */}
      <div className="flex justify-center pb-2 md:hidden">
        <div className="w-10 h-1 bg-white/20 rounded-full" />
      </div>

      <div className="glass-dark rounded-t-[28px] md:rounded-[28px] shadow-2xl border border-white/10 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex justify-between items-start flex-shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <h2 className="text-xl font-bold tracking-tight truncate">{road.name}</h2>
            <div className="flex flex-wrap gap-2 items-center mt-1">
              <span className="px-2.5 py-0.5 bg-touge-600 rounded-full text-xs font-bold uppercase tracking-widest">
                Score {road.totalScore}
              </span>
              <span className="text-zinc-400 text-xs font-medium capitalize">{road.type}</span>
              {road.hasVariableSpeedLimit && (
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  Variable Limit (+15)
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 font-sans">
            {/* Real Speed Limit Sign */}
            {(() => {
              const rawSpeed = road.tags?.maxspeed;
              const isVariable = road.hasVariableSpeedLimit;
              
              if (!rawSpeed && !isVariable) return null;
              
              let displaySpeed = null;
              if (rawSpeed) {
                const isNumeric = /^\d+$/.test(rawSpeed.trim());
                const isMph = /^\d+\s*mph$/i.test(rawSpeed.trim());
                if (isNumeric) {
                  const kmh = parseInt(rawSpeed.trim(), 10);
                  displaySpeed = Math.round(kmh * 0.621371);
                } else if (isMph) {
                  displaySpeed = parseInt(rawSpeed.trim(), 10);
                }
              }

              if (isVariable) {
                return (
                  <div className="w-[34px] h-[42px] bg-zinc-950 rounded-sm border-[2px] border-zinc-700 flex flex-col items-center justify-between py-1 px-[2px] shadow-lg select-none font-bold text-amber-500 ring-1 ring-white/5" title="Variable Speed Limit">
                    <span className="text-[5px] font-black tracking-tighter uppercase leading-none text-zinc-500 scale-90 -mt-[1px]">SPEED</span>
                    <span className="text-[5px] font-black tracking-tighter uppercase leading-none text-zinc-500 scale-90 -mt-[2px]">LIMIT</span>
                    <span className="text-[10px] font-black leading-none tracking-wider text-amber-400 animate-pulse pb-[2px] font-mono">VAR</span>
                  </div>
                );
              }

              if (displaySpeed) {
                return (
                  <div className="w-[34px] h-[42px] bg-white rounded-sm border-[2px] border-slate-950 flex flex-col items-center justify-between py-1 px-[2px] shadow-lg select-none font-bold text-slate-900 border-black ring-1 ring-white/10" title={`Speed Limit: ${displaySpeed} MPH`}>
                    <span className="text-[5px] font-black tracking-tighter uppercase leading-none text-slate-800 scale-90 -mt-[1px]">SPEED</span>
                    <span className="text-[5px] font-black tracking-tighter uppercase leading-none text-slate-800 scale-90 -mt-[2px]">LIMIT</span>
                    <span className="text-sm font-black leading-none tracking-tight text-black tabular-nums pb-[1px]">{displaySpeed}</span>
                  </div>
                );
              }

              return null;
            })()}

            <button
              onClick={onClose}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10 flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 pb-5 space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={<Ruler className="w-4 h-4 text-touge-400" />} label="Length" value={`${road.lengthMiles} mi`} />
            <StatCard icon={<TrendingUp className="w-4 h-4 text-blue-400" />} label="Avg Grade" value={elevationData ? `${elevationData.avgGrade}%` : '—'} />
            <StatCard icon={<ArrowUpRight className="w-4 h-4 text-green-400" />} label="Ascent" value={elevationData ? `${elevationData.gain} ft` : '—'} />
            <StatCard icon={<Clock className="w-4 h-4 text-yellow-400" />} label="Curvature" value={road.maxIntensity ? `${road.maxIntensity}°/mi` : '—'} />
          </div>

          {/* Score Breakdown */}
          <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-2">
            <ScoreBar label="Curvature" value={road.curvatureScore} max={60} color="bg-red-500" />
            <ScoreBar label="Flow" value={road.flowScore} max={40} color="bg-blue-500" />
          </div>

          {/* Pacenotes Section */}
          <div className="bg-zinc-900/50 rounded-2xl p-4 border border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Pacenotes</h3>
              <button
                onClick={() => setIsReversed(!isReversed)}
                className="flex items-center gap-1.5 text-[10px] font-bold text-touge-400 uppercase bg-touge-400/10 px-2 py-1 rounded-lg hover:bg-touge-400/20 transition-colors"
              >
                <ArrowRightLeft className="w-3 h-3" />
                {isReversed ? `${startDir} → ${endDir}` : `${endDir} → ${startDir}`}
              </button>
            </div>

            <div className="flex bg-black/30 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setNoteFormat('rally')}
                className={cn(
                  "flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all",
                  noteFormat === 'rally' ? "bg-touge-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-400"
                )}
              >
                Rally (L3)
              </button>
              <button
                onClick={() => setNoteFormat('descriptive')}
                className={cn(
                  "flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all",
                  noteFormat === 'descriptive' ? "bg-touge-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-400"
                )}
              >
                Descriptive
              </button>
            </div>

            <button
              onClick={() => {
                const { text, turns } = generatePacenotes(road.coordinates, {
                  reverse: isReversed,
                  format: noteFormat,
                  elevationProfile: elevationData?.profile,
                  returnObject: true
                });
                navigator.clipboard.writeText(text);
                setCopied(true);
                if (onNotesGenerated) {
                  onNotesGenerated(turns);
                }
                setTimeout(() => setCopied(false), 2000);
              }}
              className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-400" />
                  <span className="text-green-400">Copied to Clipboard</span>
                </>
              ) : (
                <>
                  <Clipboard className="w-4 h-4 text-zinc-400" />
                  <span>Generate & Copy Pacenotes</span>
                </>
              )}
            </button>
            <p className="text-[10px] text-zinc-500 text-center leading-relaxed italic">
              {noteFormat === 'rally'
                ? '"1 is tight, 6 is slight. Distances in meters."'
                : '"Real-world terms for easier reading on the fly."'}
            </p>
          </div>

          {/* Navigate Button */}
          <div className="flex gap-2">
            <button
              onClick={handleOpenMaps}
              className="flex-1 btn-secondary flex items-center justify-center gap-2 text-xs py-3"
            >
              <ExternalLink size={14} />
              Open in Maps
            </button>
            <button
              onClick={onShow3D}
              className="px-3 btn-secondary flex items-center justify-center gap-2 text-xs py-3 bg-touge-500/10 border-touge-500/30 text-touge-400 hover:bg-touge-500 hover:text-white"
            >
              <Box size={14} />
              3D View
            </button>
            {onAddToRoute && (
              <button
                onClick={() => isInRoute ? onRemoveFromRoute(road) : onAddToRoute(road)}
                className={cn(
                  "px-3 btn-secondary flex items-center justify-center gap-2 text-xs py-3 transition-all",
                  isInRoute
                    ? "bg-purple-600/25 border-purple-500/40 text-purple-300 hover:bg-purple-600 hover:text-white"
                    : "bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10"
                )}
                title={isInRoute ? "Remove from Route" : "Add to Planned Route"}
              >
                <Compass size={14} />
                {isInRoute ? "Saved" : "+ Route"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value }) => (
  <div className="bg-white/5 rounded-2xl p-4 border border-white/5 flex flex-col gap-1">
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
    </div>
    <span className="text-lg font-bold tracking-tight">{value}</span>
  </div>
);

const ScoreBar = ({ label, value, max, color }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-xs text-zinc-400 font-medium">
      <span>{label}</span>
      <span>{value}/{max}</span>
    </div>
    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all duration-500`}
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  </div>
);

export default RoadDetail;

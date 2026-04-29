import React from 'react';
import { ChevronRight, Activity, TrendingUp, Car } from 'lucide-react';
import { motion } from 'framer-motion';

const RoadList = ({ roads, loading, onSelectRoad, selectedRoad }) => {
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-32 w-full bg-zinc-900 animate-pulse rounded-3xl border border-white/5" />
        ))}
      </div>
    );
  }

  if (roads.length === 0) {
    return (
      <div className="text-center py-20">
        <Activity className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
        <p className="text-zinc-500 font-medium">No mountain roads found in this radius.</p>
        <p className="text-zinc-600 text-sm">Try increasing the search radius or a different area.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      {roads.map((road, index) => (
        <motion.button
          key={road.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          onClick={(e) => onSelectRoad(road, e.shiftKey)}
          className={`group relative text-left w-full p-5 rounded-3xl transition-all duration-300 border ${
            selectedRoad?.id === road.id 
              ? 'bg-touge-600/10 border-touge-500 shadow-xl shadow-touge-900/10' 
              : 'bg-zinc-900/50 border-white/5 hover:border-white/10 hover:bg-zinc-900'
          }`}
        >
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1">
              <h3 className="text-lg font-bold line-clamp-1 group-hover:text-touge-400 transition-colors">
                {road.name}
              </h3>
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                {road.type} • {road.lengthMiles} miles
              </p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${getScoreColor(road.totalScore)}`}>
              {road.totalScore}
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex-1 bg-black/40 rounded-xl p-2 flex flex-col items-center justify-center border border-white/5">
              <TrendingUp className="w-3 h-3 text-touge-400 mb-1" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Twistiness</span>
              <span className="text-xs font-bold">{road.curvatureScore}</span>
            </div>
            <div className="flex-1 bg-black/40 rounded-xl p-2 flex flex-col items-center justify-center border border-white/5">
              <Activity className="w-3 h-3 text-blue-400 mb-1" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Elevation</span>
              <span className="text-xs font-bold">{road.elevationScore}</span>
            </div>
            <div className="flex-1 bg-black/40 rounded-xl p-2 flex flex-col items-center justify-center border border-white/5">
              <Car className="w-3 h-3 text-green-400 mb-1" />
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Flow</span>
              <span className="text-xs font-bold">{road.flowScore || 0}</span>
            </div>
          </div>

          <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all group-hover:translate-x-1">
            <ChevronRight className="w-5 h-5 text-touge-500" />
          </div>
        </motion.button>
      ))}
    </div>
  );
};

const getScoreColor = (score) => {
  if (score >= 80) return 'bg-red-500/20 text-red-400 border border-red-500/20';
  if (score >= 50) return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/20';
  return 'bg-green-500/20 text-green-400 border border-green-500/20';
};

export default RoadList;

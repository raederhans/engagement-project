import { Card } from './ui/card';
import { Separator } from './ui/separator';
import { TrendingUp, Tag, Clock } from 'lucide-react';

interface RightPanelProps {
  showSubmitHint?: boolean;
  isPostSubmit?: boolean;
  communityInteractions?: {
    agrees: number;
    improvements: number;
  };
}

// Base mock data for post-submit state
const baseTrendData = [3.2, 3.4, 3.1, 3.5, 3.6, 3.8, 4.0, 4.1];
const baseTopTags = [
  { tag: 'poor lighting', count: 12 },
  { tag: 'low foot traffic', count: 8 },
  { tag: 'cars too close', count: 6 },
];
const heatmapData = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Mon
  [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 2, 2, 2, 3, 3, 4, 4, 3, 2, 1, 0, 0, 0], // Tue
  [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 2, 2, 3, 3, 4, 4, 4, 3, 2, 1, 0, 0, 0], // Wed
  [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 2, 2, 2, 3, 4, 4, 4, 3, 2, 1, 0, 0, 0], // Thu
  [0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 2, 2, 3, 3, 4, 4, 5, 4, 3, 2, 1, 0, 0], // Fri
  [0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 3, 4, 4, 5, 4, 3, 2, 1, 0, 0], // Sat
  [0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 3, 3, 4, 4, 3, 2, 1, 0, 0, 0], // Sun
];
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getHeatmapColor(value: number): string {
  if (value === 0) return '#f5f5f5';
  if (value === 1) return '#fef3c7';
  if (value === 2) return '#fcd34d';
  if (value === 3) return '#fbbf24';
  if (value === 4) return '#f59e0b';
  return '#d97706';
}

export function RightPanel({ 
  showSubmitHint = false, 
  isPostSubmit = false,
  communityInteractions = { agrees: 0, improvements: 0 },
}: RightPanelProps) {
  // Adjust data based on community interactions
  const trendData = baseTrendData.map((val, i) => {
    if (i === baseTrendData.length - 1) {
      // Latest point increases with improvements
      return val + (communityInteractions.improvements * 0.05);
    }
    return val;
  });

  const topTags = baseTopTags.map(tag => ({
    ...tag,
    // Confidence influences tag counts slightly
    count: tag.count + Math.floor(communityInteractions.agrees * 0.1),
  }));
  return (
    <div className="w-[360px] border-l border-neutral-200 bg-white flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="p-6 pb-4">
        <h2 className="text-neutral-900">Insights</h2>
      </div>
      
      <Separator className="bg-neutral-200" />

      {/* Insights Stack */}
      <div className="flex-1 p-4 space-y-4">
        {/* Trend Card */}
        <Card className="p-4 border-neutral-200">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-neutral-400" />
            <h3 className="text-sm text-neutral-700">Trend</h3>
          </div>
          {isPostSubmit ? (
            <div className="h-24 flex items-end gap-1">
              {trendData.map((value, i) => (
                <div key={i} className="flex-1 flex flex-col justify-end">
                  <div
                    className="w-full bg-neutral-900 rounded-t transition-all"
                    style={{ height: `${(value / 5) * 100}%` }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center border-2 border-dashed border-neutral-200 rounded bg-neutral-50">
              <p className="text-xs text-neutral-400 text-center px-4">
                Chart will appear after<br />your first rating
              </p>
            </div>
          )}
        </Card>

        {/* Top Tags Card */}
        <Card className="p-4 border-neutral-200">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="h-4 w-4 text-neutral-400" />
            <h3 className="text-sm text-neutral-700">Top Tags</h3>
          </div>
          {isPostSubmit ? (
            <div className="space-y-2">
              {topTags.map((item, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-700">{item.tag}</span>
                    <span className="text-neutral-500">{item.count}</span>
                  </div>
                  <div className="h-1.5 bg-neutral-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-neutral-900 rounded transition-all"
                      style={{ width: `${(item.count / 12) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center border-2 border-dashed border-neutral-200 rounded bg-neutral-50">
              <p className="text-xs text-neutral-400 text-center px-4">
                Tags will populate after<br />your first rating
              </p>
            </div>
          )}
        </Card>

        {/* 7×24 Heatmap Card */}
        <Card className="p-4 border-neutral-200">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-neutral-400" />
            <h3 className="text-sm text-neutral-700">7×24 Heatmap</h3>
          </div>
          {isPostSubmit ? (
            <div className="space-y-1">
              {heatmapData.map((row, dayIndex) => (
                <div key={dayIndex} className="flex gap-0.5 items-center">
                  <span className="text-xs text-neutral-600 w-8">{days[dayIndex]}</span>
                  {row.map((value, hourIndex) => (
                    <div
                      key={hourIndex}
                      className="w-2 h-3 rounded-sm"
                      style={{ backgroundColor: getHeatmapColor(value) }}
                      title={`${days[dayIndex]} ${hourIndex}:00`}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center border-2 border-dashed border-neutral-200 rounded bg-neutral-50">
              <p className="text-xs text-neutral-400 text-center px-4">
                Heatmap will show patterns<br />after your first rating
              </p>
            </div>
          )}
        </Card>

        {/* Helper Text */}
        {!isPostSubmit && (
          <p className="text-xs text-neutral-500 text-center pt-2">
            {showSubmitHint 
              ? 'Submit to see trends and patterns' 
              : 'Insights will populate after your first rating'}
          </p>
        )}
      </div>
    </div>
  );
}

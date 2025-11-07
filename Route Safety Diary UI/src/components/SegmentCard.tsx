import { TrendingUp, TrendingDown, ThumbsUp, Sparkles, X, Users } from 'lucide-react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';

interface SegmentCardProps {
  rating: number;
  trend: number;
  confidence: number;
  tags: string[];
  position: { x: number; y: number };
  onClose: () => void;
  onAgree: () => void;
  onImprovement: () => void;
  onViewDetails?: () => void;
}

export function SegmentCard({
  rating,
  trend,
  confidence,
  tags,
  position,
  onClose,
  onAgree,
  onImprovement,
  onViewDetails,
}: SegmentCardProps) {
  const trendColor = trend > 0 ? 'text-green-600' : trend < 0 ? 'text-red-600' : 'text-neutral-500';
  const TrendIcon = trend > 0 ? TrendingUp : TrendingDown;

  return (
    <Card
      className="absolute bg-white border border-neutral-300 shadow-xl rounded-lg p-4 w-72 z-50 animate-in fade-in zoom-in-95 duration-200"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -120%)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-neutral-900">Segment Details</span>
          </div>
          <button
            onClick={onViewDetails}
            className="mt-1 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 transition-colors group"
          >
            <Users className="h-3.5 w-3.5 group-hover:scale-110 transition-transform" />
            <span className="underline decoration-dotted">View community insights</span>
          </button>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-neutral-200">
        <div className="text-center">
          <div className="text-xs text-neutral-500 mb-1">Rating</div>
          <div className="text-lg text-neutral-900">{rating.toFixed(1)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-neutral-500 mb-1">Δ30d</div>
          <div className={`flex items-center justify-center gap-1 text-sm ${trendColor}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            <span>{trend > 0 ? '+' : ''}{trend.toFixed(1)}</span>
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-neutral-500 mb-1">n_eff</div>
          <div className="text-lg text-neutral-900">{Math.round(confidence * 100)}</div>
        </div>
      </div>

      {/* Top Tags */}
      <div className="mb-4">
        <div className="text-xs text-neutral-500 mb-2">Top Tags</div>
        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 3).map((tag, i) => (
            <Badge
              key={i}
              variant="outline"
              className="text-xs bg-neutral-50 border-neutral-200 text-neutral-700"
            >
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onAgree}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-neutral-100 hover:bg-neutral-900 hover:text-white text-neutral-700 text-xs transition-all shadow-sm hover:shadow active:scale-95"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          <span>Agree</span>
        </button>
        <button
          onClick={onImprovement}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-neutral-100 hover:bg-neutral-900 hover:text-white text-neutral-700 text-xs transition-all shadow-sm hover:shadow active:scale-95"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Feels safer</span>
        </button>
      </div>
    </Card>
  );
}

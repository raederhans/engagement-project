import { MapPin, Circle, FolderOpen, Eye, ThumbsUp, Sparkles } from 'lucide-react';
import { Separator } from './ui/separator';

interface LeftPanelProps {
  showLegend: boolean;
  onToggleLegend: () => void;
}

export function LeftPanel({ showLegend, onToggleLegend }: LeftPanelProps) {
  return (
    <div className="w-80 border-r border-neutral-200 bg-white flex flex-col">
      {/* Header */}
      <div className="p-6 pb-4">
        <h2 className="text-neutral-900">Diary Controls</h2>
      </div>
      
      <Separator className="bg-neutral-200" />

      {/* Control List */}
      <div className="flex-1 p-4">
        <div className="space-y-1">
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded hover:bg-neutral-50 transition-colors text-left group">
            <MapPin className="h-4 w-4 text-neutral-400 group-hover:text-neutral-600" />
            <span className="text-sm text-neutral-700 group-hover:text-neutral-900">Plan route</span>
          </button>
          
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded hover:bg-neutral-50 transition-colors text-left group">
            <Circle className="h-4 w-4 text-neutral-400 group-hover:text-neutral-600" />
            <span className="text-sm text-neutral-700 group-hover:text-neutral-900">Record trip</span>
          </button>
          
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded hover:bg-neutral-50 transition-colors text-left group">
            <FolderOpen className="h-4 w-4 text-neutral-400 group-hover:text-neutral-600" />
            <span className="text-sm text-neutral-700 group-hover:text-neutral-900">My routes</span>
          </button>
          
          <Separator className="my-2 bg-neutral-100" />
          
          <button 
            onClick={onToggleLegend}
            className="w-full flex items-center gap-3 px-4 py-3 rounded hover:bg-neutral-50 transition-colors text-left group"
          >
            <Eye className="h-4 w-4 text-neutral-400 group-hover:text-neutral-600" />
            <span className="text-sm text-neutral-700 group-hover:text-neutral-900">
              Legend {showLegend ? '(visible)' : '(hidden)'}
            </span>
          </button>
        </div>

        {/* Community Actions Info */}
        <div className="mt-6 px-4 py-3 bg-neutral-50 rounded-lg border border-neutral-200">
          <div className="text-xs text-neutral-600 mb-2">Community actions</div>
          <div className="space-y-2 text-xs text-neutral-600">
            <div className="flex items-center gap-2">
              <ThumbsUp className="h-3 w-3 text-neutral-400" />
              <span>Agree: confirm segment rating</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-3 w-3 text-neutral-400" />
              <span>Safer: flag improvement</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

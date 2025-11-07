import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { X, Users } from 'lucide-react';

interface TopBarProps {
  mode: 'crime' | 'diary' | 'tracts';
  onModeChange: (mode: 'crime' | 'diary' | 'tracts') => void;
}

export function TopBar({ mode, onModeChange }: TopBarProps) {
  return (
    <div className="h-14 border-b border-neutral-200 bg-white flex items-center px-6 gap-6">
      {/* Mode Switch */}
      <div className="flex items-center gap-1 text-sm">
        <button
          onClick={() => onModeChange('crime')}
          className={`px-3 py-1.5 rounded transition-colors ${
            mode === 'crime' 
              ? 'bg-neutral-900 text-white' 
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Crime
        </button>
        <span className="text-neutral-300">|</span>
        <button
          onClick={() => onModeChange('diary')}
          className={`px-3 py-1.5 rounded transition-colors ${
            mode === 'diary' 
              ? 'bg-neutral-900 text-white' 
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Route Safety Diary
        </button>
        <span className="text-neutral-300">|</span>
        <button
          onClick={() => onModeChange('tracts')}
          className={`px-3 py-1.5 rounded transition-colors ${
            mode === 'tracts' 
              ? 'bg-neutral-900 text-white' 
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          Tracts
        </button>
      </div>

      {/* Time Window Selector */}
      <Select defaultValue="7d">
        <SelectTrigger className="w-32 h-8 text-sm border-neutral-300">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="24h">Last 24h</SelectItem>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
          <SelectItem value="90d">Last 90 days</SelectItem>
          <SelectItem value="1y">Last year</SelectItem>
        </SelectContent>
      </Select>

      {/* Filter Chips */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="h-7 px-2.5 gap-1.5 text-xs">
          Pedestrian
          <X className="h-3 w-3 cursor-pointer hover:text-neutral-900" />
        </Badge>
        <Badge variant="secondary" className="h-7 px-2.5 gap-1.5 text-xs">
          Evening
          <X className="h-3 w-3 cursor-pointer hover:text-neutral-900" />
        </Badge>
      </div>

      {/* Community Activity Hint */}
      <div className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-neutral-50 rounded-full border border-neutral-200">
        <Users className="h-3.5 w-3.5 text-neutral-600" />
        <span className="text-xs text-neutral-600">Click segments for insights</span>
      </div>
    </div>
  );
}

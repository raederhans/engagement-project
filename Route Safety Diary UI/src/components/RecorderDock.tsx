import { Play, Pause, Square } from 'lucide-react';
import { Button } from './ui/button';

interface RecorderDockProps {
  isFinished?: boolean;
}

export function RecorderDock({ isFinished = false }: RecorderDockProps) {
  if (isFinished) {
    return (
      <div className="absolute bottom-6 right-6 bg-white border border-neutral-200 rounded-lg shadow-lg p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-600 mr-1">Recorder</span>
          <span className="text-xs text-neutral-500 px-3 py-2 bg-neutral-50 rounded">
            Finish pressed
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-6 right-6 bg-white border border-neutral-200 rounded-lg shadow-lg p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-600 mr-1">Recorder</span>
        
        <Button 
          size="sm" 
          className="h-8 px-3 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
        >
          <Play className="h-3.5 w-3.5" />
          Start
        </Button>
        
        <Button 
          size="sm" 
          variant="outline" 
          className="h-8 px-3 gap-1.5" 
          disabled
        >
          <Pause className="h-3.5 w-3.5" />
          Pause
        </Button>
        
        <Button 
          size="sm" 
          variant="outline" 
          className="h-8 px-3 gap-1.5" 
          disabled
        >
          <Square className="h-3.5 w-3.5" />
          Finish
        </Button>
      </div>
    </div>
  );
}

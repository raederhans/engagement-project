import { useState, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { MapCanvas } from './components/MapCanvas';
import { RightPanel } from './components/RightPanel';
import { RecorderDock } from './components/RecorderDock';
import { RatingModal } from './components/RatingModal';
import { Snackbar } from './components/Snackbar';

export type SegmentData = {
  id: number;
  rating: number;
  trend: number;
  confidence: number;
  tags: string[];
  position: { x: number; y: number };
};

export default function App() {
  const [mode, setMode] = useState<'crime' | 'diary' | 'tracts'>('diary');
  const [showLegend, setShowLegend] = useState(true);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [isPostSubmit, setIsPostSubmit] = useState(true); // Set to true to show post-submit state
  const [selectedSegment, setSelectedSegment] = useState<SegmentData | null>(null);
  const [communityInteractions, setCommunityInteractions] = useState({
    agrees: 0,
    improvements: 0,
  });

  useEffect(() => {
    if (isPostSubmit) {
      setSnackbarMessage('Thanks — updating map.');
      const timer = setTimeout(() => setSnackbarMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [isPostSubmit]);

  const handleSegmentClick = (segment: SegmentData) => {
    setSelectedSegment(segment);
  };

  const handleAgree = () => {
    setCommunityInteractions(prev => ({ ...prev, agrees: prev.agrees + 1 }));
    setSnackbarMessage('Thanks — confidence updated');
    setTimeout(() => setSnackbarMessage(null), 2000);
    setSelectedSegment(null);
  };

  const handleImprovement = () => {
    setCommunityInteractions(prev => ({ ...prev, improvements: prev.improvements + 1 }));
    setSnackbarMessage('Thanks — improvement noted');
    setTimeout(() => setSnackbarMessage(null), 2000);
    setSelectedSegment(null);
  };

  const handleAlternativeHelpful = () => {
    setSnackbarMessage('Thanks for the feedback');
    setTimeout(() => setSnackbarMessage(null), 2000);
  };

  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      {/* Top Bar */}
      <TopBar mode={mode} onModeChange={setMode} />
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <LeftPanel 
          showLegend={showLegend} 
          onToggleLegend={() => setShowLegend(!showLegend)} 
        />
        
        {/* Map Canvas */}
        <div className="flex-1 relative">
          <MapCanvas 
            showLegend={showLegend} 
            isDimmed={showRatingModal}
            isPostSubmit={isPostSubmit}
            onSegmentClick={handleSegmentClick}
            selectedSegment={selectedSegment}
            onCloseSegmentCard={() => setSelectedSegment(null)}
            onAgree={handleAgree}
            onImprovement={handleImprovement}
            onAlternativeHelpful={handleAlternativeHelpful}
          />
          <RecorderDock isFinished={showRatingModal} />
        </div>
        
        {/* Right Panel */}
        <RightPanel 
          showSubmitHint={showRatingModal}
          isPostSubmit={isPostSubmit}
          communityInteractions={communityInteractions}
        />
      </div>

      {/* Rating Modal */}
      {showRatingModal && (
        <RatingModal 
          onClose={() => setShowRatingModal(false)}
          onSubmit={() => {
            setShowRatingModal(false);
            setIsPostSubmit(true);
          }}
        />
      )}

      {/* Snackbar */}
      {snackbarMessage && (
        <Snackbar message={snackbarMessage} />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { X, ThumbsUp } from 'lucide-react';
import { SegmentCard } from './SegmentCard';
import { CommunityDetailsModal } from './CommunityDetailsModal';
import type { SegmentData } from '../App';

interface MapCanvasProps {
  showLegend: boolean;
  isDimmed?: boolean;
  isPostSubmit?: boolean;
  onSegmentClick: (segment: SegmentData) => void;
  selectedSegment: SegmentData | null;
  onCloseSegmentCard: () => void;
  onAgree: () => void;
  onImprovement: () => void;
  onAlternativeHelpful: () => void;
}

// Mock street segments with ratings and confidence
const streetSegments = [
  // High safety, high confidence
  { x1: 150, y1: 100, x2: 350, y2: 100, rating: 5, confidence: 0.9 },
  { x1: 350, y1: 100, x2: 450, y2: 180, rating: 5, confidence: 0.85 },
  
  // Good safety, medium confidence
  { x1: 200, y1: 200, x2: 400, y2: 200, rating: 4, confidence: 0.6 },
  { x1: 400, y1: 200, x2: 500, y2: 280, rating: 4, confidence: 0.7 },
  
  // Moderate safety, varying confidence
  { x1: 250, y1: 300, x2: 450, y2: 300, rating: 3, confidence: 0.5 },
  { x1: 450, y1: 300, x2: 550, y2: 380, rating: 3, confidence: 0.4 },
  
  // Lower safety, low confidence
  { x1: 300, y1: 400, x2: 500, y2: 400, rating: 2, confidence: 0.3 },
  { x1: 500, y1: 400, x2: 600, y2: 480, rating: 2, confidence: 0.35 },
  
  // Poor safety, very low confidence
  { x1: 350, y1: 500, x2: 550, y2: 500, rating: 1, confidence: 0.2 },
  { x1: 550, y1: 500, x2: 650, y2: 580, rating: 1, confidence: 0.25 },
  
  // Additional network segments
  { x1: 100, y1: 150, x2: 300, y2: 250, rating: 4, confidence: 0.65 },
  { x1: 450, y1: 180, x2: 650, y2: 180, rating: 5, confidence: 0.8 },
  { x1: 150, y1: 350, x2: 250, y2: 450, rating: 3, confidence: 0.45 },
  { x1: 600, y1: 250, x2: 700, y2: 350, rating: 2, confidence: 0.4 },
];

// Faint incident clusters for context
const incidents = [
  { x: 320, y: 430, count: 3 },
  { x: 580, y: 520, count: 5 },
  { x: 220, y: 310, count: 2 },
];

function getRatingColor(rating: number): string {
  const colors = {
    5: '#10b981', // green
    4: '#84cc16', // lime
    3: '#fbbf24', // amber
    2: '#f97316', // orange
    1: '#ef4444', // red
  };
  return colors[rating as keyof typeof colors] || '#6b7280';
}

// Mock segment tags
const segmentTags = [
  ['poor lighting', 'low foot traffic'],
  ['well lit', 'busy area'],
  ['construction', 'narrow sidewalk'],
  ['bike lane', 'good lighting'],
  ['poor lighting', 'low foot traffic'],
  ['dogs', 'narrow path'],
  ['cars too close', 'poor lighting'],
  ['low foot traffic', 'dogs'],
  ['poor lighting', 'isolated'],
  ['construction blockage'],
  ['bike lane', 'good lighting'],
  ['well maintained'],
  ['narrow sidewalk', 'low foot traffic'],
  ['cars too close'],
];

export function MapCanvas({ 
  showLegend, 
  isDimmed = false, 
  isPostSubmit = false,
  onSegmentClick,
  selectedSegment,
  onCloseSegmentCard,
  onAgree,
  onImprovement,
  onAlternativeHelpful,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAlternative, setShowAlternative] = useState(false);
  const [showCommunityDetails, setShowCommunityDetails] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);

  useEffect(() => {
    if (isPostSubmit) {
      setShowAlternative(true);
    }
  }, [isPostSubmit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw subtle grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    const gridSize = 50;
    for (let x = 0; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw faint incident clusters
    incidents.forEach(incident => {
      const radius = 8 + incident.count * 2;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.06)';
      ctx.beginPath();
      ctx.arc(incident.x, incident.y, radius, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Draw street segments with updated values if post-submit
    streetSegments.forEach((segment, index) => {
      let currentRating = segment.rating;
      let currentConfidence = segment.confidence;

      // Update specific segments post-submit (indices 4, 6, 8 - the lower-rated segments)
      if (isPostSubmit && (index === 4 || index === 6 || index === 8)) {
        currentRating = Math.min(5, currentRating + 1); // Improve rating by 1
        currentConfidence = Math.min(0.95, currentConfidence + 0.15); // Increase confidence
      }

      const color = getRatingColor(currentRating);
      const baseWidth = 2;
      const lineWidth = baseWidth + currentConfidence * 4;
      const glowWidth = currentConfidence * 8;
      const isHovered = hoveredSegment === index;
      const isSelected = selectedSegment?.id === index;

      // Draw soft outer glow (confidence indicator, hover or selection highlight)
      if (currentConfidence > 0.3 || isHovered || isSelected) {
        ctx.strokeStyle = isSelected ? '#3b82f6' : color; // Blue for selected
        ctx.globalAlpha = isSelected ? 0.4 : isHovered ? 0.3 : 0.1 * currentConfidence;
        ctx.lineWidth = isSelected ? lineWidth + glowWidth + 6 : isHovered ? lineWidth + glowWidth + 4 : lineWidth + glowWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(segment.x1, segment.y1);
        ctx.lineTo(segment.x2, segment.y2);
        ctx.stroke();
      }

      // Draw main line (rating color)
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? lineWidth + 2 : isHovered ? lineWidth + 1 : lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
      ctx.stroke();
    });

    ctx.globalAlpha = 1;
  }, [isPostSubmit, hoveredSegment, selectedSegment]);

  // Handle mouse move for hover effect
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDimmed) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let foundSegment = null;
    for (let i = 0; i < streetSegments.length; i++) {
      const segment = streetSegments[i];
      const distance = pointToSegmentDistance(x, y, segment.x1, segment.y1, segment.x2, segment.y2);
      
      if (distance < 10) {
        foundSegment = i;
        break;
      }
    }

    setHoveredSegment(foundSegment);
  };

  // Handle canvas clicks
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDimmed) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if click is near any segment
    for (let i = 0; i < streetSegments.length; i++) {
      const segment = streetSegments[i];
      const distance = pointToSegmentDistance(x, y, segment.x1, segment.y1, segment.x2, segment.y2);
      
      if (distance < 10) {
        // Calculate adjusted rating and confidence if post-submit
        let currentRating = segment.rating;
        let currentConfidence = segment.confidence;
        
        if (isPostSubmit && (i === 4 || i === 6 || i === 8)) {
          currentRating = Math.min(5, currentRating + 1);
          currentConfidence = Math.min(0.95, currentConfidence + 0.15);
        }

        const trend = -0.2 + Math.random() * 0.8; // Random trend between -0.2 and 0.6
        
        onSegmentClick({
          id: i,
          rating: currentRating,
          trend,
          confidence: currentConfidence,
          tags: segmentTags[i] || ['no tags'],
          position: { x: e.clientX - rect.left, y: e.clientY - rect.top },
        });
        break;
      }
    }
  };

  // Helper function to calculate distance from point to line segment
  const pointToSegmentDistance = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-neutral-100">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={() => setHoveredSegment(null)}
        className={`absolute inset-0 w-full h-full transition-opacity duration-300 cursor-pointer ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
      />
      
      {/* Dim overlay */}
      {isDimmed && (
        <div className="absolute inset-0 bg-neutral-900/20 pointer-events-none" />
      )}
      
      {/* Legend Chip */}
      {showLegend && (
        <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm border border-neutral-200 rounded px-3 py-2 shadow-sm">
          <div className="text-xs text-neutral-600 space-y-0.5">
            <div>Color = rating</div>
            <div>Width = confidence</div>
          </div>
        </div>
      )}

      {/* Safer Alternative Strip */}
      {showAlternative && (
        <div className="absolute top-4 right-4 bg-white border border-neutral-200 rounded shadow-sm animate-in fade-in slide-in-from-right-2 duration-300">
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex-1">
              <div className="text-xs text-neutral-900">Safer alternative now</div>
              <div className="text-xs text-neutral-600">+2 min, avoids two low-rated segments</div>
            </div>
            <button
              onClick={onAlternativeHelpful}
              className="p-1 rounded hover:bg-neutral-100 text-neutral-500 hover:text-neutral-700 transition-colors"
              title="Helpful"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setShowAlternative(false)}
              className="text-neutral-400 hover:text-neutral-600 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Segment Card */}
      {selectedSegment && (
        <SegmentCard
          rating={selectedSegment.rating}
          trend={selectedSegment.trend}
          confidence={selectedSegment.confidence}
          tags={selectedSegment.tags}
          position={selectedSegment.position}
          onClose={onCloseSegmentCard}
          onAgree={onAgree}
          onImprovement={onImprovement}
          onViewDetails={() => setShowCommunityDetails(true)}
        />
      )}

      {/* Community Details Modal */}
      {showCommunityDetails && (
        <CommunityDetailsModal onClose={() => setShowCommunityDetails(false)} />
      )}
    </div>
  );
}

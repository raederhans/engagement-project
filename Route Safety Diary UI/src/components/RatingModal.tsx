import { useState } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Slider } from './ui/slider';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Switch } from './ui/switch';
import { Star, Info } from 'lucide-react';

interface RatingModalProps {
  onClose: () => void;
  onSubmit: () => void;
}

const availableTags = [
  'poor lighting',
  'low foot traffic',
  'cars too close',
  'dogs',
  'construction blockage',
];

const mockSegments = [
  { id: 1, name: 'Main St (0.3 mi)' },
  { id: 2, name: 'Oak Ave (0.5 mi)' },
  { id: 3, name: 'Park Way (0.4 mi)' },
  { id: 4, name: 'River Rd (0.6 mi)' },
];

export function RatingModal({ onClose, onSubmit }: RatingModalProps) {
  const [rating, setRating] = useState(3);
  const [hoverRating, setHoverRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [otherTag, setOtherTag] = useState('');
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const [mode, setMode] = useState('walk');
  const [saveAsRoute, setSaveAsRoute] = useState(false);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else if (selectedTags.length < 3) {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const toggleSegment = (id: number) => {
    if (selectedSegments.includes(id)) {
      setSelectedSegments(selectedSegments.filter(s => s !== id));
    } else if (selectedSegments.length < 2) {
      setSelectedSegments([...selectedSegments, id]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-neutral-900/40" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-neutral-200">
          <h2 className="text-neutral-900">Rate Your Trip</h2>
          <p className="text-sm text-neutral-600 mt-1">
            Help improve safety insights for the community
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6">
          {/* Overall Rating */}
          <div className="space-y-3">
            <Label className="text-sm text-neutral-700">Overall route safety</Label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 rounded"
                >
                  <Star
                    className={`h-8 w-8 transition-colors ${
                      star <= (hoverRating || rating)
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-neutral-300'
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm text-neutral-600">
                {rating === 1 && 'Very unsafe'}
                {rating === 2 && 'Unsafe'}
                {rating === 3 && 'Neutral'}
                {rating === 4 && 'Safe'}
                {rating === 5 && 'Very safe'}
              </span>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-3">
            <Label className="text-sm text-neutral-700">
              Tags <span className="text-neutral-500">(select up to 3)</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {availableTags.map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                  className={`cursor-pointer transition-all hover:shadow-sm ${
                    selectedTags.includes(tag)
                      ? 'bg-neutral-900 text-white'
                      : 'hover:bg-neutral-50'
                  }`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
            <Input
              type="text"
              placeholder="Other (type here)"
              value={otherTag}
              onChange={(e) => setOtherTag(e.target.value)}
              className="mt-2 text-sm h-9"
              maxLength={30}
            />
          </div>

          {/* Per-segment Override */}
          <div className="space-y-3">
            <Label className="text-sm text-neutral-700">
              Segment overrides <span className="text-neutral-500">(optional, max 2)</span>
            </Label>
            <div className="border border-neutral-200 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
              {mockSegments.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => toggleSegment(segment.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedSegments.includes(segment.id)
                      ? 'bg-neutral-900 text-white'
                      : 'hover:bg-neutral-50 text-neutral-700'
                  }`}
                >
                  {segment.name}
                </button>
              ))}
            </div>
          </div>

          {/* Mode Picker */}
          <div className="space-y-3">
            <Label className="text-sm text-neutral-700">Travel mode</Label>
            <RadioGroup value={mode} onValueChange={setMode} className="flex gap-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="walk" id="walk" />
                <Label htmlFor="walk" className="cursor-pointer text-sm">
                  Walk
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="bike" id="bike" />
                <Label htmlFor="bike" className="cursor-pointer text-sm">
                  Bike
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Save as Route Toggle */}
          <div className="flex items-center justify-between py-2">
            <Label htmlFor="save-route" className="text-sm text-neutral-700 cursor-pointer">
              Save as "My Route"
            </Label>
            <Switch
              id="save-route"
              checked={saveAsRoute}
              onCheckedChange={setSaveAsRoute}
            />
          </div>

          {/* Privacy Note */}
          <div className="flex gap-2 p-3 bg-neutral-50 rounded border border-neutral-200">
            <Info className="h-4 w-4 text-neutral-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-neutral-600">
              We only store segment-level data; raw GPS is not retained.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-200 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="px-6 transition-shadow hover:shadow-sm"
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            className="px-6 bg-neutral-900 hover:bg-neutral-800 transition-shadow hover:shadow-md"
          >
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

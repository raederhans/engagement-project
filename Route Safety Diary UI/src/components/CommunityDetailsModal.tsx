import { X, ThumbsUp, Sparkles, TrendingUp, Clock, Users } from 'lucide-react';
import { Badge } from './ui/badge';

interface CommunityDetailsModalProps {
  onClose: () => void;
}

// Mock detailed community data
const recentActivity = [
  { user: 'Anonymous', action: 'agreed', time: '2 hours ago', rating: 4 },
  { user: 'Anonymous', action: 'improvement', time: '5 hours ago', rating: 3 },
  { user: 'Anonymous', action: 'agreed', time: '1 day ago', rating: 4 },
  { user: 'Anonymous', action: 'agreed', time: '1 day ago', rating: 5 },
  { user: 'Anonymous', action: 'improvement', time: '2 days ago', rating: 2 },
  { user: 'Anonymous', action: 'agreed', time: '3 days ago', rating: 4 },
  { user: 'Anonymous', action: 'improvement', time: '4 days ago', rating: 3 },
];

const tagHistory = [
  { tag: 'poor lighting', count: 12, trend: '+2' },
  { tag: 'low foot traffic', count: 8, trend: '-1' },
  { tag: 'cars too close', count: 6, trend: '0' },
  { tag: 'dogs', count: 4, trend: '+1' },
];

const ratingDistribution = [
  { rating: 5, count: 8 },
  { rating: 4, count: 15 },
  { rating: 3, count: 12 },
  { rating: 2, count: 6 },
  { rating: 1, count: 3 },
];

const trendHistory = [
  { week: 'Week 1', avgRating: 3.2, reports: 8 },
  { week: 'Week 2', avgRating: 3.4, reports: 10 },
  { week: 'Week 3', avgRating: 3.5, reports: 12 },
  { week: 'Week 4', avgRating: 3.8, reports: 14 },
];

export function CommunityDetailsModal({ onClose }: CommunityDetailsModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-neutral-900/50 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-neutral-900">Community Insights</h2>
            <p className="text-sm text-neutral-600">Oak Ave (0.5 mi segment)</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(90vh-80px)] p-6 space-y-6">
          {/* Overview Stats */}
          <div>
            <h3 className="text-sm text-neutral-700 mb-3">Overview</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="p-4 bg-gradient-to-br from-neutral-50 to-neutral-100 rounded-lg border border-neutral-200">
                <div className="text-xs text-neutral-500 mb-1">Total Reports</div>
                <div className="text-2xl text-neutral-900">44</div>
              </div>
              <div className="p-4 bg-gradient-to-br from-neutral-50 to-neutral-100 rounded-lg border border-neutral-200">
                <div className="text-xs text-neutral-500 mb-1">Avg Rating</div>
                <div className="text-2xl text-neutral-900">3.8</div>
              </div>
              <div className="p-4 bg-gradient-to-br from-neutral-50 to-neutral-100 rounded-lg border border-neutral-200">
                <div className="text-xs text-neutral-500 mb-1">Confidence</div>
                <div className="text-2xl text-neutral-900">87</div>
              </div>
              <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg border border-green-200">
                <div className="text-xs text-green-700 mb-1">30d Trend</div>
                <div className="text-2xl text-green-700 flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  <span>+0.4</span>
                </div>
              </div>
            </div>
          </div>

          {/* Trend Over Time */}
          <div>
            <h3 className="text-sm text-neutral-700 mb-3">30-Day Trend</h3>
            <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4">
              <div className="h-32 flex items-end justify-between gap-2">
                {trendHistory.map((item, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <div className="text-xs text-neutral-600">{item.avgRating}</div>
                    <div
                      className="w-full bg-gradient-to-t from-neutral-900 to-neutral-700 rounded-t transition-all duration-500 hover:from-neutral-800 hover:to-neutral-600"
                      style={{ height: `${(item.avgRating / 5) * 100}%` }}
                      title={`${item.reports} reports`}
                    />
                    <div className="text-xs text-neutral-500">{item.week}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Rating Distribution */}
          <div>
            <h3 className="text-sm text-neutral-700 mb-3">Rating Distribution</h3>
            <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4 space-y-2.5">
              {ratingDistribution.map((item) => (
                <div key={item.rating} className="flex items-center gap-3">
                  <span className="text-xs text-neutral-600 w-10">{item.rating} ★</span>
                  <div className="flex-1 h-7 bg-white rounded-md overflow-hidden border border-neutral-200">
                    <div
                      className="h-full bg-gradient-to-r from-neutral-800 to-neutral-900 transition-all duration-500"
                      style={{ width: `${(item.count / 15) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-neutral-700 w-10 text-right">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tag History */}
          <div>
            <h3 className="text-sm text-neutral-700 mb-3">Tag Frequency</h3>
            <div className="grid grid-cols-2 gap-2">
              {tagHistory.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg border border-neutral-200 hover:border-neutral-300 transition-colors">
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="text-xs bg-white">
                      {item.tag}
                    </Badge>
                    <div className="text-xs text-neutral-500 mt-1">{item.count} mentions</div>
                  </div>
                  <div className={`text-xs px-2 py-1 rounded ${
                    item.trend.startsWith('+') ? 'bg-green-100 text-green-700' :
                    item.trend.startsWith('-') ? 'bg-red-100 text-red-700' :
                    'bg-neutral-100 text-neutral-600'
                  }`}>
                    {item.trend}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div>
            <h3 className="text-sm text-neutral-700 mb-3">Recent Activity</h3>
            <div className="bg-neutral-50 rounded-lg border border-neutral-200 divide-y divide-neutral-200 overflow-hidden">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-3 hover:bg-white transition-colors">
                  <div className={`p-2 rounded-full ${
                    item.action === 'agreed' ? 'bg-blue-100' : 'bg-amber-100'
                  }`}>
                    {item.action === 'agreed' ? (
                      <ThumbsUp className="h-3.5 w-3.5 text-blue-600" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-neutral-700">
                      {item.user} {item.action === 'agreed' ? 'agreed with rating' : 'noted improvement'}
                    </div>
                    <div className="text-xs text-neutral-500 flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {item.time}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Privacy Note */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-start gap-2">
              <div className="p-1.5 bg-blue-100 rounded-full">
                <Users className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-xs text-blue-900 mb-1">Privacy & Moderation</h4>
                <p className="text-xs text-blue-700 leading-relaxed">
                  All contributions are anonymous. We aggregate data to protect individual privacy while maintaining useful community insights. No free-text comments to keep moderation light.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

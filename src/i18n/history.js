import { registerMessagePairs } from './messages.js';
import { historyMessagePairs } from './history_messages.js';

registerMessagePairs(historyMessagePairs);

export * from './index.js';

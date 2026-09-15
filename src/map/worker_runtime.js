import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { setWorkerUrl } from 'maplibre-gl';

// Bundle the worker and its shared imports with Vite's deployment base.
setWorkerUrl(workerUrl);

import loadHighs from './vendor/highs/highs.mjs';
import { solveOptimization } from './optimizer.mjs';

// Lazy load the solver only when requested; all data stays on the user's device.
const runtime = loadHighs({locateFile:file => new URL(`./vendor/highs/${file}`, import.meta.url).href});
self.addEventListener('message', async event => {
  const {id, data, input} = event.data;
  try {
    const highs = await runtime;
    const result = solveOptimization(data, input, highs);
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error:error.message || 'Optimization failed.'});
  }
});

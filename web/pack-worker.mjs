import loadHighs from './vendor/highs/highs.mjs';
import { solvePacks } from './pack-planner.mjs';
const runtime = loadHighs({locateFile:file=>new URL(`./vendor/highs/${file}`,import.meta.url).href});
self.onmessage = async ({data:{data,state}}) => {
  try { self.postMessage({result:solvePacks(data,state,await runtime)}); }
  catch(error) { self.postMessage({error:error.message || 'Pack calculation failed.'}); }
};

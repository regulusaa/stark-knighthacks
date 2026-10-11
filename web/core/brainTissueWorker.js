// Builds the Brain's tissue geometry off the main thread (about a second of maths), then hands the arrays back.
import { buildTissueArrays } from './brainTissueBuild.js';

self.onmessage = (event) => {
  const g = buildTissueArrays(event.data && typeof event.data === "object" ? event.data : {});
  self.postMessage(g, [g.position.buffer, g.normal.buffer, g.color.buffer, g.index.buffer]);
};

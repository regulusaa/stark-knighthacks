// The adversarial beat (master plan section 9, contract v3 3.6). The clean retriever and adv_retriever are a pair
// (from fgsm.json): api keeps both loaded so a switch between them is instant and leaves the camera where it is.
// On the adversarial image: display-state.image.adversarial, a caption with the change budget, and the noise view
// (host toggle or N): the panel crossfades to the change amplified 50×. Switching image turns the noise view off.
import * as THREE from 'three';
import { loadTexture } from './assets.js';
import { buildAnswers } from './api.js';

export const ADVERSARIAL = {
  caption: (n) => `Changed by at most ${n}/255 per pixel`,
};

export async function createAdversarial({ api, panel }) {
  const fgsmOf = new Map();   // adversarial image id → fgsm.json
  const pairs = new Map();
  await Promise.all(api.manifest.filter((m) => m.files?.fgsm).map(async (m) => {
    try {
      const res = await fetch('/' + m.folder.replace(/^\/+/, '') + 'fgsm.json', { cache: 'no-cache' });
      const f = await res.json();
      if (f?.schema !== 'stark.fgsm/1' || !api.manifest.some((x) => x.id === f.sourceImageId)) throw new Error('bad fgsm.json');
      fgsmOf.set(m.id, f);
      pairs.set(m.id, f.sourceImageId);
      pairs.set(f.sourceImageId, m.id);
    } catch (err) {
      console.warn(`[stark] ${m.id}: no adversarial data (${err.message})`);
    }
  }));
  api.setPairs(pairs);

  let noise = null;      // the current image's noise texture
  let token = 0;

  api.onImageLoaded(async ({ id }) => {
    const mine = ++token;
    noise?.dispose();
    noise = null;
    panel.setNoise(null);
    api.patchState({ noiseView: false }, { capabilities: { noiseView: false } });
    const f = fgsmOf.get(id);
    if (!f) return;
    const a = api.assets;
    panel.setBaseCaption(ADVERSARIAL.caption(f.maxPixelChange ?? f.epsilon255));
    // the clean image's top-1, as an Answer on the clean image (its assets are kept loaded as the partner)
    const src = await api.assetsOf(f.sourceImageId);
    const tex = f.noiseFile ? await loadTexture(a.base + f.noiseFile, THREE.SRGBColorSpace) : null;
    if (mine !== token) { tex?.dispose(); return; }
    const cleanTop1 = src?.tree ? buildAnswers(src.tree, src.gradcam).find((x) => x.isTop1) ?? null : null;
    noise = tex;
    panel.setNoise(tex);
    api.patchState({
      image: {
        ...api.state.image,
        adversarial: { epsilon255: f.epsilon255, maxPixelChange: f.maxPixelChange ?? f.epsilon255, cleanTop1, pairedImageId: f.sourceImageId },
      },
    }, { capabilities: { noiseView: Boolean(tex) } });
  });

  api.onNoiseView((on) => {
    if (on && !api.state?.capabilities.noiseView) return;
    panel.setNoiseView(on);
    api.patchState({ noiseView: on });
  });

  return { pairs, fgsmOf };
}

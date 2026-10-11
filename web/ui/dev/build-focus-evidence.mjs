// Build small, reproducible UI evidence from the shipped ResNet head and original crops.
// No model/contract assets are modified. Ablations always refer to the ORIGINAL activations.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createEngine, parseHead, parseConv5 } from '../../core/steer/engine.js';
const assets = new URL('../../public/assets/', import.meta.url);
const output = new URL('../evidence/', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, assets), 'utf8'));
const bytes = async name => { const b=await readFile(new URL(name,assets)); return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength); };
const head=await bytes('steer/head.bin'), engine=createEngine(parseHead(head));
const manifest=await json('manifest.json');
const rounded=n=>Number(n.toFixed(8));
let total=0;
for (const entry of manifest.images) {
 const tree=await json(`${entry.id}/tree.json`), gradcam=await json(`${entry.id}/gradcam/index.json`);
 const members=new Map([...tree.topK,tree.trueClass].filter(Boolean).map(a=>[a.classId,a]));
 const record={version:1,imageId:entry.id,model:entry.category==='medical'?'medical':'imagenet',baselineTop1:tree.top1,classes:[]};
 if (record.model==='imagenet') {
  const conv=await bytes(`${entry.id}/conv5.bin`); engine.setImage(entry.id,parseConv5(conv));
  if(engine.identityError(tree)>1e-4) throw new Error(`Identity check failed: ${entry.id}`);
  record.source={headSha256:createHash('sha256').update(new Uint8Array(head)).digest('hex'),convSha256:createHash('sha256').update(new Uint8Array(conv)).digest('hex')};
 }
 for (const a of members.values()) {
  const heat=gradcam.classes.find(c=>c.classId===a.classId);
  const data={classId:a.classId,label:a.label,baselineScore:a.score,heatmapFile:heat?.hasHeatmap?heat.file:null};
  if(record.model==='imagenet') {
   const supporting=engine.topChannels(a.classId,1)[0];
   data.support={channel:supporting.channel,contribution:rounded(supporting.contribution)};
   const edited=engine.apply(new Map([[supporting.channel,0]]));
   data.removal={channel:supporting.channel,score:rounded(edited[a.classId])};
   engine.apply(null);
  }
  record.classes.push(data);
 }
 const content=JSON.stringify(record)+'\n';
 await writeFile(new URL(`${entry.id}.json`,output),content);total+=Buffer.byteLength(content);
 console.log(`${entry.id}: ${record.classes.length} classes, ${Buffer.byteLength(content)} bytes`);
}
console.log(`focus evidence: ${manifest.images.length} images, ${total} bytes total; identities verified`);

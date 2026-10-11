import { spawn } from 'node:child_process';
const base=process.argv[2]||'http://localhost:3003';
const hudBase=process.argv[3]||base;
const shots=[
 ...[[390,844],[375,667],[320,667]].map(([w,h])=>[`${base}/ui/dev/cx9.html?scene=first`,`cx9-first-${w}x${h}`,`${w}x${h}`]),
 ...['retriever','handover','stability','adversarial','xray','steer','close','reset-hold'].map(scene=>[`${base}/ui/dev/cx9.html?scene=${scene}`,`cx9-rail-${scene}-1180x820`,'1180x820']),
 ...[[1920,1080],[2560,1440]].flatMap(([w,h])=>['steering','outsideBrain','focused'].map(scene=>[`${hudBase}/ui/dev/hud.html?room=STRK7&scene=${scene}`,`cx9-hud-${scene}-${w}x${h}`,`${w}x${h}`])),
];
let next=0;
async function worker(){while(next<shots.length){const[url,name,size]=shots[next++];await new Promise((resolve,reject)=>{const child=spawn('npm',['run','shot','--',url,`web/ui/.shots/${name}.png`,'--size',size,'--wait-flag','__starkReady'],{stdio:'inherit'});child.on('exit',code=>code===0?resolve():reject(new Error(`${name}: shot exit ${code}`)))})}}
await worker();

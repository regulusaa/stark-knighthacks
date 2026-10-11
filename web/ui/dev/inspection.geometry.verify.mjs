import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { buildTissueArrays } from '../../core/brainTissueBuild.js';
import { createFibers, connectedFiberPaths } from '../../core/brainFibers.js';
import { createInspection } from '../../core/inspection.js';
import { createCameraRig } from '../../core/cameraRig.js';
import { layoutBrain } from '../../core/brainLayout.js';
import { createBrainMesh } from '../../core/brainMesh.js';
globalThis.matchMedia=()=>({matches:false});
const arrays=buildTissueArrays();
const tissue={parts:{}};
for(const name of ['brain','stem']) {
 const ranges=arrays.ranges.filter(r=>r.name===name),start=ranges[0].start,count=ranges.reduce((n,r)=>n+r.count,0);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(arrays.position,3));g.setIndex(new THREE.BufferAttribute(arrays.index.slice(start,start+count),1));
 const box=new THREE.Box3(),p=new THREE.Vector3();for(let i=0;i<g.index.count;i++)box.expandByPoint(p.fromBufferAttribute(g.attributes.position,g.index.getX(i)));g.boundingBox=box;
 tissue.parts[name]=new THREE.Mesh(g);
}
const brain=new THREE.Group(),stem=new THREE.Group(),fibers=createFibers();brain.add(tissue.parts.brain);stem.add(tissue.parts.stem,fibers.mesh);
const camera=new THREE.PerspectiveCamera(40,16/9,.1,200),rig=createCameraRig(camera);
const inspection=createInspection({brain,stem,tissue,fibers,rig,camera});
const settle=()=>{for(let n=0;n<200;n++){inspection.update(1/60);rig.update(1/60);}brain.updateMatrixWorld(true);stem.updateMatrixWorld(true);camera.updateMatrixWorld(true);};
inspection.initial();settle();
for(const [w,h] of [[2560,1440],[1920,1080],[1180,820],[390,844],[320,667]]){
 camera.aspect=w/h;camera.updateProjectionMatrix();inspection.resize();settle();
 for(const arrangement of ['split','join']){
  inspection.action({action:arrangement});settle();
  let minX=1,maxX=-1,minY=1,maxY=-1;const p=new THREE.Vector3();
  for(const mesh of [tissue.parts.brain,tissue.parts.stem,fibers.mesh]){
   const g=mesh.geometry;
   for(let i=0;i<g.index.count;i+=3){p.fromBufferAttribute(g.attributes.position,g.index.getX(i)).applyMatrix4(mesh.matrixWorld).project(camera);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
  }
  assert.ok(minX>=-.9&&maxX<=.9&&minY>=-.76&&maxY<=.82,`${w}x${h} ${arrangement} fully framed: ${[minX,maxX,minY,maxY]}`);
 }
 console.log(`ok ${w}x${h}: complete assembled and separated geometry within safe frame`);
}
for(const part of ['brain','stem']){
 const other=part==='brain'?'stem':'brain',before=inspection.targets[other].toArray();
 inspection.action({action:'move',part,position:[4,2,-1]});settle();
 assert.ok(inspection.groups[part].position.distanceTo(new THREE.Vector3(4,2,-1))<.001);
 assert.deepEqual(inspection.targets[other].toArray(),before);
 inspection.action({action:'join'});settle();
}
assert.equal(inspection.action({action:'move',part:'brain',position:[1,2,3],from:'guest',seq:7}),true);
assert.equal(inspection.action({action:'move',part:'brain',position:[9,9,9],from:'guest',seq:6}),false);
assert.deepEqual(inspection.targets.brain.toArray(),[1,2,3]);
console.log('ok independent movement of both parts; stale sender sequence rejected');
const tree=JSON.parse(readFileSync('web/public/assets/clean_retriever/tree.json'));
const layout=layoutBrain(tree),veins=createBrainMesh();veins.build(layout);
const edge=layout.edges.find(e=>e.isStem);assert.deepEqual(edge.points[0],[0,6,0]);
const paths=connectedFiberPaths();assert.ok(paths.filter(p=>p.points.at(-1).every((n,i)=>n===[0,6,0][i])).length>=38);
const mesh=veins.group.children.find(m=>m.material===veins.material&&m.geometry.attributes.aStem.array.some(n=>n===1));
for(let i=0;i<mesh.geometry.attributes.uv.count;i++){
 const u=mesh.geometry.attributes.uv.getX(i),weight=mesh.geometry.attributes.aStem.getX(i);
 if(u===0)assert.equal(weight,1);if(u===1)assert.equal(weight,0);
}
console.log('ok root tracks meet the hierarchy entry; shader endpoints stay attached to their own part');
console.log('inspection geometry: all checks passed');

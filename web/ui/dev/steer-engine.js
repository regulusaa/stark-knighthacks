// Dev-only synthetic scores. This module is never imported by the production controller.
import { EVENTS, ERROR_CODES, ROLES } from '/contract/contract.js';
import { loadDsl } from '../steer/dsl-adapter.js';
export async function createSteerMock({ scene = 'idle', role = ROLES.GUEST } = {}) {
  const read = async name => {
    const response = await fetch(`/contract/fixtures/${name}.json`);
    if (!response.ok) throw new Error(`Missing fixture: ${name}`);
    return response.json();
  };
  const [base, sample, flipped, outside] = await Promise.all(['display-state','steer-state','steer-result.flipped','steer-result.outside-brain'].map(read));
  const dsl = await loadDsl();
  const listeners = new Map();
  const observers = new Set();
  const timers = new Set();
  const log = [];
  let closed = false;
  let current = null;
  const status = {phase:scene==='offline'?'disconnected':'connected', clientId:role===ROLES.HOST?'h_mock':'c_local',label:role===ROLES.HOST?'Ray':'Guest 1',subscribe(cb){observers.add(cb);cb(status);return()=>observers.delete(cb)}};
  let driver = scene==='viewer' ? {id:'c_other',label:'Guest 2',isHost:false} : scene==='unclaimed'?null:{id:status.clientId,label:status.label,isHost:role===ROLES.HOST};
  let display = {...structuredClone(base),focus:null,driver,capabilities:{...base.capabilities,steer:scene!=='unavailable'},steer:{active:false,changedCount:0,top1Changed:false}};
  if(scene==='unavailable')display.image={id:'med_xray_pneumonia',name:'Chest X-ray',category:'medical'};
  let baselineAnswers = structuredClone(base.answers);
  let baselineTop1 = structuredClone(base.top1);
  let sets = structuredClone(sample.sets);
  let flipCount = 3;
  let allClasses = [...baselineAnswers,outside.result.outsideBrain];
  const deliver = (event,payload) => {if(!closed)for(const cb of listeners.get(event)||[])cb(structuredClone(payload))};
  const later = fn => {const timer=setTimeout(()=>{timers.delete(timer);if(!closed)fn()},30);timers.add(timer)};
  function calculate(scales,seq,source,probe=null,error=null) {
    const map = new Map(scales.map(item=>[item.channel,item.scale]));
    const zeroed = sets.top1.channels.filter(item=>(map.get(item.channel)??1)===0).length;
    const down = sets.top1.channels.reduce((sum,item)=>sum+1-(map.get(item.channel)??1),0);
    const up = sets.top2.channels.reduce((sum,item)=>sum+(map.get(item.channel)??1)-1,0);
    const influence = down+up*.45;
    let answers = structuredClone(baselineAnswers);
    for(const a of answers){
      if(a.classId===sets.top1.classId)a.score=Math.max(.04,.62-influence*.095);
      else if(a.classId===sets.top2.classId)a.score=Math.min(.75,.11+influence*.055);
    }
    if(zeroed>=flipCount){answers.find(a=>a.classId===sets.top1.classId).score=.21;answers.find(a=>a.classId===sets.top2.classId).score=.44}
    answers.sort((a,b)=>b.score-a.score);
    answers=answers.map((a,index)=>({...a,rank:index+1,isTop1:index===0,hasHeatmap:true,heatmapSource:scales.length?'live':'precomputed'}));
    const top1=answers[0];
    return {seq,imageId:display.image.id,active:scales.length>0,source:scales.length?source:null,scales:scales.slice().sort((a,b)=>a.channel-b.channel),code:dsl?.format(map)||null,sets:structuredClone(sets),result:{answers,top1,baselineTop1,top1Changed:top1.classId!==baselineTop1.classId,outsideBrain:null},probe,error};
  }
  function publish(value) {
    current=value;
    display={...display,top1:value.result.top1,answers:value.result.answers,steer:{active:value.active,changedCount:value.scales.length,top1Changed:value.result.top1Changed}};
    deliver(EVENTS.DISPLAY_STATE,display);deliver(EVENTS.STEER_RESULT,value);
  }
  function initial() {
    let value=calculate([],0,null);
    if(scene==='mid-drag')value=calculate([{channel:sets.top1.channels[0].channel,scale:.25}],1,'slider',sets.top1.channels[0].channel);
    if(scene==='flipped')value=calculate(sets.top1.channels.slice(0,3).map(c=>({channel:c.channel,scale:0})),3,'slider');
    if(scene==='outside-brain')value={...structuredClone(outside),imageId:display.image.id};
    if(scene==='viewer')value={...structuredClone(flipped),imageId:display.image.id};
    if(scene==='resolve-error')value={...value,error:{line:1,col:9,message:'No class called "golden retrievee". Did you mean "golden retriever"?'}};
    publish(value);
  }
  const api={
    status,log,
    on(event,cb){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(cb);return()=>listeners.get(event).delete(cb)},
    emit(event,payload={}){
      if(closed||status.phase!=='connected')return false;
      const entry={time:performance.now(),event,payload:structuredClone(payload)};log.push(entry);console.info('[steer mock emit]',event,JSON.stringify(payload));
      if(event===EVENTS.TAKE_CONTROL){later(()=>{
        if(driver&&driver.id!==status.clientId&&role!==ROLES.HOST)deliver(EVENTS.ERROR,{code:ERROR_CODES.LOCKED,event,driver,message:`${driver.label} is driving`});
        else{driver={id:status.clientId,label:status.label,isHost:role===ROLES.HOST};display.driver=driver;deliver(EVENTS.DRIVER_CHANGED,{driver,reason:'take'});deliver(EVENTS.DISPLAY_STATE,display)}
      });return true}
      if(![EVENTS.STEER_UPDATE,EVENTS.STEER_RESET].includes(event))return true;
      if(role!==ROLES.HOST&&driver?.id!==status.clientId){later(()=>deliver(EVENTS.ERROR,{code:ERROR_CODES.LOCKED,event,driver,message:`${driver?.label||'Someone else'} is driving`}));return true}
      later(()=>{
        if(status.phase!=='connected'||(role!==ROLES.HOST&&driver?.id!==status.clientId))return;
        if(event===EVENTS.STEER_RESET){publish(calculate([],0,null));return}
        if(payload.code!==undefined){
          if(!dsl){deliver(EVENTS.ERROR,{code:ERROR_CODES.FORBIDDEN,event,message:'Syntax check available after sync'});return}
          const parsed=dsl.parse(payload.code);
          const resolved=parsed.ok?dsl.resolve(parsed.statements,{findClass:dsl.makeClassFinder(allClasses),topChannels(id,n){return Object.values(sets).find(set=>set.classId===id)?.channels.slice(0,n).map(c=>c.channel)||[]}}):parsed;
          if(!resolved.ok){publish({...current,seq:payload.seq,probe:null,error:resolved.error});return}
          const scales=[...resolved.scales].map(([channel,scale])=>({channel,scale}));publish(calculate(scales,payload.seq,'code'));return;
        }
        publish(calculate(payload.set,payload.seq,'slider',payload.probe??null));
      });return true;
    },
    start(){if(scene!=='loading'&&scene!=='offline')later(initial);else deliver(EVENTS.DISPLAY_STATE,display)},
    setDriver(next){driver=next;display.driver=driver;deliver(EVENTS.DRIVER_CHANGED,{driver,reason:'take'});deliver(EVENTS.DISPLAY_STATE,display)},
    setConnection(connected){status.phase=connected?'connected':'disconnected';for(const cb of observers)cb(status);if(connected){deliver(EVENTS.DISPLAY_STATE,display);if(current)deliver(EVENTS.STEER_RESULT,current)}},
    changeImage(id){
      baselineAnswers=structuredClone(base.answers);baselineTop1=structuredClone(base.top1);sets=structuredClone(sample.sets);flipCount=3;
      if(id==='ambig_cat'){
        const remap=a=>a.classId===207?{...a,classId:281,label:'tabby'}:a.classId===208?{...a,classId:282,label:'tiger cat'}:a;
        baselineAnswers=baselineAnswers.map(remap);baselineTop1=remap(baselineTop1);
        sets.top1={...sets.top1,classId:281,label:'tabby'};sets.top1.channels[0].channel=956;
        sets.top2={...sets.top2,classId:282,label:'tiger cat'};flipCount=1;
      }
      allClasses=[...baselineAnswers,outside.result.outsideBrain];
      display={...display,image:{id,name:id,category:id.startsWith('ambig_')?'ambiguous':'clean'},steer:{active:false,changedCount:0,top1Changed:false},answers:baselineAnswers,top1:baselineTop1};deliver(EVENTS.DISPLAY_STATE,display);publish(calculate([],0,null))
    },
    inject(value){publish(value)},
    get display(){return structuredClone(display)},get result(){return structuredClone(current)},
    close(){closed=true;for(const timer of timers)clearTimeout(timer);listeners.clear();observers.clear()},
  };
  return api;
}

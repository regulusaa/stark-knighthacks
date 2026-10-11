import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const terms=['probability','chance','sure','certain','accuracy','diagnos','fix','correct','debug','uncertainty'];
const output=resolve(import.meta.dirname,'CX9_WORDING.md');
const hits=[];
async function scan(dir){
 for(const item of await readdir(dir,{withFileTypes:true})){
  if(item.name.startsWith('.'))continue;
  const file=resolve(dir,item.name);
  if(item.isDirectory()){await scan(file);continue}
  if(file===output||! /\.(js|mjs|css|html|md)$/.test(item.name))continue;
  const lines=(await readFile(file,'utf8')).split('\n');
  lines.forEach((line,i)=>{const found=terms.filter(term=>line.toLowerCase().includes(term));if(found.length)hits.push({file:relative(root,file),line:i+1,terms:found,context:line})});
 }
}
await scan(root);
const counts=terms.map(term=>`${term}: ${hits.filter(hit=>hit.terms.includes(term)).length}`).join(' · ');
const report=['# CX-9 wording audit','',`Literal, case-insensitive substring search across UI source, dev checks and existing documentation; hidden runtime artifacts excluded. ${hits.length} matching lines.`, '',counts,'',
 '## Review','',
 '- Displayed “Correct” / “Incorrect” compare the top answer with the true class. Medical captions use exactly “not a diagnosis”.',
 '- Removed the unrelated host-key wording “missing or incorrect”; the screen now asks Ray for a fresh host link.',
 '- Other substring hits are identifiers (`toFixed`, `autocorrect`, fixtures, prefixes), CSS positioning, test assertions or documentation. They make no model claims.',
 '- Error messages received from the server are displayed as text; wording in those messages remains a server responsibility.',
 '', '## Every hit with its full line context',''];
for(const hit of hits)report.push(`### ${hit.file}:${hit.line} — ${hit.terms.join(', ')}`,'','```text',hit.context,'```','');
await writeFile(output,report.join('\n'));
console.log(`${hits.length} matches; ${counts}`);
console.log(output);

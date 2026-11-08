const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{spawn}=require('node:child_process');
const html=fs.readFileSync(require('node:path').join(__dirname,'public/index.html'),'utf8');
test('production graphic assets exist and are self-contained SVG',()=>{const path=require('node:path');for(const name of ['harbor','water','impact','splash','smoke','fire','radar','ship-1','ship-2','ship-3','ship-4']){const file=path.join(__dirname,'public','assets',name+'.svg');assert.ok(fs.existsSync(file),'missing graphic asset '+name);const svg=fs.readFileSync(file,'utf8');assert.match(svg,/<svg\b/);assert.match(svg,/<\/svg>/);assert.doesNotMatch(svg,/<script\b|<foreignObject\b/i)}});
test('game references dedicated ship assets and mobile layout',()=>{for(const asset of ['harbor.svg','water.svg','splash.svg','smoke.svg','fire.svg','radar.svg'])assert.ok(html.includes('/assets/'+asset),'asset referenced '+asset);assert.ok(html.includes("/assets/photo/fleet-'+cells.length+'.svg"),'fleet uses dedicated art');assert.ok(html.includes('100dvh'),'mobile one-screen sizing')});
test('HTML client JavaScript parses',()=>{const m=html.match(/<script>([\s\S]*?)<\/script>/);assert.ok(m,'inline game script exists');new vm.Script(m[1],{filename:'public/index.html'})});
test('two phones: create, join, deploy, shoot, turn, victory',async()=>{
const port=31000+Math.floor(Math.random()*20000),base='http://127.0.0.1:'+port,child=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port)},stdio:'pipe'});
const post=async(action,body={})=>{const r=await fetch(base+'/api/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});return {status:r.status,data:await r.json()}};
try{
let ready=false;for(let i=0;i<45;i++){if(child.exitCode!==null)throw Error('Server exited');try{let r=await fetch(base+'/health',{signal:AbortSignal.timeout(300)});if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'server starts');
for(const name of fs.readdirSync(require('node:path').join(__dirname,'public/assets/photo')).filter(n=>n.endsWith('.webp')&&n!=='reference_concept.webp')){let r=await fetch(base+'/assets/photo/'+name);assert.equal(r.status,200,name);assert.match(r.headers.get('content-type'),/image\/webp/);assert.equal(Buffer.from(await r.arrayBuffer()).toString('ascii',0,4),'RIFF')}
let crop=await fetch(base+'/assets/photo/ship-1-corrected.svg');assert.equal(crop.status,200);assert.match(crop.headers.get('content-type'),/image\/svg\+xml/);assert.match(await crop.text(),/viewBox="873 452 92 42"/);
assert.equal((await fetch(base+'/assets/missing.webp')).status,404);
assert.equal((await fetch(base+'/assets/%2e%2e%2f%2e%2e%2fserver.js')).status,404);
const a=await post('create');assert.equal(a.status,200);assert.match(a.data.code,/^[A-F0-9]{6}$/);
const b=await post('join',{code:a.data.code});assert.equal(b.status,200);assert.notEqual(a.data.token,b.data.token);
assert.equal((await post('join',{code:a.data.code})).status,409);
const board=Array.from({length:9},()=>Array(9).fill(0));
for(const [y,x,n] of [[0,0,4],[0,5,3],[2,0,3],[2,4,2],[2,7,2],[4,0,2],[4,3,1],[4,5,1],[4,7,1],[6,0,1]])for(let i=0;i<n;i++)board[y][x+i]=1;
assert.equal((await post('ready',{...a.data,board})).status,200);
const waiting=await post('state',b.data);assert.equal(waiting.data.phase,'setup');
const deployed=await post('ready',{...b.data,board});assert.equal(deployed.status,200);assert.equal(deployed.data.phase,'battle');
const verifyNoFalseWater=(data,actualBoard)=>{for(let y=0;y<9;y++)for(let x=0;x<9;x++){if(actualBoard[y][x])assert.notEqual(data.enemyShots[y][x],4,'A ship cell can never be inferred as empty: '+x+','+y);if(data.enemyShots[y][x]===4){assert.equal(actualBoard[y][x],0);assert.ok(data.enemyShots.flat().includes(3),'Only a sunk ship may cause inferred water')}}};
assert.equal((await post('fire',{...b.data,x:8,y:8})).status,409);
const miss=await post('fire',{...a.data,x:8,y:8});assert.equal(miss.data.last.result,'Мимо');assert.equal(miss.data.turn,1);
const hit=await post('fire',{...b.data,x:0,y:0});assert.equal(hit.data.last.result,'Попал');assert.equal(hit.data.turn,1);verifyNoFalseWater(hit.data,board);assert.equal(hit.data.enemyShots[1][0],0,'a wounded ship does not auto-mark neighboring water');
assert.equal((await post('fire',{...b.data,x:0,y:0})).status,409);
for(const [y,x,n] of [[0,0,4],[0,5,3],[2,0,3],[2,4,2],[2,7,2],[4,0,2],[4,3,1],[4,5,1],[4,7,1],[6,0,1]])for(let i=0;i<n;i++){if(y===0&&x+i===0)continue;var result=await post('fire',{...b.data,x:x+i,y});assert.equal(result.status,200);verifyNoFalseWater(result.data,board);if(y===0&&x===0&&i===3){assert.equal(result.data.last.result,'Убил');assert.equal(result.data.enemyShots[1][0],4,'perimeter below sunk ship is marked');assert.equal(result.data.enemyShots[1][4],4,'diagonal perimeter is marked');assert.equal(result.data.enemyShots[2][0],0,'cells beyond sunk ship are not excluded');assert.equal((await post('fire',{...b.data,x:0,y:1})).status,409,'inferred empty cells cannot be fired upon')}}
assert.equal(result.data.phase,'finished');assert.equal(result.data.winner,1);assert.equal(result.data.last.result,'Победа!');
assert.equal((await post('rematch',a.data)).status,200,'first player requests rematch');
let waitingRematch=await post('state',b.data);assert.equal(waitingRematch.data.phase,'finished');assert.deepEqual(waitingRematch.data.rematch,[true,false]);
let restarted=await post('rematch',b.data);assert.equal(restarted.status,200);assert.equal(restarted.data.phase,'setup');assert.equal(restarted.data.round,2);assert.deepEqual(restarted.data.rematch,[false,false]);assert.deepEqual(restarted.data.ready,[false,false]);assert.equal(restarted.data.winner,null);assert.equal(restarted.data.last,null);assert.equal(restarted.data.enemyShots.flat().filter(Boolean).length,0);
assert.equal((await post('ready',{...a.data,board})).status,200);assert.equal((await post('ready',{...b.data,board})).data.phase,'battle');
assert.equal((await post('rematch',a.data)).status,409,'cannot reset an active match');

assert.equal((await post('fire',{...a.data,x:0,y:0})).status,409);assert.equal((await post('fire',{...b.data,x:0,y:0})).status,200);
}finally{child.kill('SIGTERM')}
});

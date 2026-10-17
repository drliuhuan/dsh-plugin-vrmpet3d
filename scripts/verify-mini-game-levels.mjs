import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createLevelStore, LEVEL_URL } from '../lib/mini-game-level-store.js';
const source = readFileSync(new URL('../lib/mini-game-core.js',import.meta.url),'utf8');
const bundled = JSON.parse(readFileSync(new URL('../assets/game/levels.json',import.meta.url),'utf8'));
const copy = value=>JSON.parse(JSON.stringify(value));
function api() { const context=vm.createContext({});vm.runInContext(source,context);return context.__VRMPET3D_MINI_GAME__; }
let passed=0;
async function check(name,test) { await test();passed++;console.log('PASS '+name); }
function extended() {
  const manifest=copy(bundled),third=copy(manifest.levels[0]);third.id=3;third.name='第三关';third.bricks=[third.bricks[0]];
  third.bricks[0].hp=2;third.resources.bowls.white.color='#ff9933';manifest.levels.push(third);return manifest;
}
await check('bundled file fully describes both approved layouts and their bowl and rice resources',()=>{
  const rules=api();assert.ok(rules.normalizeLevels(bundled));
  for(const level of bundled.levels) {
    const original=new rules.Game();original.selectLevel(level.id, true);
    assert.equal(level.bricks.length,original.bricks.length);assert.ok(level.resources.rice.grain);
    for(const brick of level.bricks) if(brick.hp) assert.ok(level.resources.bowls[brick.bowl]);
  }
  const before=[1,2].map(id=>{const g=new rules.Game();g.selectLevel(id, true);return g.initialLayoutId;});
  rules.setLevels(bundled);
  for(const id of [1,2]){const g=new rules.Game();g.selectLevel(id, true);assert.equal(g.initialLayoutId,before[id-1]);}
});
await check('downloaded third level controls selection, final level, bowl color and two-hit durability',()=>{
  const rules=api();assert.equal(rules.setLevels(extended()),true);assert.equal(rules.levelCount(),3);
  const g=new rules.Game();assert.equal(g.selectLevel(3, true),true);assert.equal(g.bricks[0].color,'#ff9933');assert.equal(g.bricks[0].maxHp,2);
  const b=g.bricks[0];g.launch();g.ball.x=b.x+b.w/2;g.ball.y=b.y+b.h+24;g.ball.vx=0;g.ball.vy=-g.speed();g.step(.02);
  assert.equal(b.hp,1);assert.equal(b.rice,true);
  b.rice=false;g.finishLevel();assert.equal(g.advance(),false);
});
await check('third-level progress round trips without reverting to the bundled level cap',()=>{
  const rules=api();rules.setLevels(extended());const g=new rules.Game();g.selectLevel(3, true);g.lives=7;
  const restored=new rules.Game();assert.equal(restored.restore(g.snapshot()),true);assert.equal(restored.level,3);assert.equal(restored.lives,7);
});
await check('a changed layout restarts only that level while keeping earned chances',()=>{
  const rules=api(),manifest=extended();rules.setLevels(manifest);const g=new rules.Game();g.selectLevel(3, true);g.lives=8;const save=g.snapshot();
  manifest.levels[2].bricks[0].x+=5;rules.setLevels(manifest);const restored=new rules.Game();
  assert.equal(restored.restore(save),true);assert.equal(restored.level,3);assert.equal(restored.lives,8);assert.equal(restored.phase,'serve');assert.equal(restored.paused,true);
});
await check('old bundled saves remain compatible when downloaded geometry is identical',()=>{
  const rules=api(),g=new rules.Game(),save=g.snapshot();delete save.layoutId;rules.setLevels(bundled);
  const restored=new rules.Game();assert.equal(restored.restore(save),true);assert.equal(restored.remainingRice(),79);
});
await check('images are level-owned embedded PNG/WebP/JPEG resources; executable and external URLs are rejected',()=>{
  const rules=api(),manifest=extended(),style=manifest.levels[2].resources.bowls.white;
  style.image='data:image/png;base64,iVBORw0KGgo=';assert.ok(rules.normalizeLevels(manifest));
  for(const image of ['https://example.com/bowl.png','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=']) {
    style.image=image;assert.equal(rules.normalizeLevels(manifest),null);
  }
});
await check('invalid resources, missing references, empty rice and unsafe geometry reject the entire catalog',()=>{
  const rules=api();
  for(const mutate of [m=>delete m.levels[0].resources,m=>m.levels[0].bricks[0].bowl='missing',
    m=>m.levels[0].bricks[0].hp=1.5,m=>m.levels[0].bricks[0].y=700,
    m=>m.levels[0].bricks.forEach(b=>b.rice=false),m=>m.levels[1].id=4]) {
    const manifest=copy(bundled);mutate(manifest);assert.equal(rules.setLevels(manifest),false);assert.equal(rules.levelCount(),2);
  }
});
await check('startup refresh reads only the fixed ds-ball URL once and publishes validated data atomically',async()=>{
  let calls=0,release;const manifest=extended();
  const store=createLevelStore({fetchImpl:async(url,options)=>{calls++;assert.equal(url,LEVEL_URL);assert.equal(options.redirect,'error');await new Promise(r=>release=r);return new Response(JSON.stringify(manifest));}});
  const first=store.start();assert.equal(store.start(),first);assert.equal(store.snapshot().levels.length,2);release();await first;
  assert.equal(calls,1);assert.equal(store.snapshot().levels.length,3);
});
await check('network, HTTP, invalid JSON and incomplete resource failures silently retain exactly two bundled levels',async()=>{
  for(const fetchImpl of [async()=>{throw Error('offline');},async()=>new Response('',{status:404}),
    async()=>new Response('bad JSON'),async()=>new Response(JSON.stringify({version:1,levels:[]}))]) {
    const store=createLevelStore({fetchImpl});await store.start();assert.deepEqual(store.snapshot(),bundled);
  }
});
await check('oversized declared and streamed downloads fall back without retaining partial data',async()=>{
  for(const response of [new Response('{}',{headers:{'content-length':String(3*1024*1024)}}),new Response(' '.repeat(2*1024*1024+1))]) {
    const store=createLevelStore({fetchImpl:async()=>response});await store.start();assert.equal(store.snapshot().levels.length,2);
  }
});
await check('timed-out startup downloads abort silently and retain bundled resources',async()=>{
  let aborted=false;const keepAlive=setTimeout(()=>{},100);
  try {
    const store=createLevelStore({timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));}))});
    await store.start();assert.equal(aborted,true);assert.equal(store.snapshot().levels.length,2);
  } finally {clearTimeout(keepAlive);}
});
console.log(`mini-game levels: ${passed} passed`);

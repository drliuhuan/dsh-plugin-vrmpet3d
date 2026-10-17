import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createVisibilityController } = require('../desktop/game-visibility.cjs');
const source = readFileSync(new URL('../lib/mini-game-page.js', import.meta.url), 'utf8');
let passed = 0;
function check(name, test) { test(); passed++; console.log('PASS ' + name); }
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, { hidden:false, textContent:'', children:[], value:1,
    focus(){}, replaceChildren(){this.children=[];}, appendChild(child){this.children.push(child);} });
  return elements.get(id);
}
const classes = new Set();
let timers = [], incoming = [], jumped;
const sandbox = {
  resumeEnd:0,resumeTimer:null,stopped:false,lastTime:50,
  performance:{now:()=>1000},setTimeout:(fn)=>{timers.push(fn);return timers.length;},clearTimeout(){},
  $:element, game:{paused:true,level:1,phase:'playing'},canvas:{},save(){},
  root:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},dataset:{},offsetWidth:100},
  document:{hidden:false,createElement:()=>({}),pointerLockElement:null,exitPointerLock(){this.pointerLockElement=null;}},
  targets:[],seen:new Set(),noticeKey:'',pollTimer:null,statusRequest:null,
  api:{notices:()=>incoming,levelCount:()=>2},AbortController,fetch:async()=>({ok:true,json:async()=>({})}),
  openTarget:target=>{jumped=target.id;},
};
sandbox.captureMouse=()=>{sandbox.document.pointerLockElement=sandbox.canvas;};
vm.createContext(sandbox);
vm.runInContext(source.slice(source.indexOf('  function cancelResume()'),source.indexOf('  var gameWindowFocused')),sandbox);
vm.runInContext(source.slice(source.indexOf('  function pause(value)'),source.indexOf('  function openTarget(target)')),sandbox);
vm.runInContext(source.slice(source.indexOf('  function poll()'),source.indexOf('  // Rice and porcelain')),sandbox);
check('resume stays paused through 3, 2, 1 and resumes at zero',()=>{
  sandbox.beginResume();assert.equal(element('countdown-number').textContent,'3');assert.equal(sandbox.game.paused,true);
  sandbox.tickResume(2000);assert.equal(element('countdown-number').textContent,2);
  sandbox.tickResume(3000);assert.equal(element('countdown-number').textContent,1);
  sandbox.tickResume(4000);assert.equal(sandbox.game.paused,false);assert.equal(sandbox.resumeEnd,0);
});
check('returning to pause cancels countdown and releases pointer',()=>{
  sandbox.pause(true);sandbox.beginResume();sandbox.pause(true);sandbox.tickResume(5000);
  assert.equal(sandbox.game.paused,true);assert.equal(sandbox.document.pointerLockElement,null);assert.equal(element('resume-countdown').hidden,true);
});
async function poll() { sandbox.poll(); await new Promise(resolve=>setImmediate(resolve)); }
incoming=[{id:'first-project',kind:'waiting'}];await poll();
check('paused task status flashes background and populates jump targets',()=>{
  assert.equal(sandbox.game.paused,true);assert.equal(sandbox.root.dataset.noticeKind,'waiting');assert.equal(classes.has('signal'),true);
  element('sessions').children[0].onclick();assert.equal(jumped,'first-project');assert.ok(timers.length);
});
sandbox.beginResume();incoming=[{id:'second-project',kind:'error'}];await poll();
check('countdown continues polling and replaces obsolete jump targets',()=>{
  assert.equal(sandbox.game.paused,true);assert.ok(sandbox.resumeEnd);assert.equal(sandbox.root.dataset.noticeKind,'error');
  assert.equal(element('sessions').children.length,1);element('sessions').children[0].onclick();assert.equal(jumped,'second-project');
});
incoming=[];await poll();
check('resolved task messages clear paused jump targets and glow',()=>{
  assert.equal(element('sessions').children.length,0);assert.equal(classes.has('signal'),false);assert.equal(element('notice').hidden,true);
});
let visible=true,hides=0,restores=0,destroyed=false;
const apply=createVisibilityController({isDestroyed:()=>destroyed,isVisible:()=>visible,hide(){visible=false;hides++;},showInactive(){visible=true;restores++;}});
check('focused game hides once and restores pet without taking focus',()=>{
  apply(true);apply(true);assert.equal(hides,1);apply(false);apply(false);assert.equal(restores,1);assert.equal(visible,true);
});
check('manually hidden or destroyed pet stays hidden',()=>{
  visible=false;apply(true);apply(false);assert.equal(restores,1);destroyed=true;apply(true);apply(false);assert.equal(restores,1);
});
check('each game visibility transition resets native mouse interaction exactly once',()=>{
  let suspended=0,resumed=0,shown=true;
  const toggle=createVisibilityController({isDestroyed:()=>false,isVisible:()=>shown,hide(){shown=false;},showInactive(){shown=true;}},
    {suspend(){suspended++;},resume(){resumed++;}});
  toggle(true);toggle(true);toggle(false);toggle(false);assert.equal(suspended,1);assert.equal(resumed,1);
});
check('pet input recovery invalidates native hit-test cache and refreshes cursor without focusing',()=>{
  const launcher=readFileSync(new URL('../desktop/main.js',import.meta.url),'utf8');
  const part=launcher.slice(launcher.indexOf('      const resetPetInput ='),launcher.indexOf('      const stopGameVisibility ='));
  let focusable,unlocks=0,through,sent;
  const recovery={interacting:true,overPet:true,zoomHoldUntil:999,orbitFocus:true,mouseThrough:true,
    win:{setFocusable:v=>{focusable=v;}},releaseOrbitLock:()=>unlocks++,setClickThrough:v=>{through=v;assert.equal(recovery.mouseThrough,null);},
    sendCursor:p=>{sent=p;},screen:{getCursorScreenPoint:()=>({x:25,y:50})}};
  vm.createContext(recovery);vm.runInContext(part+';resetPetInput();',recovery);
  assert.equal(recovery.interacting,false);assert.equal(recovery.orbitFocus,false);assert.equal(focusable,false);
  assert.equal(unlocks,1);assert.equal(through,true);assert.deepEqual(sent,{x:25,y:50});
});
console.log(`mini-game lifecycle: ${passed} passed`);

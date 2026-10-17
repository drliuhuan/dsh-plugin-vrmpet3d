import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createVisibilityController, refreshInputRegion } = require('../desktop/game-visibility.cjs');
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
check('pet input recovery cycles native forwarding off and on, refreshing cursor without focusing',()=>{
  const launcher=readFileSync(new URL('../desktop/main.js',import.meta.url),'utf8');
  const part=launcher.slice(launcher.indexOf('      const resetPetInput ='),launcher.indexOf('      const stopGameVisibility ='));
  let focusable,unlocks=0,through,sent,nativeCalls=[];
  const recovery={inputDiagnostics:{recoveries:0},interacting:true,overPet:true,zoomHoldUntil:999,orbitFocus:true,mouseThrough:true,
    win:{setFocusable:v=>{focusable=v;},setIgnoreMouseEvents:v=>nativeCalls.push(v)},releaseOrbitLock:()=>unlocks++,setClickThrough:v=>{through=v;assert.equal(recovery.mouseThrough,false);nativeCalls.push(v);},
    sendCursor:p=>{sent=p;},screen:{getCursorScreenPoint:()=>({x:25,y:50})}};
  vm.createContext(recovery);vm.runInContext(part+';resetPetInput();',recovery);
  assert.equal(recovery.interacting,false);assert.equal(recovery.orbitFocus,false);assert.equal(focusable,false);
  assert.equal(unlocks,1);assert.equal(through,true);assert.deepEqual(sent,{x:25,y:50});
  assert.deepEqual(nativeCalls,[false,true]);assert.equal(recovery.inputDiagnostics.recoveries,1);
});
check('restoring rebuilds the input surface over a frame without changing pet size or position',()=>{
  const original={x:120,y:230,width:297,height:405};let bounds={...original},scheduled,delay;const calls=[];
  const win={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({...bounds}),setBounds(value){bounds={...value};calls.push({...value});}};
  refreshInputRegion(win,(fn,ms)=>{scheduled=fn;delay=ms;});
  assert.equal(calls.length,1);assert.equal(bounds.width,298);assert.equal(delay,32);scheduled();assert.deepEqual(bounds,original);
});
check('input surface recovery never reverts a drag or another window layout',()=>{
  let bounds={x:120,y:230,width:297,height:405},scheduled;
  const win={isDestroyed:()=>false,isVisible:()=>true,getBounds:()=>({...bounds}),setBounds(value){bounds={...value};}};
  refreshInputRegion(win,fn=>scheduled=fn);bounds={x:500,y:600,width:297,height:405};scheduled();assert.equal(bounds.x,500);assert.equal(bounds.y,600);
});
check('input surface recovery skips hidden and destroyed windows',()=>{
  for(const destroyed of [false,true]){
    refreshInputRegion({isDestroyed:()=>destroyed,isVisible:()=>false,getBounds(){assert.fail('must not resize');}});
  }
});
const exitCode=source.slice(source.indexOf("  $('exit').onclick = function () {"),source.indexOf('  if (testMode) {',source.indexOf("  $('exit').onclick = function () {")));
{
  const order=[];let finishRelease;
  const exitElement={};
  const closing={gameWindowFocused:true,focusTimer:123,$:()=>exitElement,pause:()=>order.push('pause'),save:()=>true,
    clearInterval:()=>order.push('stop-heartbeat'),reportGameFocus:(active)=>{assert.equal(active,false);order.push('release');return new Promise(r=>finishRelease=r);},
    bridge:{quit:()=>order.push('native-quit')},Promise,setTimeout:()=>0,window:{close:()=>assert.fail('must use native quit')}};
  vm.createContext(closing);vm.runInContext(exitCode,closing);exitElement.onclick();assert.equal(order.includes('native-quit'),false);
  finishRelease();await new Promise(resolve=>setImmediate(resolve));
  check('game exit releases focus and stops heartbeats before quitting the native game process',()=>{
    assert.deepEqual(order,['pause','stop-heartbeat','release','native-quit']);assert.equal(closing.gameWindowFocused,false);
  });
}
const launcher=readFileSync(new URL('../desktop/main.js',import.meta.url),'utf8');
const singleCode=launcher.slice(launcher.indexOf('// A second game launch'),launcher.indexOf("/** The pet's rectangle on screen"));
check('repeated native game launch exits the duplicate instead of creating a conflicting window',()=>{
  let exitCode,registered=false;
  vm.runInNewContext(singleCode,{options:{config:true,url:'http://localhost/vrmpet3d/game'},URL,
    app:{requestSingleInstanceLock:()=>false,exit:code=>exitCode=code,on:()=>registered=true}});
  assert.equal(exitCode,0);assert.equal(registered,false);
});
check('a repeated game request restores and focuses the original game window',()=>{
  let callback;const actions=[];
  const single={options:{config:true,url:'http://localhost/vrmpet3d/game'},URL,
    app:{requestSingleInstanceLock:()=>true,on:(event,fn)=>{assert.equal(event,'second-instance');callback=fn;}},
    game:{isDestroyed:()=>false,isMinimized:()=>true,restore:()=>actions.push('restore'),show:()=>actions.push('show'),focus:()=>actions.push('focus')}};
  vm.createContext(single);vm.runInContext(singleCode+';activeGameWindow=game;',single);callback();
  assert.deepEqual(actions,['restore','show','focus']);
});
check('pet and settings launchers do not take the game single-instance lock',()=>{
  for(const options of [{config:false,url:'http://localhost/vrmpet3d/window'},{config:true,url:'http://localhost/vrmpet3d/config'}])
    vm.runInNewContext(singleCode,{options,URL,app:{requestSingleInstanceLock:()=>assert.fail('game lock used outside game')}});
});
console.log(`mini-game lifecycle: ${passed} passed`);

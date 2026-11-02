import {analyze,humanMove,result,squareName} from './engine.mjs';
import {JOINTS,clone,number,defaultProject,validateProject,cellPoint,ik,plan,preflight,validatePose} from './model.mjs';
import {SerialLink,PlacementDriver} from './hardware.mjs';
import {armDrawing,escapeHtml} from './view.mjs';
import {zipFiles} from './zip.mjs';
import {SOURCES} from './sources.mjs';

const $=id=>document.getElementById(id);
let project=defaultProject(),board=Array(9).fill(null),busy=false,gameFault=false,pendingO=null,lastDecision=null,animation=null,simPlan=null,previewQ=ik(project.geometry.home,project.geometry),previewGrip=0,driver=null;
let confirmedLive=false;const logLines=[];
try{const saved=localStorage.getItem('xo-six-project-v2');if(saved){const next=validateProject(JSON.parse(saved));for(let i=0;i<9;i++)plan(i,next.geometry);project=next;}}catch{}
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function persist(){try{localStorage.setItem('xo-six-project-v2',JSON.stringify(project));}catch{notice('Settings applied, but browser storage is unavailable. Save a project JSON.');}}
function download(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function log(text){logLines.push(new Date().toLocaleTimeString()+' '+text);if(logLines.length>400)logLines.shift();$('serial-log').textContent=logLines.slice(-20).join('\n');}
function journal(text){const li=document.createElement('li');li.textContent=text;$('journal').prepend(li);}
function showPage(){const id=location.hash.slice(1)||'play',names={play:'Play dashboard',minimax:'Inside minimax',control:'Arm & calibration',code:'Arduino code'},page=names[id]?id:'play';document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==page);document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+page));$('page-title').textContent=names[page];requestAnimationFrame(()=>window.scrollTo(0,0));}
window.addEventListener('hashchange',showPage);
const link=new SerialLink(status=>updateHardware(status),error=>{
  $('usb-state').textContent='Disconnected: '+error.message;confirmedLive=false;$('live-game').checked=false;
  if(busy || pendingO!==null) failGame(error.message);else notice(error.message,true);
  updateLocks();
},log);
driver=new PlacementDriver(link);
function updateLocks(){
  const live=$('live-game').checked;
  $('new-game').disabled=busy||gameFault;
  $('live-game').disabled=busy||!link.connected||!confirmedLive;
  $('connect').disabled=busy||link.connected;
  $('disconnect').disabled=!link.connected;
  $('setup-checked').disabled=busy;
  for(const id of ['arm-controller','reference-base','apply-settings','backup-eeprom'])$(id).disabled=busy||!link.connected;
  for(const id of ['route','apply-project','import-project'])$(id).disabled=busy;
  document.querySelectorAll('#cell-teach button,#station-controls button,[data-grip]').forEach(b=>b.disabled=busy||!link.connected||!link.status?.armed);
  document.querySelectorAll('[data-enable],[data-nudge],[data-limit]').forEach(b=>{const i=Number(b.dataset.enable??b.dataset.nudge??b.dataset.limit);b.disabled=busy||!link.connected||!link.status?.armed||(b.dataset.nudge!==undefined&&!link.status?.live[i]);});
  for(let i=1;i<6;i++)$('slider-'+i).disabled=busy||!link.connected||!link.status?.armed||!link.status.live[i];
  $('jog-left').disabled=$('jog-right').disabled=busy||!link.connected||!link.status?.armed||!link.status?.referenced;
  $('game-mode').textContent=live?'Hardware · wait for controller completion':'Simulation · 9.2 s reference cycle';
  $('mode-label').textContent=live?'Hardware enabled':'Simulation';renderBoard();
}
function renderBoard(){
  const end=result(board);$('board').replaceChildren();
  board.forEach((v,i)=>{const button=document.createElement('button');button.textContent=v||(pendingO===i?'○':'');button.className=(v||'').toLowerCase()+(pendingO===i?' pending':'')+(end?.line.includes(i)?' winner':'');button.disabled=busy||gameFault||!!v||!!end;button.setAttribute('aria-label',`${squareName(i)}, ${v||'empty'}`);button.onclick=()=>playX(i);$('board').append(button);});
  $('round-state').textContent=gameFault?'Inspect arm':busy?'Placing O':end?'Game over':'Your turn';
  $('game-result').textContent=end?(end.winner==='draw'?'Draw.':`${end.winner} wins.`):'';
  $('reconcile').hidden=!gameFault;
  if(!busy&&!gameFault)$('turn-text').textContent=end?'Start a new game after clearing the physical board.':'Choose an empty square to place X.';
}
function renderScene(q=previewQ,grip=previewGrip,path=[]){previewQ=q;previewGrip=grip;$('arm-scene').innerHTML=armDrawing(q,grip,project.geometry,path,board);renderTelemetry(q,grip);}
function renderTelemetry(q,grip){$('telemetry').innerHTML=JOINTS.map((j,i)=>`<div><span>${j.name}</span><b>${i===5?(grip>.8?'Closed':grip<.2?'Open':'Moving'):q[i].toFixed(1)+'°'}</b></div>`).join('');}
function renderDecision(){
  if(!lastDecision)return;const d=lastDecision;
  $('decision-title').textContent=squareName(d.chosen)+' · '+d.title;$('decision-copy').textContent=d.explanation;
  $('decision-stats').innerHTML=`<div class="stat"><b>${d.metrics.visited.toLocaleString()}</b><span>states visited</span></div><div class="stat"><b>${d.candidates.length}</b><span>legal replies</span></div><div class="stat"><b>${d.score}</b><span>best minimax score</span></div>`;
  $('candidate-map').innerHTML=Array.from({length:9},(_,i)=>{const c=d.candidates.find(x=>x.index===i);return `<div class="candidate ${i===d.chosen?'best':''}"><b>${squareName(i)}</b><br>${c?`Score ${c.score} · ${c.score>0?'Win':c.score<0?'Loss':'Draw'}`:escapeHtml(board[i]||'Occupied')}</div>`;}).join('');
  $('tree-summary').textContent=`${d.outcome}. ${d.metrics.visited} search visits, ${d.metrics.terminals} terminal evaluations, ${d.metrics.cacheHits} cached continuations reused. Counts describe this search, not hardware trials.`;
}
async function playX(i){
  if(busy||gameFault||result(board)||board[i])return;
  busy=true;updateLocks();
  try {
    const live=$('live-game').checked;
    if(live){if(!confirmedLive||!$('path-reviewed').checked)throw Error('Check hardware readiness again');preflight(project,await link.query());}
    board=humanMove(board,i);journal(`X → ${squareName(i)}`);
    if(result(board)){busy=false;updateLocks();renderScene();return;}
    lastDecision=analyze(board);pendingO=lastDecision.chosen;renderDecision();renderBoard();
    $('turn-text').textContent=`Please wait while O is placed at ${squareName(pendingO)}. Your next move unlocks when the arm returns.`;
    if(live){
      $('arm-state').textContent='Hardware · commands only';$('phase').textContent='Sending calibrated destination';$('elapsed').textContent='Waiting for controller';
      await driver.execute(pendingO,clone(project),s=>{
        const phases=['Supply sensor','Open gripper','Above supply','Lower to supply','Grasp','Settle grip','Lift','Above square','Lower to square','Release','Settle token','Retreat','Return HOME','Finish'];
        $('phase').textContent=phases[s.si]||'Completing cycle';$('progress').value=Math.max(0,s.si)/14;
        $('telemetry').innerHTML=JOINTS.map((j,k)=>`<div><span>${j.name}</span><b>${k===0?s.bc+' ms':s.us[k]+' µs'}</b></div>`).join('');
      });
    }else await simulate(pendingO);
    if(gameFault||pendingO===null)throw Error('Placement interrupted');
    board[pendingO]='O';journal(`O → ${squareName(pendingO)} · ${live?'controller cycle complete; visually check token':'simulation complete'}`);pendingO=null;busy=false;
    $('phase').textContent='Arm ready';$('progress').value=1;$('elapsed').textContent=live?'Controller cycle complete':'9.2 / 9.2 s';notice(live?'Controller completed the placement cycle. Confirm the physical token before your next move.':'O placed in simulation. Your turn.');
    if(!live)renderScene();updateLocks();
  }catch(e){if(pendingO!==null)failGame(e.message);else{busy=false;notice(e.message,true);updateLocks();}}
}
function simulate(i){simPlan=plan(i,project.geometry);$('arm-state').textContent='Simulation · ideal model';return new Promise((resolve,reject)=>{
  const start=performance.now();animation={reject,frame:null};
  function tick(now){if(!animation)return;const t=Math.min(simPlan.duration,(now-start)/1000),s=simPlan.at(t);renderScene(s.q,s.grip,simPlan.samples.filter((_,k)=>k%8===0).map(s=>s.point));$('phase').textContent=s.stage;$('elapsed').textContent=`${t.toFixed(1)} / 9.2 s`;$('progress').value=t/simPlan.duration;
    if(t>=simPlan.duration){animation=null;resolve();}else animation.frame=requestAnimationFrame(tick);
  }animation.frame=requestAnimationFrame(tick);
});}
function failGame(message){
  if(animation){cancelAnimationFrame(animation.frame);const a=animation;animation=null;a.reject(Error(message));}
  gameFault=true;busy=false;confirmedLive=false;$('live-game').checked=false;
  $('turn-text').textContent='Placement stopped. Inspect the physical board and arm.';notice(message+' O was not committed.',true);$('phase').textContent='Stopped · inspect before continuing';updateLocks();
}
async function stop(){
  if(busy||pendingO!==null)failGame('Movement stopped');
  try{await driver.stop();if(!gameFault)notice('Controller stopped. Positional servos hold their last command.');}catch(e){notice(e.message,true);}
  confirmedLive=false;$('live-game').checked=false;updateLocks();
}
$('stop-play').onclick=$('stop-control').onclick=stop;
document.addEventListener('keydown',e=>{if(e.key==='Escape')stop();});
$('new-game').onclick=()=>{if(busy||gameFault)return;board=Array(9).fill(null);pendingO=null;lastDecision=null;$('journal').replaceChildren();$('decision-title').textContent='Every move has a reason.';$('decision-copy').textContent='Place X to see the chosen reply and its minimax score.';$('decision-stats').replaceChildren();$('candidate-map').replaceChildren();$('tree-summary').textContent='Start a game to inspect a real decision.';$('progress').value=0;renderBoard();renderScene();notice('New game. Clear physical tokens before playing in hardware mode.');};
$('clear-fault').onclick=()=>{if(!$('board-cleared').checked){notice('Confirm that the physical board is checked and cleared.',true);return;}gameFault=false;pendingO=null;board=Array(9).fill(null);$('board-cleared').checked=false;updateLocks();renderScene();notice('Game reset. Hardware needs a fresh readiness check.');};

function jointUI(){
  $('joint-controls').innerHTML=JOINTS.map((j,i)=>i===0?`<div class="joint"><h3>Base<small>D9 · timed rotation</small></h3><output id="base-count">Unknown</output><div class="base-jog"><button id="jog-left" class="quiet">← Turn left</button><label>Duration <input id="jog-ms" type="number" value="100" min="10" max="500"> ms</label><button id="jog-right" class="quiet">Turn right →</button></div></div>`:`<div class="joint"><h3>${j.name}<small>D${j.pin} · positional pulse</small></h3><label><small>Verified start (µs)</small><input id="start-${i}" type="number" placeholder="Not sensed" min="500" max="2500"></label><button data-enable="${i}">Enable</button><div class="slider-group"><button data-nudge="${i}" data-delta="-20" class="quiet micro">−20</button><input id="slider-${i}" type="range" min="500" max="2500" value="1500" step="1" aria-label="${j.name} pulse"><button data-nudge="${i}" data-delta="20" class="quiet micro">+20</button></div><output id="command-${i}">Unknown</output><div><button class="quiet micro" data-limit="${i}" data-edge="min">Min here</button><button class="quiet micro" data-limit="${i}" data-edge="max">Max here</button></div></div>`).join('');
  document.querySelectorAll('[data-enable]').forEach(b=>b.onclick=()=>hardwareAction(async()=>{
    const i=+b.dataset.enable,raw=$('start-'+i).value;if(raw==='')throw Error('Enter a verified absolute pulse first. The motor position cannot be read.');const us=Number(raw);number(us,'Start pulse',link.status.mn[i],link.status.mx[i]);if(!Number.isInteger(us))throw Error('Whole microseconds required');await link.command(`raw ${i} ${us}`);await waitIdle();
  }));
  document.querySelectorAll('[data-nudge]').forEach(b=>b.onclick=()=>hardwareAction(async()=>{await link.command(`nudge ${b.dataset.nudge} ${b.dataset.delta}`);await waitIdle();}));
  document.querySelectorAll('[data-limit]').forEach(b=>b.onclick=()=>hardwareAction(()=>link.command(`lim ${b.dataset.limit} ${b.dataset.edge}`)));
  for(let i=1;i<6;i++){const s=$('slider-'+i);s.oninput=()=>{$('command-'+i).textContent=s.value+' µs requested';};s.onchange=()=>hardwareAction(async()=>{await link.command(`raw ${i} ${s.value}`);await waitIdle();});}
  $('jog-left').onclick=()=>jog(-1);$('jog-right').onclick=()=>jog(1);
  $('station-controls').innerHTML=['HOME','ABOVE PICK','PICK'].map((name,i)=>`<div class="station-row"><b>${name}</b><button data-station="${i}">Capture pose</button><button data-goto="${i}" class="quiet">Go to pose</button></div>`).join('');
  document.querySelectorAll('[data-station]').forEach(b=>b.onclick=()=>hardwareAction(()=>link.command(`savewp ${b.dataset.station}`)));
  document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>hardwareAction(async()=>{await link.command(`gowp ${b.dataset.goto}`);await waitIdle();}));
  document.querySelectorAll('[data-grip]').forEach(b=>b.onclick=()=>hardwareAction(()=>link.command(`gsave ${b.dataset.grip}`)));
}
async function waitIdle(){const begin=Date.now();while(Date.now()-begin<60000){const s=await link.query();if(s.err||!s.armed)throw Error(s.err||'Disarmed');if(!s.moving&&!s.brun&&!s.running)return;await new Promise(r=>setTimeout(r,100));}throw Error('Movement timed out');}
async function hardwareAction(work){
  if(busy){notice('Wait for the current placement or press Stop.',true);return;}
  if(!link.connected||!$('setup-checked').checked){notice('Connect USB and confirm the supported live setup first.',true);return;}
  confirmedLive=false;$('live-game').checked=false;
  try{await work();await link.query();notice('Command acknowledged. Check the physical arm.');}catch(e){notice(e.message,true);}updateLocks();
}
function jog(sign){return hardwareAction(async()=>{const ms=Number($('jog-ms').value);number(ms,'Jog duration',10,500);if(!Number.isInteger(ms))throw Error('Whole milliseconds required');await link.command(`bjog ${sign*ms}`);await waitIdle();});}
function updateHardware(s){
  $('usb-state').textContent=`${link.connected?'Connected':'Connecting'} · ${s.armed?'armed':'disarmed'} · base ${s.referenced?'referenced':'not referenced'} · ${s.live?.filter(Boolean).length||0} servo outputs enabled${s.err?' · '+s.err:''}`;
  $('base-count').textContent=s.referenced?s.bc+' ms':'Not referenced';
  for(let i=1;i<6;i++){
    if(document.activeElement!==$('slider-'+i))$('command-'+i).textContent=s.live[i]?s.us[i]+' µs':'Not enabled';
    const slider=$('slider-'+i);slider.min=s.mn[i];slider.max=s.mx[i];
    if(document.activeElement!==slider)slider.value=s.us[i];
    const start=$('start-'+i);if(start.value===''&&((i<5&&s.wp[0][0])||(i===5&&(s.gOk&1))))start.value=i===5?s.gOpen:s.wp[0][i+1];
  }
  $('station-status').textContent=['HOME','ABOVE PICK','PICK'].map((n,i)=>`${n}: ${s.wp[i][0]?'saved':'not taught'}`).join(' · ')+` · Gripper: ${s.gOk===3?'both saved':'incomplete'} · IR sensor: ${s.set.sensorOn?'on':'off'} · Home switch: ${s.hs?'on':'off'}`;
  if(!s.armed){confirmedLive=false;$('live-game').checked=false;}updateLocks();
}
$('connect').onclick=async()=>{try{notice('Select your Arduino port. No motion is sent on connection.');await link.connect();const s=link.status;for(const [id,v] of [['base-stop',s.bs],['base-offset',s.bo],['base-ratio',s.br],['travel-speed',s.set.speed],['slow-speed',s.set.slowPct]])$(id).value=v;updateHardware(s);notice('Connected to six-actuator firmware. Calibration read; outputs remain unchanged.');}catch(e){notice(e.message,true);updateLocks();}};
$('disconnect').onclick=async()=>{await stop();await link.close();$('usb-state').textContent='Disconnected. Positional servos can still hold; switch off servo power when finished.';updateLocks();};
$('arm-controller').onclick=()=>hardwareAction(()=>link.command('arm confirm'));
$('reference-base').onclick=()=>hardwareAction(()=>link.command('bhome'));
$('detach-all').onclick=()=>hardwareAction(()=>link.command('relax'));
$('apply-settings').onclick=()=>hardwareAction(async()=>{
  const settings=[['set speed',+$('travel-speed').value,5,120],['set slow',+$('slow-speed').value,5,100],['bset stop',+$('base-stop').value,1200,1800],['bset speed',+$('base-offset').value,10,500],['bset ratio',+$('base-ratio').value,50,200]];
  settings.forEach(([k,v,lo,hi])=>{number(v,k,lo,hi);if(!Number.isInteger(v))throw Error('Whole-number settings required');});
  for(const [k,v] of settings)await link.command(k+' '+v);
});
function teachCells(){
  $('cell-teach').innerHTML=project.cells.map((c,i)=>`<div class="teach-cell"><b>${squareName(i)}</b><button data-cell="${i}" data-kind="above">Above ${c.above?'✓':''}</button><button data-cell="${i}" data-kind="place">Place ${c.place?'✓':''}</button><button data-test-cell="${i}" class="quiet">Test once →</button><small>${c.above&&c.place?'Both poses captured':'Needs '+(!c.above?'above ':'')+(!c.place?'place':'')}</small></div>`).join('');
  document.querySelectorAll('[data-cell]').forEach(b=>b.onclick=()=>hardwareAction(async()=>{
    const s=await link.query();if(s.moving||s.brun||s.running||!s.referenced||!s.live.slice(1,5).every(Boolean))throw Error('Stop at a confirmed pose with base referenced and four arm servos enabled');
    project.cells[+b.dataset.cell][b.dataset.kind]=validatePose([s.bc,...s.us.slice(1,5)],s);persist();teachCells();refreshEditor();$('path-reviewed').checked=false;
  }));
  document.querySelectorAll('[data-test-cell]').forEach(b=>b.onclick=async()=>{
    if(busy||!link.connected||!$('setup-checked').checked){notice('Connect and confirm the supported setup before testing a cell.',true);return;}
    confirmedLive=false;$('live-game').checked=false;busy=true;updateLocks();
    try{const i=+b.dataset.testCell;notice(`Testing one physical pick-and-place cycle to ${squareName(i)}. Stop / hold cancels it.`);await driver.execute(i,clone(project),()=>{},{singleCell:true});notice(`Controller completed the ${squareName(i)} test. Inspect the token and clear it before another test.`);}
    catch(e){notice('Cell test stopped: '+e.message,true);}finally{busy=false;updateLocks();}
  });
}
$('validate-live').onclick=async()=>{try{if(!link.connected||!$('setup-checked').checked||!$('path-reviewed').checked)throw Error('Connect USB and confirm the setup and all nine paths');preflight(project,await link.query());confirmedLive=true;$('readiness').textContent='All nine destination plans passed software checks. Hardware can now be selected.';notice('Hardware readiness passed. Select “Use hardware for O placements” when ready.');}catch(e){confirmedLive=false;$('readiness').textContent=e.message;notice(e.message,true);}updateLocks();};
$('live-game').onchange=()=>{if(busy)return;updateLocks();notice($('live-game').checked?'Hardware mode selected. O moves will be sent to the connected arm.':'Simulation selected. No game movement will be sent to USB.');};
for(const id of ['setup-checked','path-reviewed'])$(id).onchange=()=>{confirmedLive=false;$('live-game').checked=false;updateLocks();};
$('route').onchange=()=>{if(busy)return;project.route=$('route').value;confirmedLive=false;$('live-game').checked=false;persist();refreshEditor();updateLocks();};
function refreshEditor(){$('project-json').value=JSON.stringify(project,null,2);$('route').value=project.route;}
function applyProject(p){if(busy)throw Error('Stop the active placement before changing configuration');const next=validateProject(p);for(let i=0;i<9;i++)plan(i,next.geometry);project=next;persist();confirmedLive=false;$('live-game').checked=false;$('path-reviewed').checked=false;refreshEditor();teachCells();previewQ=ik(project.geometry.home,project.geometry);renderScene();updateLocks();notice('Project settings applied. No hardware values were written and hardware mode is off.');}
$('apply-project').onclick=()=>{try{applyProject(JSON.parse($('project-json').value));}catch(e){notice(e.message,true);}};
$('export-project').onclick=()=>download('tic-tac-toe-six-servo-project.json',JSON.stringify(project,null,2),'application/json');
$('import-project').onchange=async e=>{try{const f=e.target.files[0];if(f){if(f.size>200000)throw Error('Project file too large');applyProject(JSON.parse(await f.text()));}}catch(error){notice(error.message,true);}e.target.value='';};
$('backup-eeprom').onclick=async()=>{try{const s=await link.query();download('arduino-six-servo-calibration-backup.json',JSON.stringify({format:'XOARM2-calibration-backup',savedAt:new Date().toISOString(),controller:s,project},null,2),'application/json');notice('Calibration backed up. This includes the saved controller pulses, not sensed physical positions.');}catch(e){notice(e.message,true);}};
$('download-log').onclick=()=>download('xo-serial-log.txt',logLines.join('\n'));
const sourceFiles=Object.keys(SOURCES).filter(name=>/\.(ino|h)$/.test(name));
$('source-select').innerHTML=sourceFiles.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name.split('/').pop())}</option>`).join('');
function codeLineHtml(line,inComment){
  if(inComment || line.trimStart().startsWith('/*') || line.trimStart().startsWith('//'))return `<span class="token-comment">${escapeHtml(line)||' '}</span>`;
  const token=/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/.*$|^\s*#\s*\w+|\b(?:void|bool|float|int|long|char|const|uint8_t|uint16_t|uint32_t|int8_t|int16_t|struct|enum|if|else|for|while|return|switch|case|break|true|false|nullptr|sizeof|static|include|define)\b|\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/g;
  let text='',last=0;
  for(const m of line.matchAll(token)){text+=escapeHtml(line.slice(last,m.index));const v=m[0];const kind=v.startsWith('//')?'comment':/^["']/.test(v)?'string':/^\s*#/.test(v)?'directive':/^\d/.test(v)?'number':'keyword';text+=`<span class="token-${kind}">${escapeHtml(v)}</span>`;last=m.index+v.length;}
  return text+escapeHtml(line.slice(last))||' ';
}
function showSource(){
  const filename=$('source-select').value,lines=SOURCES[filename].replace(/\r/g,'').split('\n');let block=false;
  $('source-content').innerHTML=lines.map(line=>{const text=codeLineHtml(line,block);if(line.includes('/*'))block=true;if(line.includes('*/'))block=false;return `<span class="code-line">${text}</span>`;}).join('');
  $('source-info').textContent=`Arduino C++ · ${lines.length} lines`;$('source-view').scrollTop=0;$('source-view').scrollLeft=0;
}
$('source-select').onchange=showSource;showSource();
$('copy-source').onclick=async()=>{try{await navigator.clipboard.writeText(SOURCES[$('source-select').value]);notice('Code copied to clipboard.');}catch{notice('Clipboard is unavailable here. Use Download file to save the code.',true);}};
$('download-source').onclick=()=>{const file=$('source-select').value;download(file.split('/').pop(),SOURCES[file]);};
$('download-firmware').onclick=()=>download('TicTacToeArm-Arduino.zip',zipFiles(SOURCES),'application/zip');
$('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(e=>notice(e.message,true));};
window.addEventListener('beforeunload',e=>{if(link.connected){e.preventDefault();e.returnValue='';}});
jointUI();teachCells();refreshEditor();previewQ=ik(project.geometry.home,project.geometry);renderScene();showPage();updateLocks();

import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,humanMove,result} from '../web/engine.mjs';
import {defaultProject,validateProject,cellPoint,ik,fk,plan,quintic,validatePose,preflight,mappedPose} from '../web/model.mjs';
import {PlacementDriver,SerialLink} from '../web/hardware.mjs';

const projectForMock=()=>{const p=defaultProject();p.cells=p.cells.map(()=>({above:[0,1500,1500,1500,1500],place:[0,1510,1510,1500,1490]}));return p;};
const readyStatus=()=>({st:1,protocol:2,actuators:6,baseMode:'continuous',armed:1,referenced:1,running:0,moving:0,brun:0,done:0,err:'',us:Array(6).fill(1500),live:Array(6).fill(1),mn:Array(6).fill(500),mx:Array(6).fill(2500),wp:Array.from({length:5},()=>[1,0,1500,1500,1500,1500]),gOpen:1500,gClose:1550,gOk:3,bs:1500,bo:80,br:100});

test('Minimax never loses against every legal human continuation',()=>{
  const totals={X:0,O:0,draw:0};
  function visit(board){const end=result(board);if(end){totals[end.winner]++;return;}
    for(let i=0;i<9;i++)if(!board[i]){const b=humanMove(board,i);const e=result(b);if(e){totals[e.winner]++;continue;}b[analyze(b).chosen]='O';visit(b);}}
  visit(Array(9).fill(null));assert.deepEqual(totals,{X:0,O:368,draw:153});
});
test('Winning, blocking and illegal turns',()=>{
  assert.equal(analyze(['O','O',null,'X','X',null,'X',null,null]).chosen,2);
  assert.equal(analyze(['X','X',null,null,'O',null,null,null,null]).chosen,2);
  assert.throws(()=>analyze(Array(9).fill(null)));assert.throws(()=>humanMove(['X',...Array(8).fill(null)],1));
});
test('Nine board coordinates and rigid board rotation',()=>{
  const g=defaultProject().geometry;assert.deepEqual(cellPoint(0,g),[130,-50,20]);assert.deepEqual(cellPoint(4,g),[170,-10,20]);assert.deepEqual(cellPoint(8,g),[210,30,20]);
  g.yaw=90;const p=cellPoint(4,g);assert.ok(Math.hypot(p[0]-90,p[1]+10,p[2]-20)<1e-9);assert.throws(()=>cellPoint(9,g));
});
test('Both IK branches reconstruct all nine ideal targets and fixed tool pitch',()=>{
  const g=defaultProject().geometry;
  for(const branch of [-1,1]){g.branch=branch;for(let i=0;i<9;i++){const p=cellPoint(i,g),q=ik(p,g),back=fk(q,g);assert.ok(Math.hypot(...p.map((x,k)=>x-back[k]))<1e-9);assert.ok(Math.abs(q[1]+q[2]+q[4]+90)<1e-9);}}
  assert.throws(()=>ik([1000,0,20],g));assert.throws(()=>ik([0,0,100],g));
});
test('Three quintic trajectories start and finish at home and include all placement phases',()=>{
  const g=defaultProject().geometry;
  for(const i of [0,4,8]){const p=plan(i,g);assert.equal(p.samples.length,461);assert.equal(p.duration,9.2);
    for(const t of [0,9.2])assert.ok(Math.hypot(...p.at(t).point.map((x,k)=>x-g.home[k]))<1e-9);
    assert.ok(Math.hypot(...p.at(6.2).point.map((x,k)=>x-p.place[k]))<1e-9);
    assert.equal(p.at(3).grip,1);assert.equal(p.at(8).grip,0);assert.equal(p.at(2.6).grip,1);
    assert.ok(p.samples.every(s=>s.q.every(Number.isFinite)));}
  assert.equal(quintic(0),0);assert.equal(quintic(1),1);assert.ok(Math.abs((quintic(.00001)-quintic(0))/.00001)<1e-8);
});
test('Four-servo imports, non-finite geometry and malformed taught poses are rejected',()=>{
  assert.throws(()=>validateProject({version:1}));const p=defaultProject();p.geometry.upper=NaN;assert.throws(()=>validateProject(p));
  for(const v of [null,[0,1500],[0,1500,1500,1500,Infinity],[30001,1500,1500,1500,1500],[0,499,1500,1500,1500]])assert.throws(()=>validatePose(v));
});
test('Hardware requires protocol, arming, reference, enabled outputs and all nine cells',()=>{
  const p=projectForMock(),s=readyStatus();assert.equal(preflight(p,s).length,9);
  for(const change of [{protocol:1},{armed:0},{referenced:0},{running:1},{gOk:1},{live:[1,1,1,0,1,1]},{err:'link timeout'}])assert.throws(()=>preflight(p,{...s,...change}));
  p.cells[8].place=null;assert.throws(()=>preflight(p,s));
  p.cells[8].place=[0,2600,1500,1500,1500];assert.throws(()=>preflight(p,s));
});
test('IK hardware rejects assumed geometry, blank maps and changed base settings',()=>{
  const p=defaultProject(),s=readyStatus();p.route='ik';assert.throws(()=>preflight(p,s));p.geometry.source='measured';assert.throws(()=>preflight(p,s));
  const m={measured:true,base:{zeroCount:0,zeroAngle:0,degreesPerMs:.1,stopUs:1500,offsetUs:80,ratio:100},positional:Array.from({length:4},()=>({zeroUs:1500,zeroDeg:0,usPerDeg:2,minUs:500,maxUs:2500}))};
  assert.deepEqual(mappedPose([10,20,-30,0,40],m,s),[100,1540,1440,1500,1580]);assert.throws(()=>mappedPose([10,20,-30,0,40],m,{...s,bo:90}));
});
class FakeLink{
  constructor(fail=false){this.sent=[];this.s=readyStatus();this.fail=fail;this.poll=0;this.connected=true;}
  async command(c){this.sent.push(c);if(c==='start 1'){this.started=true;this.s.running=1;}if(c==='stop'){this.s.running=0;this.s.armed=0;}return 'ok';}
  async query(){if(this.started){this.poll++;if(this.fail)this.s.err='controller obstruction';else if(this.poll>1){this.s.running=0;this.s.done=1;}}return structuredClone(this.s);}
}
test('Real placement transaction validates all cells before writing, and sends exactly one cycle',async()=>{
  const link=new FakeLink(),d=new PlacementDriver(link);await d.execute(4,projectForMock());assert.deepEqual(link.sent,['cellup 0 1500 1500 1500 1500','celldown 0 1510 1510 1500 1490','start 1']);
  const bad=new FakeLink();await assert.rejects(new PlacementDriver(bad).execute(4,defaultProject()));assert.ok(!bad.sent.some(c=>c.startsWith('cell')||c.startsWith('start')));
});
test('Controller error or cancellation never reports a completed placement',async()=>{
  const link=new FakeLink(true);await assert.rejects(new PlacementDriver(link).execute(4,projectForMock()),/obstruction/);assert.equal(link.sent.at(-1),'stop');
  const l=new FakeLink(),d=new PlacementDriver(l);const execution=d.execute(4,projectForMock(),()=>{d.cancelled=true;});await assert.rejects(execution,/cancelled/);
});
test('Serial acknowledgement queue rejects controller errors instead of accepting them',async()=>{
  const link=new SerialLink();link.writer={write:async bytes=>{const c=new TextDecoder().decode(bytes).trim();queueMicrotask(()=>link.receive(c==='raw 1 0'?'err outside limits':'ok'));}};
  await link.command('ping');await assert.rejects(link.command('raw 1 0'),/outside limits/);await link.command('ping');
  await assert.rejects(link.command('bad\nstart 1'),/Invalid/);
});
test('Web Serial transport handles split lines, handshake, complete placement and clean close with a mock port',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator'),sent=[],s=readyStatus();let output,started=false,polls=0,closed=false;
  const encoder=new TextEncoder();
  const reply=text=>{const bytes=encoder.encode(text+'\r\n'),cut=Math.floor(bytes.length/2);output.enqueue(bytes.slice(0,cut));output.enqueue(bytes.slice(cut));};
  const port={readable:new ReadableStream({start(c){output=c;}}),writable:new WritableStream({write(bytes){
    const c=new TextDecoder().decode(bytes).trim();sent.push(c);
    if(c==='hello')reply('XOARM 2 6 CONTINUOUS');
    else if(c==='?'){if(started&&++polls>1){s.running=0;s.done=1;}reply(JSON.stringify(s));}
    else{if(c==='start 1'){started=true;s.running=1;}reply('ok');}
  }}),open:async()=>{},close:async()=>{closed=true;}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serial:{requestPort:async()=>port}}});
  const faults=[],link=new SerialLink(()=>{},e=>faults.push(e.message));
  try{await link.connect();assert.ok(link.connected);assert.deepEqual(sent,['hello','?']);assert.equal(link.status.actuators,6);
    await new PlacementDriver(link).execute(4,projectForMock());assert.equal(sent.filter(c=>c==='start 1').length,1);assert.equal(link.status.done,1);assert.deepEqual(faults,[]);
  }finally{await link.close();if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;}
  assert.ok(closed);assert.equal(link.connected,false);
});
test('A single-cell bench test can run before the other eight squares are taught',async()=>{
  const p=defaultProject();p.cells[4]=projectForMock().cells[4];const link=new FakeLink();
  await new PlacementDriver(link).execute(4,p,()=>{},{singleCell:true});assert.equal(link.sent.at(-1),'start 1');assert.throws(()=>preflight(p,readyStatus()));
});

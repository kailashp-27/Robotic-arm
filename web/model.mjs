export const JOINTS = [
  {name:'Base',pin:9,kind:'continuous'}, {name:'Shoulder',pin:10},
  {name:'Elbow',pin:11}, {name:'Wrist rotation',pin:5},
  {name:'Wrist pitch',pin:3}, {name:'Gripper',pin:6}
];
export const clone = value => JSON.parse(JSON.stringify(value));
export const rad = x => x*Math.PI/180;
export const deg = x => x*180/Math.PI;
export function number(value,name,lo=-1e6,hi=1e6) {
  if(typeof value!=='number' || !Number.isFinite(value) || value<lo || value>hi) throw Error(`${name}: expected ${lo} to ${hi}`);
  return value;
}
export function point(p,name='Point') {
  if(!Array.isArray(p)||p.length!==3) throw Error(`${name}: three coordinates required`);
  return p.map((v,i)=>number(v,`${name} ${'xyz'[i]}`,-2000,2000));
}
export function defaultProject() {
  return {schema:2,title:'Tic-Tac-Toe Playing Robotic Arm',route:'taught',
    geometry:{source:'assumed',shoulderHeight:95,upper:130,forearm:120,tool:65,
      boardOrigin:[130,-50,20],cell:40,yaw:0,clearance:80,toolPitch:-90,branch:-1,
      home:[140,0,140],pick:[145,-85,20]},
    mapping:{measured:false,base:{zeroCount:null,zeroAngle:null,degreesPerMs:null,stopUs:null,offsetUs:null,ratio:null},
      positional:Array.from({length:4},(_,i)=>({joint:JOINTS[i+1].name,zeroUs:null,zeroDeg:null,usPerDeg:null,minUs:null,maxUs:null}))},
    cells:Array.from({length:9},()=>({above:null,place:null})),notes:''};
}
export function validateProject(input) {
  if(!input || input.schema!==2) throw Error('Use a six-actuator project with schema 2. Old four-servo settings cannot be imported.');
  if(!['taught','ik'].includes(input.route)) throw Error('Route must be taught or ik');
  const g=input.geometry;
  if(!g || !['assumed','measured'].includes(g.source)) throw Error('Geometry source required');
  for(const k of ['shoulderHeight','upper','forearm','tool','cell','clearance']) number(g[k],k,k==='shoulderHeight'?0:1,1000);
  point(g.boardOrigin); point(g.home); point(g.pick); number(g.yaw,'Board rotation',-180,180); number(g.toolPitch,'Tool pitch',-180,180);
  if(![-1,1].includes(g.branch)) throw Error('Elbow branch must be -1 or +1');
  if(!Array.isArray(input.cells)||input.cells.length!==9) throw Error('Nine destination cells required');
  for(const c of input.cells) for(const k of ['above','place']) if(c[k]!==null) validatePose(c[k]);
  if(!input.mapping || !Array.isArray(input.mapping.positional)||input.mapping.positional.length!==4) throw Error('Four positional arm mappings required (gripper is taught separately)');
  if(typeof input.mapping.measured!=='boolean') throw Error('Mapping measured flag required');
  if(input.mapping.measured) validateMapping(input.mapping);
  return clone(input);
}
export function validatePose(p,status=null) {
  if(!Array.isArray(p)||p.length!==5) throw Error('Pose = base count + shoulder, elbow, roll, pitch pulses');
  p.forEach((v,i)=>{number(v,'Pose value',i?500:-30000,i?2500:30000);if(!Number.isInteger(v)) throw Error('Pose values must be integers');
    if(i && status && (v<status.mn[i]||v>status.mx[i])) throw Error(`${JOINTS[i].name} pulse outside Arduino limits`);});
  return p;
}
export function cellPoint(index,g) {
  if(!Number.isInteger(index)||index<0||index>8) throw Error('Cell index 0..8 required');
  const x=(index%3)*g.cell,y=Math.floor(index/3)*g.cell,c=Math.cos(rad(g.yaw)),s=Math.sin(rad(g.yaw));
  return [g.boardOrigin[0]+c*x-s*y,g.boardOrigin[1]+s*x+c*y,g.boardOrigin[2]];
}
export function ik(p,g) {
  point(p); const [x,y,z]=p,alpha=rad(g.toolPitch),r=Math.hypot(x,y)-g.tool*Math.cos(alpha),h=z-g.shoulderHeight-g.tool*Math.sin(alpha);
  if(Math.hypot(x,y)<1e-6 || r<0) throw Error('Target is on the base axis or behind the wrist model');
  const d=(r*r+h*h-g.upper*g.upper-g.forearm*g.forearm)/(2*g.upper*g.forearm);
  if(d < -1-1e-9 || d > 1+1e-9) throw Error('Target outside arm reach');
  const e=Math.atan2(g.branch*Math.sqrt(Math.max(0,1-d*d)),Math.max(-1,Math.min(1,d)));
  const s=Math.atan2(h,r)-Math.atan2(g.forearm*Math.sin(e),g.upper+g.forearm*Math.cos(e));
  return [deg(Math.atan2(y,x)),deg(s),deg(e),0,deg(alpha-s-e)];
}
export function fk(q,g) {
  const [b,s,e,,w]=q.map(rad),a=s+e+w;
  const r=g.upper*Math.cos(s)+g.forearm*Math.cos(s+e)+g.tool*Math.cos(a);
  return [r*Math.cos(b),r*Math.sin(b),g.shoulderHeight+g.upper*Math.sin(s)+g.forearm*Math.sin(s+e)+g.tool*Math.sin(a)];
}
export const quintic=u=>u*u*u*(10+u*(-15+6*u));
export function plan(index,g) {
  const place=cellPoint(index,g),above=[place[0],place[1],place[2]+g.clearance],up=[g.pick[0],g.pick[1],g.pick[2]+g.clearance];
  const points=[g.home,up,g.pick,g.pick,up,above,place,place,above,g.home];
  const times=[0,1.2,2,2.6,3.4,5.4,6.2,6.8,7.6,9.2];
  const stages=['Approach supply','Lower to token','Close gripper','Lift token','Transfer above square','Lower to square','Release token','Retreat','Return home'];
  const qs=points.map(p=>ik(p,g));
  function at(t) {
    t=Math.max(0,Math.min(9.2,t));let k=0;while(k<8&&t>times[k+1]) k++;
    const u=(t-times[k])/(times[k+1]-times[k]),e=quintic(u);
    const q=qs[k].map((a,j)=>a+(qs[k+1][j]-a)*e);
    const grip=t<2?0:t<2.6?quintic((t-2)/.6):t<6.2?1:t<6.8?1-quintic((t-6.2)/.6):0;
    return {t,q,point:fk(q,g),grip,stage:stages[k]};
  }
  return {index,place,above,points,qs,times,stages,duration:9.2,at,samples:Array.from({length:461},(_,i)=>at(i*.02))};
}
export function validateMapping(m) {
  if(m?.measured!==true || m.positional?.length!==4) throw Error('Measured joint mappings required');
  const b=m.base;number(b?.zeroCount,'Base reference count',-30000,30000);number(b.zeroAngle,'Base reference angle',-360,360);
  if(Math.abs(number(b.degreesPerMs,'Base degrees/ms',-5,5))<.00001) throw Error('Base degrees/ms cannot be zero');
  number(b.stopUs,'Base stop',1200,1800);number(b.offsetUs,'Base offset',10,500);number(b.ratio,'Base left ratio',50,200);
  m.positional.forEach((v,i)=>{number(v.zeroUs,`Joint ${i+1} zero pulse`,500,2500);number(v.zeroDeg,'Zero angle',-360,360);
    if(Math.abs(number(v.usPerDeg,'Signed us/degree',-100,100))<.01) throw Error('Pulse slope cannot be zero');
    number(v.minUs,'Minimum pulse',500,2500);number(v.maxUs,'Maximum pulse',v.minUs,2500);});
}
export function mappedPose(q,m,status=null) {
  validateMapping(m);
  if(status && [m.base.stopUs,m.base.offsetUs,m.base.ratio].some((v,i)=>v!==[status.bs,status.bo,status.br][i])) throw Error('Base speed/trim differs from the measured IK mapping');
  const pose=[Math.round(m.base.zeroCount+(q[0]-m.base.zeroAngle)/m.base.degreesPerMs)];
  m.positional.forEach((v,i)=>{const us=Math.round(v.zeroUs+(q[i+1]-v.zeroDeg)*v.usPerDeg);
    if(us<v.minUs||us>v.maxUs) throw Error(`${JOINTS[i+1].name}: IK exceeds measured pulse limits`);pose.push(us);});
  return validatePose(pose,status);
}
export function destination(index,project,status) {
  if(project.route==='taught') {
    const c=project.cells[index];return {above:validatePose(c.above,status),place:validatePose(c.place,status)};
  }
  if(project.geometry.source!=='measured') throw Error('IK hardware use requires measured geometry');
  const p=plan(index,project.geometry);
  // Check every joint-space sample, not only the target endpoints.
  p.samples.forEach(s=>mappedPose(s.q,project.mapping,status));
  return {above:mappedPose(ik(p.above,project.geometry),project.mapping,status),place:mappedPose(ik(p.place,project.geometry),project.mapping,status)};
}
export function preflight(project,status,indices=Array.from({length:9},(_,i)=>i)) {
  validateProject(project);
  if(!status || status.protocol!==2 || status.actuators!==6 || status.baseMode!=='continuous') throw Error('Upload the supplied XOARM protocol 2 firmware first');
  if(!status.armed||!status.referenced) throw Error('Arm the controller and physically reference the base');
  if(status.running||status.moving||status.brun) throw Error('Controller is still moving');
  if(status.err) throw Error(status.err);
  if(!status.live?.slice(1).every(Boolean)) throw Error('Enable shoulder, elbow, both wrist axes and gripper first');
  if(status.wp?.length!==5 || !status.wp.slice(0,3).every(p=>p[0]) || status.gOk!==3) throw Error('Teach HOME, ABOVE PICK, PICK and gripper open/close');
  status.wp.slice(0,3).forEach(p=>validatePose(p.slice(1),status));
  for(const v of [status.gOpen,status.gClose]) number(v,'Gripper pulse',status.mn[5],status.mx[5]);
  const destinations=Array(9).fill(null);
  for(const i of indices){if(!Number.isInteger(i)||i<0||i>8)throw Error('Invalid destination index');destinations[i]=destination(i,project,status);}
  if(project.route==='ik') {
    const expected=[ik(project.geometry.home,project.geometry),ik([project.geometry.pick[0],project.geometry.pick[1],project.geometry.pick[2]+project.geometry.clearance],project.geometry),ik(project.geometry.pick,project.geometry)].map(q=>mappedPose(q,project.mapping,status));
    expected.forEach((p,i)=>p.forEach((v,k)=>{if(Math.abs(v-status.wp[i][k+1])>2) throw Error('Taught common stations differ from IK geometry/mapping; align HOME and supply stations first');}));
  }
  return destinations;
}

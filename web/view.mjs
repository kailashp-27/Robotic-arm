import {rad,cellPoint,fk} from './model.mjs';
export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function armDrawing(q,grip,g,pathPoints=[],board=[]) {
  const project=p=>[350+(p[0]-p[1])*.8,340-(p[0]+p[1])*.25-p[2]*.8];
  const poly=ps=>ps.map(p=>project(p).join(',')).join(' ');
  let svg='<defs><filter id="shadow"><feDropShadow dx="1" dy="5" stdDeviation="6" flood-opacity=".12"/></filter></defs>';
  for(let i=-100;i<=300;i+=40) svg+=`<polyline points="${poly([[i,-150,0],[i,200,0]])}" stroke="#e5eaf3" fill="none"/><polyline points="${poly([[-50,i,0],[300,i,0]])}" stroke="#e5eaf3" fill="none"/>`;
  for(let i=0;i<9;i++) {
    const p=cellPoint(i,g),corners=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([a,b])=>{
      const x=a*g.cell,y=b*g.cell,c=Math.cos(rad(g.yaw)),s=Math.sin(rad(g.yaw));return [p[0]+c*x-s*y,p[1]+s*x+c*y,p[2]];});
    svg+=`<polygon points="${poly(corners)}" fill="#f3e8d4" stroke="#c8b698" stroke-width="1.5"/>`;
    const [x,y]=project(p);svg+=`<text x="${x}" y="${y+5}" text-anchor="middle" font-size="${board[i]?24:10}" fill="${board[i]==='X'?'#4564b4':'#be7756'}">${board[i]||('ABC'[Math.floor(i/3)]+(i%3+1))}</text>`;
  }
  if(pathPoints.length)svg+=`<polyline points="${poly(pathPoints)}" stroke="#99aacf" stroke-width="1.4" stroke-dasharray="5 5" fill="none"/>`;
  const b=rad(q[0]),s=rad(q[1]),e=rad(q[2]),w=rad(q[4]);
  const shoulder=[0,0,g.shoulderHeight],elbow=[g.upper*Math.cos(s)*Math.cos(b),g.upper*Math.cos(s)*Math.sin(b),g.shoulderHeight+g.upper*Math.sin(s)];
  const r=g.upper*Math.cos(s)+g.forearm*Math.cos(s+e),wrist=[r*Math.cos(b),r*Math.sin(b),g.shoulderHeight+g.upper*Math.sin(s)+g.forearm*Math.sin(s+e)],tip=fk(q,g);
  svg+=`<ellipse cx="350" cy="342" rx="39" ry="15" fill="#79869b"/><polyline points="${poly([[0,0,0],shoulder])}" stroke="#263247" stroke-width="34" stroke-linecap="round"/>`;
  const arm=[shoulder,elbow,wrist,tip];
  for(let i=0;i<3;i++)svg+=`<polyline points="${poly(arm.slice(i,i+2))}" stroke="${i===2?'#8391a8':'#34445e'}" stroke-width="${i===2?10:21}" stroke-linecap="round"/><polyline points="${poly(arm.slice(i,i+2))}" stroke="#a6b1c2" stroke-width="2" stroke-linecap="round"/>`;
  for(const p of arm.slice(0,3)){const [x,y]=project(p);svg+=`<circle cx="${x}" cy="${y}" r="10" fill="#718299" stroke="#dfe6ef" stroke-width="3"/>`;}
  const [tx,ty]=project(tip),opening=7+12*(1-grip);
  svg+=`<g transform="translate(${tx} ${ty}) rotate(${q[3]})"><rect x="-12" y="-6" width="24" height="12" rx="3" fill="#34445e"/><path d="M -7 4 L -${opening} 15 L -${opening} 25 M 7 4 L ${opening} 15 L ${opening} 25" fill="none" stroke="#263247" stroke-width="5"/>${grip>.9?'<circle cy="23" r="7" fill="white" stroke="#be7756" stroke-width="3"/>':''}</g>`;
  svg+='<text x="24" y="28" fill="#6a7990" font-size="11" letter-spacing="1.5">IDEAL FIVE-AXIS POSE + GRIPPER</text><text x="24" y="408" fill="#6a7990" font-size="11">Base · shoulder · elbow · wrist rotation · wrist pitch · gripper</text>';
  return svg;
}

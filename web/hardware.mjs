import {preflight} from './model.mjs';
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class SerialLink {
  constructor(onStatus=()=>{},onFault=()=>{},onLog=()=>{}) {this.onStatus=onStatus;this.onFault=onFault;this.onLog=onLog;this.pending=null;this.status=null;this.port=null;this.connected=false;this.chain=Promise.resolve();}
  async connect() {
    if(!globalThis.navigator?.serial) throw Error('Use Chrome or Edge on localhost for USB control. Simulation works without USB.');
    this.port=await navigator.serial.requestPort();
    try {
      await this.port.open({baudRate:115200});this.writer=this.port.writable.getWriter();this.reader=this.port.readable.getReader();
      this.readTask=this.readLoop();await delay(2000); // Uno resets when USB opens.
      const hello=await this.command('hello',s=>s==='XOARM 2 6 CONTINUOUS');
      if(!hello) throw Error('Incorrect firmware');
      await this.query();this.connected=true;
      this.timer=setInterval(()=>{if(!this.pending)this.query().catch(e=>this.fault(e));},400);
    } catch(e) {await this.close();throw e;}
  }
  async readLoop() {
    const decoder=new TextDecoder();let buffer='';
    try {while(true) {const {done,value}=await this.reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
      if(buffer.length>8000) throw Error('Serial response too long');
      let cut;while((cut=buffer.indexOf('\n'))>=0) {const line=buffer.slice(0,cut).trim();buffer=buffer.slice(cut+1);if(line)this.receive(line);}
    }}catch(e){if(!this.closing)this.fault(e);}
    if(!this.closing)this.fault(Error('USB connection ended'));
  }
  receive(line) {
    this.onLog('← '+line);
    if(line.startsWith('{')) {try{const s=JSON.parse(line);if(s.st===1){this.status=s;this.onStatus(s);}}catch{this.fault(Error('Malformed controller status'));}}
    const p=this.pending;if(!p)return;
    if(line.startsWith('err ')){clearTimeout(p.timer);this.pending=null;p.reject(Error(line.slice(4)));}
    else if(p.match(line)){clearTimeout(p.timer);this.pending=null;p.resolve(line);}
  }
  command(text,match=s=>s==='ok') {
    if(!/^[\w?. +\-]+$/.test(text)||text.length>90) return Promise.reject(Error('Invalid serial command'));
    const work=async()=>{
      if(!this.writer) throw Error('USB is disconnected');
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{this.pending=null;const e=Error('Controller reply timed out');reject(e);this.fault(e);},1800);
        this.pending={resolve,reject,timer,match};this.onLog('→ '+text);
        this.writer.write(new TextEncoder().encode(text+'\n')).catch(e=>{clearTimeout(timer);this.pending=null;reject(e);});
      });
    };
    const result=this.chain.then(work);this.chain=result.catch(()=>{});return result;
  }
  async query(){await this.command('?',s=>s.startsWith('{'));return this.status;}
  fault(error){if(this.closing)return;this.connected=false;clearInterval(this.timer);this.onFault(error);this.close().catch(()=>{});}
  async close(){
    if(this.closing)return;this.closing=true;this.connected=false;clearInterval(this.timer);
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(Error('USB closed'));this.pending=null;}
    try{await this.reader?.cancel();await this.readTask;this.reader?.releaseLock();}catch{}
    try{this.writer?.releaseLock();await this.port?.close();}catch{}
    this.writer=null;this.port=null;this.closing=false;
  }
}
export class PlacementDriver {
  constructor(link){this.link=link;this.cancelled=false;this.busy=false;}
  async execute(index,project,onProgress=()=>{},options={}) {
    if(this.busy)throw Error('Placement already running');this.busy=true;this.cancelled=false;
    try {
      const before=await this.link.query();const poses=preflight(project,before,options.singleCell?[index]:undefined),p=poses[index];
      await this.link.command('cellup '+p.above.join(' '));
      if(this.cancelled)throw Error('Placement cancelled');
      await this.link.command('celldown '+p.place.join(' '));
      if(this.cancelled)throw Error('Placement cancelled');
      await this.link.command('start 1');let observed=false;const start=Date.now();
      while(Date.now()-start<120000) {
        if(this.cancelled)throw Error('Placement cancelled');
        const s=await this.link.query();onProgress(s);
        if(s.err || !s.armed)throw Error(s.err||'Controller stopped or disarmed');
        if(s.running)observed=true;
        if(!s.running && !s.moving && !s.brun && s.done===1)return s;
        if(observed&&!s.running)throw Error('Placement ended without completing the cycle');
        await delay(120);
      }
      throw Error('Placement exceeded two minutes');
    } catch(e) {try{await this.link.command('stop');}catch{}throw e;}finally{this.busy=false;}
  }
  async stop(){this.cancelled=true;if(this.link.connected)await this.link.command('stop');}
}

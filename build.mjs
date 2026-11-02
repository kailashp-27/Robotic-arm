import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
const here=new URL('./',import.meta.url),web=new URL('./web/',here);
const files={};
for(const name of ['TicTacToeArm.ino','types.h'])files['TicTacToeArm/'+name]=await readFile(new URL('firmware/TicTacToeArm/'+name,here),'utf8');
files['TicTacToeArm/UPLOAD_README.txt']='Open TicTacToeArm.ino in Arduino IDE with types.h alongside it. Select Uno. Install the official Servo library. Upload with servo power off. Firmware starts DISARMED with no servo attachment. See the complete project README for calibration and hardware operation. Original pick-and-place controller by Aura Project Labs; adapted to XOARM2.';
await writeFile(new URL('sources.mjs',web),'// Generated from the actual sketch. Rebuild after firmware edits.\nexport const SOURCES='+JSON.stringify(files)+';\n');
const {zipFiles}=await import('./web/zip.mjs');
await writeFile(new URL('TicTacToeArm-Arduino.zip',here),zipFiles(files));
const names=['engine.mjs','model.mjs','hardware.mjs','view.mjs','zip.mjs','sources.mjs','app.mjs'];
const modules=await Promise.all(names.map(n=>readFile(new URL(n,web),'utf8')));
const code=modules.map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n').replace(/<\/script/gi,'<\\/script');
const css=await readFile(new URL('styles.css',web),'utf8'),photo=await readFile(new URL('assets/arm.jpg',web));
let html=await readFile(new URL('index.html',web),'utf8');
html=html.replace('<link rel="stylesheet" href="styles.css">',`<style>${css}</style>`).replace('src="assets/arm.jpg"',`src="data:image/jpeg;base64,${photo.toString('base64')}"`).replace('<script type="module" src="app.mjs"></script>',()=>`<script type="module">${code}</script>`);
await writeFile(new URL('XO Dashboard.html',here),html);
await writeFile(new URL('offline.html',web),html);
if(process.argv.includes('--workspace-entrypoint')){
  const legacy=new URL('../dashboard/legacy/',here);await mkdir(legacy,{recursive:true});
  try{await access(new URL('XO Dashboard - four-servo legacy.html',legacy));}catch{try{await copyFile(new URL('../XO Dashboard.html',here),new URL('XO Dashboard - four-servo legacy.html',legacy));}catch(error){if(error.code!=='ENOENT')throw error;}}
  await writeFile(new URL('../XO Dashboard.html',here),html);
}
const {defaultProject}=await import('./web/model.mjs');
await writeFile(new URL('examples/project-unmeasured.json',here),JSON.stringify(defaultProject(),null,2)+'\n');
console.log('Built six-servo standalone dashboard and synchronized Arduino source downloads.');

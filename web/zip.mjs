// Small uncompressed ZIP writer, so Arduino downloads work offline without a library.
const zipEncoder=new TextEncoder();
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export function zipFiles(files){
  const chunks=[],directory=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
    const filename=zipEncoder.encode(name),data=zipEncoder.encode(text),checksum=crc32(data);
    const local=new Uint8Array(30+filename.length),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);
    lv.setUint16(12,33,true); // DOS date: 1980-01-01
    lv.setUint32(14,checksum,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,filename.length,true);local.set(filename,30);
    const central=new Uint8Array(46+filename.length),cv=new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);
    cv.setUint16(14,33,true);
    cv.setUint32(16,checksum,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,filename.length,true);cv.setUint32(42,offset,true);central.set(filename,46);
    chunks.push(local,data);directory.push(central);offset+=local.length+data.length;
  }
  const directorySize=directory.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,directory.length,true);ev.setUint16(10,directory.length,true);
  ev.setUint32(12,directorySize,true);ev.setUint32(16,offset,true);
  const archive=new Uint8Array(offset+directorySize+end.length);let position=0;
  for(const chunk of [...chunks,...directory,end]){archive.set(chunk,position);position+=chunk.length;}
  return archive;
}

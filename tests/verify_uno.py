"""Offline AVR build using an installed official core and Servo library. No upload."""
from pathlib import Path
import argparse, re, subprocess, json

ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser()
    p.add_argument('--tools',type=Path,required=True,help='avr-gcc toolchain root (contains bin/)')
    p.add_argument('--core',type=Path,required=True,help='Arduino AVR platform root (contains cores/ and variants/)')
    p.add_argument('--servo',type=Path,required=True,help='Official Servo library root')
    p.add_argument('--output',type=Path,default=ROOT/'build'/'uno')
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    fw=ROOT/'firmware'/'TicTacToeArm'
    src=(fw/'TicTacToeArm.ino').read_text()
    prototypes=re.findall(r'^(?:void|bool|float|int|uint8_t)\s+\w+\([^;{}]*\)\s*(?=\{)',src,re.M)
    cpp=a.output/'sketch.cpp'
    cpp.write_text('#include <Arduino.h>\n#include <Servo.h>\n#include <EEPROM.h>\n#include "types.h"\n'+';\n'.join(prototypes)+';\n'+src)
    includes=[a.core/'cores/arduino',a.core/'variants/standard',a.core/'libraries/EEPROM/src',a.servo/'src',fw]
    common=['-Os','-ffunction-sections','-fdata-sections','-flto','-mmcu=atmega328p','-DF_CPU=16000000L','-DARDUINO=10819','-DARDUINO_AVR_UNO','-DARDUINO_ARCH_AVR']+[f'-I{x}' for x in includes]
    sources=[cpp,*sorted((a.core/'cores/arduino').glob('*.cpp')),*sorted((a.core/'cores/arduino').glob('*.c')),*sorted((a.core/'cores/arduino').glob('*.S')),a.servo/'src/avr/Servo.cpp']
    objects=[]
    def run(cmd):
        result=subprocess.run([str(x) for x in cmd],capture_output=True,text=True)
        if result.returncode:raise RuntimeError(result.stdout+result.stderr)
        return result.stdout+result.stderr
    for i,s in enumerate(sources):
        obj=a.output/f'{i}-{s.stem}.o';objects.append(obj)
        cxx=s.suffix=='.cpp';compiler=a.tools/'bin'/('avr-g++.exe' if cxx else 'avr-gcc.exe')
        flags=['-std=gnu++11','-fpermissive','-fno-exceptions','-fno-threadsafe-statics'] if cxx else ['-std=gnu11']
        if s.suffix=='.S':flags=['-x','assembler-with-cpp']
        run([compiler,*common,*flags,'-c',s,'-o',obj])
    elf=a.output/'TicTacToeArm.elf'
    run([a.tools/'bin/avr-gcc.exe','-Os','-flto','-mmcu=atmega328p','-Wl,--gc-sections','-o',elf,*objects,'-lm'])
    sizes=run([a.tools/'bin/avr-size.exe','-A',elf]);print(sizes)
    sections={name:int(size) for name,size in re.findall(r'^(\.\w+)\s+(\d+)',sizes,re.M)}
    flash=sections.get('.text',0)+sections.get('.data',0);ram=sections.get('.data',0)+sections.get('.bss',0)
    if flash>32256 or ram>2048:raise RuntimeError('Sketch exceeds Uno capacity')
    run([a.tools/'bin/avr-objcopy.exe','-O','ihex','-R','.eeprom',elf,a.output/'TicTacToeArm.hex'])
    report={'board':'Arduino Uno / ATmega328P','build':'offline official AVR core + Servo library','flash_bytes':flash,'flash_available':32256,'static_ram_bytes':ram,'ram_available':2048,'upload_performed':False}
    (a.output/'compile-result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
if __name__=='__main__':main()

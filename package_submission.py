"""Create a clean local submission archive. No network, serial access or upload."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT=Path(__file__).resolve().parent
def main():
    files=[p for p in sorted(ROOT.rglob('*')) if p.is_file() and not any(x in ('__pycache__','node_modules','build','.git') for x in p.relative_to(ROOT).parts)]
    manifest={str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.name!='SHA256SUMS.json'}
    (ROOT/'SHA256SUMS.json').write_text(json.dumps(manifest,indent=2)+'\n')
    files=[p for p in files if p.name!='SHA256SUMS.json']+[ROOT/'SHA256SUMS.json']
    archive=ROOT.parent/'TicTacToeArm_Complete_Project.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in files:z.write(p,Path('TicTacToeArm_Complete_Project')/p.relative_to(ROOT))
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        for p in files:
            name=(Path('TicTacToeArm_Complete_Project')/p.relative_to(ROOT)).as_posix()
            assert z.read(name)==p.read_bytes()
    print(f'Submission archive verified: {archive} ({len(files)} files; {archive.stat().st_size:,} bytes)')

if __name__=='__main__':main()

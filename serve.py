"""Local-only dashboard server. Does not open a serial port or control hardware."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
import webbrowser

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8766)
    parser.add_argument('--open',action='store_true')
    args=parser.parse_args()
    SimpleHTTPRequestHandler.extensions_map.update({'.mjs':'text/javascript','.svg':'image/svg+xml'})
    handler=partial(SimpleHTTPRequestHandler,directory=str(Path(__file__).parent/'web'))
    try:
        server=ThreadingHTTPServer(('127.0.0.1',args.port),handler)
    except OSError as error:
        raise SystemExit(f'Cannot start local dashboard on port {args.port}: {error}. Close the previous server or use --port 8767.')
    url=f'http://127.0.0.1:{args.port}/'
    print(f'Six-servo Tic-Tac-Toe dashboard: {url}\nKeep this window open. Ctrl+C closes the local server.',flush=True)
    if args.open:webbrowser.open(url)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':main()

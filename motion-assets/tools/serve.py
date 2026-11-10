#!/usr/bin/env python3
"""Serve the library root over http so tools/harness.html works in a browser:  python tools/serve.py [port]"""
import functools, http.server, os, socketserver, sys
sys.path.insert(0, os.path.dirname(__file__))
from _common import ROOT, write_manifest, _H
if __name__ == '__main__':
    write_manifest(); port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', port), functools.partial(_H, directory=ROOT)) as s:
        print(f'http://127.0.0.1:{port}/tools/harness.html?asset=tech/big-stat&t=2'); s.serve_forever()

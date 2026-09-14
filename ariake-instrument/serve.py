"""Open the app in a browser.

    python serve.py            open the instrument
    python serve.py --verify   open the verification page instead

The app is a plain folder and index.html can simply be double clicked. This
script is here for convenience and for browsers whose security settings
block a local page from reading its own data file.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import os
import socketserver
import threading
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8777


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--port", type=int, default=PORT)
    a = ap.parse_args()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=HERE)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", a.port), handler) as httpd:
        url = "http://127.0.0.1:%d/%s" % (
            a.port, "test/verify.html" if a.verify else "index.html")
        print("serving %s" % HERE)
        print("open %s" % url)
        print("press control C to stop")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()

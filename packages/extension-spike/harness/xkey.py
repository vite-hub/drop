# Sends real X11 key presses through XTEST, for browser UI that page-level automation can't reach
# (Chrome's permission dialog, extension command shortcuts). Usage: DISPLAY=:N python3 xkey.py alt+shift+y Return
import ctypes
import sys
import time

x11 = ctypes.CDLL("libX11.so.6")
xtst = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XFlush.argtypes = [ctypes.c_void_p]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

NAMES = {"alt": "Alt_L", "shift": "Shift_L", "ctrl": "Control_L", "enter": "Return", "tab": "Tab"}

display = x11.XOpenDisplay(None)
if not display:
    sys.exit("cannot open display")


def code(name):
    return x11.XKeysymToKeycode(display, x11.XStringToKeysym(NAMES.get(name.lower(), name).encode()))


for chord in sys.argv[1:]:
    keys = [code(key) for key in chord.split("+")]
    for key in keys:
        xtst.XTestFakeKeyEvent(display, key, True, 0)
    for key in reversed(keys):
        xtst.XTestFakeKeyEvent(display, key, False, 0)
    x11.XFlush(display)
    time.sleep(0.3)

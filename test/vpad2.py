#!/usr/bin/env python3
"""Exact uinput clones of the devices on Will's machine.
Usage: vpad2.py {asrock|u2c}
stdin: press/hold/release <btn>, axis <name> <-1..1>, hat <x|y> <-1|0|1>, quit
"""
import sys, time
from evdev import UInput, ecodes as e, AbsInfo

mode = sys.argv[1]
A = AbsInfo

if mode == "asrock":
    name, vendor, product, version = "ASRock LED Controller", 0x26CE, 0x01A2, 0x0110
    ax255 = lambda: A(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)
    axes = {n: (code, ax255()) for n, code in {
        "x": e.ABS_X, "y": e.ABS_Y, "z": e.ABS_Z, "rx": e.ABS_RX, "ry": e.ABS_RY,
        "rz": e.ABS_RZ, "throttle": e.ABS_THROTTLE, "rudder": e.ABS_RUDDER,
        "wheel": e.ABS_WHEEL, "misc": e.ABS_MISC}.items()}
    axes["hatx"] = (e.ABS_HAT0X, A(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0))
    axes["haty"] = (e.ABS_HAT0Y, A(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0))
    btns = {"select": e.BTN_SELECT, "start": e.BTN_START,
            "up": e.KEY_UP, "down": e.KEY_DOWN, "left": e.KEY_LEFT, "right": e.KEY_RIGHT,
            "power": e.KEY_POWER, "help": e.KEY_HELP, "menu": e.KEY_MENU,
            "sleep": e.KEY_SLEEP, "wakeup": e.KEY_WAKEUP, "prog1": e.KEY_PROG1,
            "exit": e.KEY_EXIT, "svm": e.KEY_SWITCHVIDEOMODE, "micmute": e.KEY_MICMUTE,
            "ksel": e.KEY_SELECT, "power2": e.KEY_POWER2, "restart": e.KEY_RESTART,
            "ctx": e.KEY_CONTEXT_MENU}
else:  # 8BitDo Ultimate 2C Wireless Controller (DInput mode)
    name, vendor, product, version = "8BitDo Ultimate 2C Wireless Controller", 0x2DC8, 0x310A, 0x0114
    stick = lambda v=0: A(value=v, min=-32768, max=32767, fuzz=16, flat=128, resolution=0)
    trig = lambda: A(value=0, min=0, max=255, fuzz=0, flat=0, resolution=0)
    hat = lambda: A(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0)
    axes = {"lx": (e.ABS_X, stick()), "ly": (e.ABS_Y, stick(-1)),
            "lt": (e.ABS_Z, trig()), "rx": (e.ABS_RX, stick()),
            "ry": (e.ABS_RY, stick(-1)), "rt": (e.ABS_RZ, trig()),
            "hatx": (e.ABS_HAT0X, hat()), "haty": (e.ABS_HAT0Y, hat())}
    btns = {"a": e.BTN_SOUTH, "b": e.BTN_EAST, "x": e.BTN_NORTH, "y": e.BTN_WEST,
            "lb": e.BTN_TL, "rb": e.BTN_TR, "select": e.BTN_SELECT, "start": e.BTN_START,
            "mode": e.BTN_MODE, "ls": e.BTN_THUMBL, "rs": e.BTN_THUMBR}

caps = {e.EV_ABS: [v for v in axes.values()], e.EV_KEY: list(btns.values())}
ui = UInput(caps, name=name, vendor=vendor, product=product, version=version)
print(f"READY {name!r}", flush=True)

def scale(axname, v):
    code, info = axes[axname]
    if info.min == 0:
        return int(round((v + 1) / 2 * info.max))
    return int(round(v * (info.max if v >= 0 else -info.min - 1)))

for line in sys.stdin:
    parts = line.strip().split()
    if not parts:
        continue
    try:
        cmd = parts[0]
        if cmd == "quit":
            break
        if cmd in ("press", "hold", "release"):
            b = btns[parts[1]]
            if cmd == "press":
                ui.write(e.EV_KEY, b, 1); ui.syn(); time.sleep(0.15)
                ui.write(e.EV_KEY, b, 0); ui.syn()
            else:
                ui.write(e.EV_KEY, b, 1 if cmd == "hold" else 0); ui.syn()
        elif cmd == "axis":
            code, info = axes[parts[1]]
            ui.write(e.EV_ABS, code, scale(parts[1], float(parts[2]))); ui.syn()
        elif cmd == "hat":
            code = e.ABS_HAT0X if parts[1] == "x" else e.ABS_HAT0Y
            ui.write(e.EV_ABS, code, int(parts[2])); ui.syn()
        print(f"OK {line.strip()}", flush=True)
    except Exception as ex:
        print(f"ERR {ex}", flush=True)

ui.close()
print("CLOSED", flush=True)

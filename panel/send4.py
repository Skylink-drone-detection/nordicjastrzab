import json
import math
import random
import socket
import time
from datetime import datetime

# ── CONFIG ───────────────────────────────────────────────────────────────
LAPTOP_IP = "127.0.0.1"
PORT = 5005

# Flight parameters
SPEED = 0.0004          # step size per tick (in coordinate units, ~40m at this latitude)
MAX_TURN_DEG = 30       # max turn angle per tick (degrees) — randomized 0..this
INITIAL_HEADING = random.uniform(0, 360)  # random start direction

# Starting offset from system center
pos_x = 0.000007
pos_y = 0.0000007
heading = INITIAL_HEADING  # degrees, 0=north, 90=east


def clamp_angle(deg: float) -> float:
    """Keep angle in 0..360 range."""
    return deg % 360


def step_drone():
    """Advance drone one tick: turn randomly within MAX_TURN_DEG, then move forward."""
    global pos_x, pos_y, heading

    # Random turn: pick an angle between 0 and MAX_TURN_DEG, then random sign
    turn = random.uniform(0, MAX_TURN_DEG) * random.choice([-1, 1])
    heading = clamp_angle(heading + turn)

    # Convert heading to radians (0° = north = +y, 90° = east = +x)
    rad = math.radians(heading)
    dx = SPEED * math.sin(rad)
    dy = SPEED * math.cos(rad)

    pos_x += dy  # latitude-ish (north-south)
    pos_y += dx  # longitude-ish (east-west)


def generate_drone_data() -> list:
    step_drone()
    return [
        {
            "timestamp": datetime.now().isoformat(),
            "score": 1.0,
            "position": [pos_x, pos_y],
        }
    ]


# ── MAIN ─────────────────────────────────────────────────────────────────
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    try:
        s.connect((LAPTOP_IP, PORT))
        print(f"Połączono. Heading startowy: {heading:.1f}°, max skręt: ±{MAX_TURN_DEG}°")
        print("Wysyłam dane (płynny lot)...")
        while True:
            data = generate_drone_data()
            payload = json.dumps(data) + "\n"
            s.sendall(payload.encode("utf-8"))
            time.sleep(1)
    except Exception as e:
        print(f"Błąd: {e}")

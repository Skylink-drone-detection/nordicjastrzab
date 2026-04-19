import json
import random
import socket
import time
from datetime import datetime
import socket

# Konfiguracja
LAPTOP_IP = "127.0.0.1"  # Wpisz IP swojego laptopa
PORT = 5005

# Startowe współrzędne (symulujemy małe przesunięcia)
pos_x, pos_y = 0.000007, 0.0000007


def generate_drone_data():
    global pos_x, pos_y
    # Symulacja lekkiego ruchu
    pos_x += random.uniform(-0.0006, 0.0006)
    pos_y += random.uniform(-0.0006, 0.0006)

    timestamp = datetime.now().isoformat()

    # Tworzymy listę z dwoma dronami w Twoim formacie
    data = [
        {"timestamp": timestamp, "score": 1.0, "position": [pos_x, pos_y]},
    ]
    return data


with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    try:
        s.connect((LAPTOP_IP, PORT))
        print("Połączono. Wysyłam dane w nowym formacie...")
        while True:
            data = generate_drone_data()
            payload = json.dumps(data) + "\n"
            s.sendall(payload.encode("utf-8"))
            time.sleep(1)
    except Exception as e:
        print(f"Błąd: {e}")

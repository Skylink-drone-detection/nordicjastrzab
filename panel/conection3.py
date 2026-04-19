import serial
import json
from datetime import datetime
import time

PORT = 'COM13'
BAUDRATE = 115200  # Adjust if needed

data = []
last_clear = time.time()

with serial.Serial(PORT, BAUDRATE, timeout=1) as ser:
    print("Czekam na dane z COM13...")
    
    while True:
        l=ser.readline()
        print(l)
        line = l.decode('utf-8').strip()
        if line.startswith('position,'):
            # Clear data every 3 seconds
            if time.time() - last_clear > 3:
                data = []
                last_clear = time.time()
            
            parts = line.split(',')
            if len(parts) == 5:
                _, lat_str, lon_str, _, name = parts
                try:
                    lat = 10*float(lat_str)
                    lon = 10*float(lon_str)
                    timestamp = datetime.now().isoformat()
                    
                    # Create drone object
                    drone = {
                        "timestamp": timestamp,
                        "score": 1.0,
                        "position": [lat, lon],
                        "name": name
                    }
                    
                    # Append to data list
                    data.append(drone)
                    
                    # Save the entire list to JSON
                    with open("panel_data.json", "w") as f:
                        json.dump(data, f, indent=4)
                    
                    print(f"Zaktualizowano panel_data.json z nazwą: {name} o godz: {timestamp}")
                except ValueError as e:
                    print(f"Błąd parsowania linii: {line} - {e}")
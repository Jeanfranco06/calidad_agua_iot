"""Prueba de autorización MQTT para la cuenta exclusiva de monitoreo móvil."""
import json
import os
import secrets
import threading
import time
from pathlib import Path

import paho.mqtt.client as mqtt


def load_env():
    env = {}
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip()
    return env


config = load_env()
username = os.getenv("MQTT_USER_MOBILE", config.get("MQTT_USER_MOBILE", "mobile_monitor"))
password = os.getenv("MQTT_PASS_MOBILE", config.get("MQTT_PASS_MOBILE", ""))
host = os.getenv("BROKER_HOST", "127.0.0.1")
transport = os.getenv("MQTT_TRANSPORT", "tcp").lower()
port = int(os.getenv("BROKER_WS_PORT", "8084")) if transport == "websockets" else int(os.getenv("BROKER_TCP_PORT", "1884"))
if not password:
    raise SystemExit("Falta MQTT_PASS_MOBILE en el .env local. Ejecute mobile/provision_mobile_account.ps1.")

connected = threading.Event()
allowed_suback = threading.Event()
denied_suback = threading.Event()
telemetry_received = threading.Event()
probe_received = threading.Event()
results = {"allowed_qos": None, "denied_qos": None}
probe_topic = f"cistern/lab11probe{secrets.token_hex(5)}/telemetry"


def on_connect(client, userdata, flags, rc):
    if rc != 0:
        return
    connected.set()


def on_subscribe(client, userdata, mid, granted_qos):
    values = [int(item) for item in granted_qos]
    # Filter requests are issued in order; distinguish by SUBACK callback MID via userdata map.
    kind = userdata["mids"].get(mid)
    if kind == "allowed":
        results["allowed_qos"] = values
        allowed_suback.set()
    elif kind == "denied":
        results["denied_qos"] = values
        denied_suback.set()


def on_message(client, userdata, message):
    if message.topic == probe_topic:
        probe_received.set()
    else:
        telemetry_received.set()
        try:
            item = json.loads(message.payload.decode("utf-8"))
            print(f"Telemetría recibida para {item.get('device_id', 'dispositivo')}.")
        except (UnicodeDecodeError, json.JSONDecodeError):
            print("Se recibió un mensaje no JSON en el filtro permitido.")


observer_data = {"mids": {}}
def new_client(client_id, userdata=None):
    client = mqtt.Client(client_id=client_id, userdata=userdata, transport=transport)
    client.username_pw_set(username, password)
    if transport == "websockets":
        client.ws_set_options(path=os.getenv("BROKER_WS_PATH", "/mqtt"))
    return client


observer = new_client(f"mobile_acl_observer_{secrets.token_hex(4)}", observer_data)
observer.on_connect = on_connect
observer.on_subscribe = on_subscribe
observer.on_message = on_message
observer.connect(host, port, keepalive=30)
observer.loop_start()

try:
    if not connected.wait(8):
        raise RuntimeError("No se pudo conectar con el broker; revise listener, usuario y clave.")
    # Pause network callbacks until SUBACK message IDs have been mapped.
    observer.loop_stop()
    allowed = observer.subscribe("cistern/+/telemetry", qos=1)
    denied = observer.subscribe("cistern/unauthorized/#", qos=1)
    observer_data["mids"][allowed[1]] = "allowed"
    observer_data["mids"][denied[1]] = "denied"
    observer.loop_start()
    if not allowed_suback.wait(6):
        raise RuntimeError("No llegó SUBACK para la suscripción de telemetría.")
    if not denied_suback.wait(6):
        raise RuntimeError("No llegó SUBACK para la suscripción fuera de permiso.")
    allowed_ok = results["allowed_qos"] and results["allowed_qos"][0] < 128
    denied_ok = results["denied_qos"] and results["denied_qos"][0] >= 128
    print(f"Suscripción telemetría permitida: {'OK' if allowed_ok else 'FALLO'}")
    print(f"Suscripción fuera de ACL denegada: {'OK' if denied_ok else 'FALLO'}")

    # Observe the allowed filter from a second session while probing a publish-only-denied topic.
    # The wildcard subscription already covers this probe. Publish from another authenticated session.
    publisher = new_client(f"mobile_acl_publisher_{secrets.token_hex(4)}")
    publisher.connect(host, port, keepalive=30)
    publisher.loop_start()
    try:
        time.sleep(0.5)
        publisher.publish(probe_topic, "acl-probe", qos=1)
        time.sleep(2)
    finally:
        publisher.loop_stop()
        publisher.disconnect()
    publish_denied = not probe_received.is_set()
    print(f"Publicación fuera de permiso no entregada: {'OK' if publish_denied else 'FALLO'}")
    print(f"Lectura real del simulador recibida: {'OK' if telemetry_received.wait(8) else 'PENDIENTE'}")
    if not (allowed_ok and denied_ok and publish_denied):
        raise SystemExit(1)
finally:
    observer.loop_stop()
    observer.disconnect()

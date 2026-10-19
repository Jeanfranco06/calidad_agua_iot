"""Verifica la integración WebSocket, nodos simulados y persistencia MySQL."""

import json
import os
import sys
import time
import uuid
from collections import Counter
from pathlib import Path
from threading import Event

import mysql.connector
import paho.mqtt.client as mqtt


TOPIC = "cistern/+/telemetry"
EXPECTED_NODES = {
    "ESP32_FISICO_UNT",
    "ESP32_V1_BLOQUE_A",
    "ESP32_V2_BLOQUE_B",
}


def load_env(path):
    values = {}
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def db_snapshot():
    connection = mysql.connector.connect(
        host=os.getenv("DB_HOST", "mysql_server"),
        user=os.getenv("DB_USER", "emqx_user"),
        password=os.getenv("DB_PASSWORD", "emqx_pass"),
        database=os.getenv("DB_NAME", "emqx_db"),
    )
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT COUNT(*) FROM telemetria")
        total = cursor.fetchone()[0]
        cursor.execute(
            "SELECT id_dispositivo, COUNT(*) FROM telemetria "
            "WHERE fecha_hora >= NOW() - INTERVAL 60 SECOND "
            "GROUP BY id_dispositivo ORDER BY id_dispositivo"
        )
        recent = {device: count for device, count in cursor.fetchall()}
        cursor.execute(
            "SELECT id_dispositivo, estado_operativo "
            "FROM dispositivos ORDER BY id_dispositivo"
        )
        states = {device: state for device, state in cursor.fetchall()}
        return {"total": total, "recent_by_node": recent, "device_states": states}
    finally:
        connection.close()


def validate_message(topic, payload):
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != "cistern" or parts[2] != "telemetry":
        raise ValueError("Tópico fuera del contrato")
    data = json.loads(payload.decode("utf-8"))
    if not isinstance(data, dict) or data.get("device_id") != parts[1]:
        raise ValueError("device_id no coincide con el tópico")
    if not isinstance(data.get("location"), str):
        raise ValueError("location ausente")
    if not isinstance(data.get("timestamp"), int):
        raise ValueError("timestamp no es entero Unix")
    if not isinstance(data.get("hardware_health"), str):
        raise ValueError("hardware_health ausente")
    metrics = data.get("metrics")
    if not isinstance(metrics, dict):
        raise ValueError("metrics ausente")
    for name in ("turbidity_ntu", "temperature_c", "pin_voltage_v"):
        if name not in metrics:
            raise ValueError(f"Falta metrics.{name}")
        value = metrics[name]
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ValueError(f"metrics.{name} no es numérico")
    return data


def run():
    credentials = load_env(os.environ["ENV_FILE"])
    user = credentials.get("MQTT_USER_SUB", "")
    password = credentials.get("MQTT_PASS_SUB", "")
    if not user or not password:
        raise ValueError("Faltan credenciales del suscriptor en el archivo temporal")

    before = db_snapshot()
    client_id = "alexis_integracion_" + uuid.uuid4().hex[:10]
    connected = Event()
    subscribed = Event()
    counts = Counter()
    samples = {}
    invalid = []
    connection_result = []
    subscription_result = []

    client = mqtt.Client(client_id=client_id, protocol=mqtt.MQTTv5, transport="websockets")
    client.ws_set_options(path="/mqtt")
    client.username_pw_set(user, password)

    def on_connect(mqtt_client, userdata, flags, reason_code, properties=None):
        connection_result.append(str(reason_code))
        if getattr(reason_code, "value", reason_code) == 0:
            connected.set()
            mqtt_client.subscribe(TOPIC, qos=1)

    def on_subscribe(mqtt_client, userdata, mid, granted_qos, properties=None):
        codes = [getattr(qos, "value", qos) for qos in granted_qos]
        subscription_result.extend(codes)
        if codes and all(code < 128 for code in codes):
            subscribed.set()

    def on_message(mqtt_client, userdata, message):
        try:
            data = validate_message(message.topic, message.payload)
            device_id = data["device_id"]
            counts[device_id] += 1
            samples.setdefault(device_id, {
                "topic": message.topic,
                "qos": message.qos,
                "payload": data,
            })
        except Exception as error:
            invalid.append({"topic": message.topic, "error": str(error)})

    client.on_connect = on_connect
    client.on_subscribe = on_subscribe
    client.on_message = on_message
    started = time.time()
    try:
        client.connect("emqx_broker", 8083, keepalive=60)
        client.loop_start()
        connected.wait(8)
        subscribed.wait(8)
        deadline = time.time() + 12
        while time.time() < deadline and not EXPECTED_NODES.issubset(counts):
            time.sleep(0.2)
        time.sleep(2)
    finally:
        client.disconnect()
        client.loop_stop()

    after = db_snapshot()
    checks = {
        "websocket_mqtt5_autenticado": connected.is_set(),
        "suscripcion_telemetria_concedida": subscribed.is_set(),
        "contrato_json_valido": bool(counts) and not invalid,
        "nodos_nominales_observados": EXPECTED_NODES.issubset(counts),
        "telemetria_persistida_crece": after["total"] > before["total"],
    }
    result = {
        "responsable": "Vigo Huayán, Alexis Gean Gerardo",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "duration_seconds": round(time.time() - started, 2),
        "client_id": client_id,
        "username": user,
        "transport": "MQTT 5 sobre WebSocket",
        "broker": "ws://emqx_broker:8083/mqtt",
        "subscription": TOPIC,
        "connection_reason": connection_result,
        "suback_codes": subscription_result,
        "samples_by_node": dict(counts),
        "first_valid_sample_by_node": samples,
        "invalid_samples": invalid,
        "mysql_before": before,
        "mysql_after": after,
        "checks": checks,
        "status": "APROBADA" if all(checks.values()) else "FALLIDA",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception as error:
        print(json.dumps({"status": "FALLIDA", "error": str(error)}, ensure_ascii=False))
        sys.exit(1)

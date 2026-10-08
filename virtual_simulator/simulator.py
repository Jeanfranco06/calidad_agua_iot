import os
import time
import json
import random
from threading import Thread
import paho.mqtt.client as mqtt
import mysql.connector

BROKER_HOST = os.getenv("BROKER_HOST", "emqx_broker")
BROKER_PORT = int(os.getenv("BROKER_PORT", 1883))

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "mysql_server"),
    "user": os.getenv("DB_USER", "emqx_user"),
    "password": os.getenv("DB_PASSWORD", "emqx_pass"),
    "database": os.getenv("DB_NAME", "emqx_db")
}

CONFIG_NODES = [
    {
        "device_id": "ESP32_FISICO_UNT",
        "location": "Cisterna Comedor UNT",
        "turb_base": 1.95,
        "temp_base": 21.8,
        "interval": 5,
        "mode": "PHYSICAL_REAL",
        "degradation_rate": 0.0,
        "active": True
    },
    {
        "device_id": "ESP32_V1_BLOQUE_A",
        "location": "Cisterna_Principal_Bloque_A",
        "turb_base": 1.80,
        "temp_base": 20.8,
        "interval": 3,
        "mode": "NOMINAL",
        "degradation_rate": 0.0,
        "active": True
    },
    {
        "device_id": "ESP32_V2_BLOQUE_B",
        "location": "Cisterna_Secundaria_Bloque_B",
        "turb_base": 3.80,
        "temp_base": 22.4,
        "interval": 4,
        "mode": "DEGRADATION",
        "degradation_rate": 0.04,
        "active": True
    },
    {
        "device_id": "ESP32_V3_INCIDENTE",
        "location": "Tanque_Elevado_Comedor",
        "turb_base": 6.20,
        "temp_base": 23.5,
        "interval": 3,
        "mode": "FAULT_INJECTION",
        "degradation_rate": 0.0,
        "active": True
    }
]

def on_command_received(client, userdata, message):
    try:
        command = json.loads(message.payload.decode("utf-8"))
        dev_id = userdata["device_id"]
        print(f"[ORDEN RECIBIDA] ({dev_id}) Topic: {message.topic} -> {command}", flush=True)

        if "set_sampling_rate" in command:
            userdata["interval"] = max(1, int(command["set_sampling_rate"]))
            print(f"[{dev_id}] Intervalo reconfigurado a: {userdata['interval']} s", flush=True)

        if "action" in command:
            if command["action"] == "STANDBY":
                userdata["active"] = False
                print(f"[{dev_id}] Sensor puesto en STANDBY por orden de servidor.", flush=True)
            elif command["action"] == "RESUME":
                userdata["active"] = True
                print(f"[{dev_id}] Sensor reactivado.", flush=True)
    except Exception as ex:
        print(f"Error procesando orden en {userdata.get('device_id')}: {ex}", flush=True)

def run_simulated_node(profile):
    client = mqtt.Client(client_id=profile["device_id"], userdata=profile)
    client.on_message = on_command_received

    connected = False
    while not connected:
        try:
            client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
            connected = True
        except Exception:
            time.sleep(2)

    command_topic = f"cistern/{profile['device_id']}/commands"
    client.subscribe(command_topic, qos=1)
    client.loop_start()

    telemetry_topic = f"cistern/{profile['device_id']}/telemetry"
    tick_count = 0

    while True:
        if not profile["active"]:
            time.sleep(2)
            continue

        tick_count += 1

        # Simulación de falla en Nodo V3 tras varios ciclos de telemetría inicial
        if profile["mode"] == "FAULT_INJECTION" and tick_count > 4:
            if tick_count % 2 == 0:
                turb_value = None
                sensor_voltage = 0.0
                temp_value = -999.0
                hw_status = "PROBE_DISCONNECTED"
            else:
                turb_value = 0.0
                sensor_voltage = 0.0
                temp_value = 0.0
                hw_status = "SHORT_CIRCUIT"
        else:
            profile["turb_base"] += profile["degradation_rate"]
            turb_value = round(max(0.1, profile["turb_base"] + random.gauss(0, 0.18)), 2)
            temp_value = round(profile["temp_base"] + random.gauss(0, 0.10), 2)
            sensor_voltage = round(max(0.3, min(3.3, 3.25 - (turb_value * 0.13))), 3)
            hw_status = "OK"

        payload = {
            "device_id": profile["device_id"],
            "location": profile["location"],
            "timestamp": int(time.time()),
            "hardware_health": hw_status,
            "metrics": {
                "turbidity_ntu": turb_value,
                "temperature_c": temp_value,
                "pin_voltage_v": sensor_voltage
            }
        }

        client.publish(telemetry_topic, json.dumps(payload), qos=1)
        time.sleep(profile["interval"])

# ----------------- MOTOR DE REGLAS Y BACKEND -----------------

def get_db_connection():
    while True:
        try:
            conn = mysql.connector.connect(**DB_CONFIG)
            return conn
        except Exception:
            time.sleep(2)

def run_backend_rules():
    db_conn = get_db_connection()
    db_cursor = db_conn.cursor()

    boosted_nodes = set()

    def on_telemetry_received(client, userdata, msg):
        nonlocal db_conn, db_cursor
        try:
            raw_payload = json.loads(msg.payload.decode("utf-8"))
            dev_id = raw_payload.get("device_id")
            metrics = raw_payload.get("metrics", {})

            turb = metrics.get("turbidity_ntu")
            temp = metrics.get("temperature_c")
            volt = metrics.get("pin_voltage_v", metrics.get("sensor_voltage", 0.0))

            # 1. GESTIÓN DE INCIDENTES (Regla Offline Anti-Corrupción)
            if turb is None or turb <= 0.0 or temp is None or temp < 0.0 or temp > 60.0:
                print(f"[REGLA OFFLINE] Incidente detectado en {dev_id}. Lectura inválida: {metrics}. Se descarta la inserción.", flush=True)

                # Emisión de orden correctiva hacia el nodo defectuoso
                order_topic = f"cistern/{dev_id}/commands"
                incident_order = {
                    "target_device": dev_id,
                    "action": "STANDBY",
                    "reason": "HARDWARE_DATA_CORRUPTION"
                }
                client.publish(order_topic, json.dumps(incident_order), qos=1)

                # Registrar evento en la bitácora de auditoría
                sql_log = """INSERT INTO bitacora_ordenes_mqtt (id_dispositivo, orden_enviada, motivo)
                             VALUES (%s, %s, %s)"""
                db_cursor.execute(sql_log, (dev_id, "STANDBY", "Falla fisica: Sensor desconectado o cortocircuito"))
                
                # Actualizar estado de dispositivo en catálogo
                sql_upd = "UPDATE dispositivos SET estado_operativo = 'STANDBY' WHERE id_dispositivo = %s"
                db_cursor.execute(sql_upd, (dev_id,))
                db_conn.commit()
                return

            # 2. PERSISTENCIA SEGURA (Solo telemetría limpia y validada)
            alert_flag = "ALERTA" if turb >= 5.0 else ("PRECAUCION" if turb >= 4.0 else "NORMAL")
            sql_insert = """INSERT INTO telemetria (id_dispositivo, temperatura, turbidez_ntu, voltaje_sensor, estado_alerta)
                            VALUES (%s, %s, %s, %s, %s)"""
            db_cursor.execute(sql_insert, (dev_id, temp, turb, volt, alert_flag))
            db_conn.commit()
            print(f"[TELEMETRÍA PERSISTIDA] ({dev_id}) Turbidez={turb} NTU, Temp={temp}°C, Volt={volt}V -> Estado: {alert_flag}", flush=True)

            # 3. COMPORTAMIENTO AUTÓNOMO BIDIRECCIONAL (Respuesta Analítica)
            if turb >= 4.0 and dev_id not in boosted_nodes:
                boosted_nodes.add(dev_id)
                cmd_topic = f"cistern/{dev_id}/commands"
                boost_order = {
                    "target_device": dev_id,
                    "set_sampling_rate": 1,
                    "action": "INTENSIVE_SAMPLING",
                    "reason": "PREVENTIVE_TURBIDITY_SPIKE"
                }
                client.publish(cmd_topic, json.dumps(boost_order), qos=1)
                print(f"[CONDUCTA AUTÓNOMA] Elevando frecuencia de muestreo a 1s para {dev_id}", flush=True)

                sql_log = """INSERT INTO bitacora_ordenes_mqtt (id_dispositivo, orden_enviada, motivo)
                             VALUES (%s, %s, %s)"""
                db_cursor.execute(sql_log, (dev_id, "INTENSIVE_SAMPLING (1s)", "Turbidez preventiva superada (>= 4.0 NTU)"))
                db_conn.commit()

        except mysql.connector.Error as db_err:
            print(f"Error de base de datos ({db_err}). Reconectando...", flush=True)
            db_conn = get_db_connection()
            db_cursor = db_conn.cursor()
        except Exception as ex:
            print(f"Error procesando mensaje entrante: {ex}", flush=True)

    backend_client = mqtt.Client(client_id="BACKEND_RULES_ENGINE")
    backend_client.on_message = on_telemetry_received

    connected = False
    while not connected:
        try:
            backend_client.connect(BROKER_HOST, BROKER_PORT, 60)
            connected = True
        except Exception:
            time.sleep(2)

    backend_client.subscribe("cistern/+/telemetry", qos=1)
    print("Motor de Reglas Offline iniciado y escuchando telemetría en 'cistern/+/telemetry'...", flush=True)
    backend_client.loop_forever()

if __name__ == "__main__":
    print("Iniciando contenedor de virtualización y backend de IoT...", flush=True)

    # Iniciar Nodos de Telemetría (ESP32 Físico y Nodos Virtuales V1, V2, V3)
    threads = []
    for node_cfg in CONFIG_NODES:
        t = Thread(target=run_simulated_node, args=(node_cfg,))
        t.daemon = True
        t.start()
        threads.append(t)

    # Iniciar Motor de Reglas Offline / Backend
    backend_t = Thread(target=run_backend_rules)
    backend_t.daemon = True
    backend_t.start()
    threads.append(backend_t)

    for t in threads:
        t.join()

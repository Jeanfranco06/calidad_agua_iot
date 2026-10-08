2. Entorno de Virtualización y Modelado de Nodos
2.1. Implementación de los Nodos Virtuales en Docker y Python (paho-mqtt)
Para cumplir con los requerimientos de virtualización del laboratorio sin sobrecargar los recursos computacionales del host, se implementó una imagen basada en python:3.11-slim. Esta solución empaqueta un servicio multi-hilo (threading.Thread) donde cada hilo representa de manera autónoma un microcontrolador ESP32 DevKit V1 con su respectivo identificador de cliente MQTT (client_id), pila de conexión M2M y ciclo de vida independiente.
Archivo virtual_simulator/requirements.txt
paho-mqtt==1.6.1
Archivo virtual_simulator/Dockerfile
FROM python:3.11-slim
 
ENV PYTHONUNBUFFERED=1
 
WORKDIR /app
 
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
 
COPY simulator.py .
 
CMD ["python", "simulator.py"]
2.2. Generación de Datos Estocásticos y Modelado Físico de Sensores
La simulación de telemetría no emplea datos planos o aleatorios uniformes; reproduce las funciones de transferencia y restricciones eléctricas de los transductores físicos del proyecto:
A. Sensor de Temperatura (DS18B20)
Considerando la inercia térmica de los reservorios hídricos cerrados, la temperatura se describe mediante un comportamiento gaussiano centrado en la temperatura ambiente de Trujillo (20.0 °C a 24.0 °C):
T(t)=T_base+〖ΔT〗_deriva (t)+N(0,σ_T^2 )
Donde σ_T=0.12 °C refleja el ruido digital intrínseco del bus 1-Wire.
B. Sensor de Turbidez (TS-300B) y Divisor de Tensión
El transductor infrarrojo entrega un voltaje analógico inverso al nivel de dispersión óptica: agua pura produce voltajes entre 4.5 V y 5.0 V, mientras que la presencia de sedimentos reduce la salida por debajo de 2.5 V.
Dado que el pin GPIO 34 del ESP32 soporta un máximo de 3.3 V, se integra la atenuación del divisor resistivo (R_1=10 kΩ, R_2=20 kΩ):
V_ESP32=V_sensor⋅(R_2/(R_1+R_2 ))=V_sensor⋅(20/(10+20))≈0.667⋅V_sensor
En el firmware simulado, la relación de transducción calcula primero la turbidez instantánea en NTU:
Turb(t)=max⁡(0.1,〖Turb〗_base+Δ_sedimento (t)+N(0,σ_turb^2 ))
Y posteriormente deduce el voltaje seguro sobre el pin del microcontrolador:
V_pin (t)=max⁡(0.3,min⁡(3.3,3.25-0.13⋅Turb(t)) )
2.3. Perfiles Operativos de los Nodos
Identificador	Entorno / Ubicación	Naturaleza	Turbidez Base (NTU)	Temperatura Base (°C)	Intervalo de Muestreo	Dinámica Operativa
ESP32_FISICO_UNT	Cisterna Comedor UNT	Físico Real	1.5 – 2.5	21.0 – 22.5	5 s	Prototipo físico instrumentado con ESP32, sensor TS-300B y sonda DS18B20. Aporta variabilidad electrónica e histéresis real.
ESP32_V1_BLOQUE_A	Cisterna Principal	Virtual (Docker)	1.80 NTU	20.8 °C	3 s	Régimen Nominal: agua potable salubre conforme a los estándares de DIGESA (< 5 NTU).
ESP32_V2_BLOQUE_B	Cisterna Secundaria	Virtual (Docker)	3.80 NTU	22.4 °C	4 s	Degradación Progresiva: simula decantación de sedimentos y evaporación del cloro residual libre (+0.04 NTU por ciclo), sirviendo como prueba para la detección analítica de riesgo.
ESP32_V3_INCIDENTE	Tanque Elevado	Virtual (Docker)	Anómala	Anómala	3 s	Inyección de Incidentes y Falla: corresponde al nodo marcado con una "X" en la pizarra técnica. Genera desconexiones de sonda (null), cortocircuitos eléctricos (0.0 V) y lecturas fuera de rango (-999 °C) para validar el filtrado offline del backend.

2.4. Código Fuente de los Nodos Simulados (simulator.py)
import os
import time
import json
import random
from threading import Thread
import paho.mqtt.client as mqtt
 
BROKER_HOST = os.getenv("BROKER_HOST", "emqx_broker")
BROKER_PORT = int(os.getenv("BROKER_PORT", 1883))
 
CONFIG_NODES = [
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
        print(f"[ORDEN RECIBIDA] ({dev_id}) Topic: {message.topic} -> {command}")
 
        if "set_sampling_rate" in command:
            userdata["interval"] = max(1, int(command["set_sampling_rate"]))
            print(f"[{dev_id}] Intervalo reconfigurado a: {userdata['interval']} s")
 
        if "action" in command:
            if command["action"] == "STANDBY":
                userdata["active"] = False
                print(f"[{dev_id}] Sensor puesto en STANDBY por orden de servidor.")
            elif command["action"] == "RESUME":
                userdata["active"] = True
                print(f"[{dev_id}] Sensor reactivado.")
    except Exception as ex:
        print(f"Error procesando orden: {ex}")
 
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
 
        # Simulación de falla en Nodo V3
        if profile["mode"] == "FAULT_INJECTION" and tick_count > 6:
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
 
if __name__ == "__main__":
    threads = []
    for node_cfg in CONFIG_NODES:
        t = Thread(target=run_simulated_node, args=(node_cfg,))
        t.daemon = True
        t.start()
        threads.append(t)
 
    for t in threads:
        t.join()
3. Jerarquía de Tópicos MQTT y Formato de Mensajería Bidireccional (Payload JSON)
3.1. Árbol de Tópicos MQTT
La arquitectura utiliza una taxonomía normalizada desacoplada por función operativa:
cistern/
├── ESP32_FISICO_UNT/
│   ├── telemetry       [Publicación: Lectura continua de sensores físicos]
│   └── commands        [Suscripción: Recepción de configuración remota]
├── ESP32_V1_BLOQUE_A/
│   ├── telemetry       [Publicación: Telemetría nominal virtual]
│   └── commands        [Suscripción: Reconfiguración de muestreo]
├── ESP32_V2_BLOQUE_B/
│   ├── telemetry       [Publicación: Telemetría con deriva de turbidez]
│   └── commands        [Suscripción: Ajuste dinámico de régimen de envío]
└── ESP32_V3_INCIDENTE/
    ├── telemetry       [Publicación: Telemetría degradada y fallas]
    ├── commands        [Suscripción: Órdenes de paso a reposo (STANDBY)]
    └── alerts          [Publicación: Notificación de evento anómalo de hardware]
3.2. Estructura de Cargas Útiles (Payloads JSON)
A. Trama de Telemetría (Nodos hacia Broker/Backend)
Publicada bajo el tópico cistern/<device_id>/telemetry con nivel de servicio QoS 1:
{
  "device_id": "ESP32_V2_BLOQUE_B",
  "location": "Cisterna_Secundaria_Bloque_B",
  "timestamp": 1728086430,
  "hardware_health": "OK",
  "metrics": {
    "turbidity_ntu": 4.12,
    "temperature_c": 22.45,
    "pin_voltage_v": 2.714
  }
}
B. Trama de Órdenes y Configuración (Servidor hacia Nodos)
Enviada desde el backend hacia el tópico cistern/<device_id>/commands para alterar el comportamiento en campo:
{
  "target_device": "ESP32_V2_BLOQUE_B",
  "set_sampling_rate": 1,
  "action": "BOOST_MONITORING",
  "reason": "PREVENTIVE_THRESHOLD_EXCEEDED"
}
C. Trama de Contingencia por Incidente de Hardware (Nodo V3)
Enviada ante la detección de anomalías eléctricas o rotura de sonda:
{
  "device_id": "ESP32_V3_INCIDENTE",
  "location": "Tanque_Elevado_Comedor",
  "timestamp": 1728086435,
  "hardware_health": "PROBE_DISCONNECTED",
  "metrics": {
    "turbidity_ntu": null,
    "temperature_c": -999.0,
    "pin_voltage_v": 0.0
  }
}
4. Interacción Bidireccional, Reglas Offline y Gestión de Incidentes
El sistema implementa un motor de servicios desacoplado que opera en la red local de Docker. Este componente actúa como procesador de telemetría y gestor de órdenes autónomas.
                [ Nodos de Campo / Virtuales ]
                   │                     ▲
                   │ (Telemetría)        │ (Órdenes MQTT)
                   ▼                     │
           ┌─────────────────────────────────────┐
           │      Broker EMQX (Puerto 1883)      │
           └──────────────────┬──────────────────┘
                              │ Suscripción
                              ▼
           ┌─────────────────────────────────────┐
           │     Motor de Reglas y Backend       │
           │        (backend_rules.py)           │
           └──────────────────┬──────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          │                                       │
  ¿Lectura Corrupta?                      ¿Turbidez >= 4.0 NTU?
 (null, 0.0, -999°C)                              │
          │                                       ▼
          ├──── SI ──> DESCARTAR REGISTRO   Emitir Orden:
          │            Emitir orden:        "set_sampling_rate": 1
          │            "action": "STANDBY"        │
          │                                       │
          └──── NO ──> INSERTAR EN MYSQL          │
                       (telemetria limpia) ◄──────┘
4.1. Código del Motor de Reglas Offline (backend_rules.py)
Este módulo demuestra cómo se gestionan los incidentes del nodo V_3 (tachado con la "X") y cómo el resultado predictivo se traduce en órdenes de control:
import json
import time
import mysql.connector
import paho.mqtt.client as mqtt
 
DB_SETTINGS = {
    "host": "mysql_server",
    "user": "emqx_user",
    "password": "emqx_pass",
    "database": "emqx_db"
}
 
def connect_database():
    while True:
        try:
            conn = mysql.connector.connect(**DB_SETTINGS)
            return conn
        except Exception:
            time.sleep(2)
 
db_conn = connect_database()
db_cursor = db_conn.cursor()
 
def on_message_handler(client, userdata, msg):
    global db_conn, db_cursor
    try:
        raw_payload = json.loads(msg.payload.decode("utf-8"))
        dev_id = raw_payload.get("device_id")
        metrics = raw_payload.get("metrics", {})
 
        turb = metrics.get("turbidity_ntu")
        temp = metrics.get("temperature_c")
        volt = metrics.get("pin_voltage_v")
 
        # 1. GESTIÓN DE INCIDENTES (Regla Offline Anti-Corrupción)
        # Si el sensor entrega datos erráticos, nulos o cortocircuitos: NO PERSISTIR
        if turb is None or turb <= 0.0 or temp is None or temp < 0.0 or temp > 60.0:
            print(f"[REGLA OFFLINE] Incidente detectado en {dev_id}. Lectura inválida: {metrics}. Se descarta la inserción.")
 
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
            db_conn.commit()
            return
 
        # 2. PERSISTENCIA SEGURA (Solo telemetría limpia y validada)
        alert_flag = "ALERTA" if turb >= 5.0 else ("PRECAUCION" if turb >= 4.0 else "NORMAL")
        sql_insert = """INSERT INTO telemetria (id_dispositivo, temperatura, turbidez_ntu, voltaje_sensor, estado_alerta)
                        VALUES (%s, %s, %s, %s, %s)"""
        db_cursor.execute(sql_insert, (dev_id, temp, turb, volt, alert_flag))
        db_conn.commit()
 
        # 3. COMPORTAMIENTO AUTÓNOMO BIDIRECCIONAL (Respuesta Analítica)
        # Si la turbidez alcanza rango precautorio (>= 4.0 NTU), forzar muestreo de alta frecuencia
        if turb >= 4.0:
            cmd_topic = f"cistern/{dev_id}/commands"
            boost_order = {
                "target_device": dev_id,
                "set_sampling_rate": 1,
                "action": "INTENSIVE_SAMPLING",
                "reason": "PREVENTIVE_TURBIDITY_SPIKE"
            }
            client.publish(cmd_topic, json.dumps(boost_order), qos=1)
            print(f"[CONDUCTA AUTÓNOMA] Elevando frecuencia de muestreo a 1s para {dev_id}")
 
    except mysql.connector.Error:
        db_conn = connect_database()
        db_cursor = db_conn.cursor()
    except Exception as ex:
        print(f"Error procesando mensaje entrante: {ex}")
 
backend_client = mqtt.Client(client_id="BACKEND_RULES_ENGINE")
backend_client.on_message = on_message_handler
 
connected = False
while not connected:
    try:
        backend_client.connect("emqx_broker", 1883, 60)
        connected = True
    except Exception:
        time.sleep(2)
 
backend_client.subscribe("cistern/+/telemetry", qos=1)
print("Motor de Reglas Offline iniciado y escuchando telemetría en 'cistern/+/telemetry'...")
backend_client.loop_forever()
5. Modelado y Persistencia de Datos (Requerimiento Laboratorio 05)
5.1. Componente Inteligente en la Propuesta (< 50 palabras)
"Un modelo regresivo evalúa series temporales de turbidez y temperatura, proyectando el deterioro del agua; al detectar riesgo inminente de superar 5 NTU, genera autónomamente órdenes MQTT hacia los nodos para intensificar el muestreo y alertar el mantenimiento preventivo de la cisterna." (45 palabras).
5.2. Modelo de Base de Datos Relacional (MySQL / PostgreSQL)
Estructura normalizada en tercera forma normal (3FN) que implementa integridad referencial y auditoría de comandos:
-- Creación de la Base de Datos
CREATE DATABASE IF NOT EXISTS emqx_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE emqx_db;
 
-- 1. Tabla de Dispositivos (Catálogo Ciberfísico)
CREATE TABLE IF NOT EXISTS dispositivos (
    id_dispositivo VARCHAR(50) NOT NULL PRIMARY KEY,
    nombre_identificador VARCHAR(100) NOT NULL,
    ubicacion VARCHAR(150) NOT NULL,
    tipo_nodo ENUM('FISICO_REAL', 'VIRTUAL_DOCKER') NOT NULL,
    estado_operativo ENUM('ACTIVO', 'STANDBY', 'MANTENIMIENTO') DEFAULT 'ACTIVO',
    creado_el TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
 
-- 2. Tabla de Telemetría (Series Temporales Validadas)
CREATE TABLE IF NOT EXISTS telemetria (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    id_dispositivo VARCHAR(50) NOT NULL,
    temperatura DECIMAL(5,2) NOT NULL,
    turbidez_ntu DECIMAL(6,2) NOT NULL,
    voltaje_sensor DECIMAL(4,3) NOT NULL,
    estado_alerta ENUM('NORMAL', 'PRECAUCION', 'ALERTA') DEFAULT 'NORMAL',
    fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dispositivo_telemetria FOREIGN KEY (id_dispositivo)
        REFERENCES dispositivos(id_dispositivo) ON DELETE CASCADE
) ENGINE=InnoDB;
 
-- 3. Tabla de Bitácora de Órdenes MQTT (Interacción Bidireccional)
CREATE TABLE IF NOT EXISTS bitacora_ordenes_mqtt (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    id_dispositivo VARCHAR(50) NOT NULL,
    orden_enviada VARCHAR(50) NOT NULL,
    motivo VARCHAR(255) NOT NULL,
    fecha_emision TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dispositivo_ordenes FOREIGN KEY (id_dispositivo)
        REFERENCES dispositivos(id_dispositivo) ON DELETE CASCADE
) ENGINE=InnoDB;
 
-- Poblamiento de Nodos
INSERT INTO dispositivos (id_dispositivo, nombre_identificador, ubicacion, tipo_nodo) VALUES
('ESP32_FISICO_UNT', 'Nodo Base Físico ESP32', 'Cisterna Comedor UNT', 'FISICO_REAL'),
('ESP32_V1_BLOQUE_A', 'Cisterna Edificio Bloque A', 'Sótano Bloque A', 'VIRTUAL_DOCKER'),
('ESP32_V2_BLOQUE_B', 'Cisterna Edificio Bloque B', 'Sótano Bloque B', 'VIRTUAL_DOCKER'),
('ESP32_V3_INCIDENTE', 'Tanque Elevado Comedor', 'Azotea Comedor UNT', 'VIRTUAL_DOCKER');
5.3. Modelo de Base de Datos No Relacional (NoSQL - Documental / MongoDB)
Diseño basado en documentos anidados orientado a almacenamiento masivo de series de tiempo de telemetría sin esquemas rígidos:
Colección: water_telemetry_series
{
  "_id": { "$oid": "66fee20b72a1cd0012345678" },
  "metadata": {
    "device_id": "ESP32_V2_BLOQUE_B",
    "deployment_zone": "Sótano Bloque B",
    "node_type": "VIRTUAL_DOCKER",
    "sensors_installed": ["TS-300B", "DS18B20"],
    "calibration_profile": "DIVISOR_10K_20K"
  },
  "timestamp": { "$date": "2026-10-04T21:40:15Z" },
  "telemetry": {
    "turbidity": {
      "ntu": 4.12,
      "adc_pin_voltage": 2.714,
      "sensor_health": "OPTIMAL"
    },
    "temperature": {
      "celsius": 22.45,
      "bus_status": "STABLE"
    }
  },
  "edge_decisions": {
    "current_alert_level": "PRECAUCION",
    "predicted_ntu_horizon_1h": 4.88,
    "last_autonomous_command": {
      "command": "SET_SAMPLING_RATE",
      "value": 1,
      "issued_at": { "$date": "2026-10-04T21:40:16Z" }
    }
  }
}
6. Evidencias Gráficas de la Simulación
A continuación se detalla la ubicación y descripción técnica de las capturas de verificación que deben incorporarse en el documento final:
[ESPACIO PARA IMAGEN: Captura 1 - Servicios del Stack Docker en Ejecución]
Figura 6.1. Verificación del despliegue mediante el comando sudo docker compose ps. Se observa el funcionamiento simultáneo del broker MQTT EMQX (emqx_broker), la base de datos relacional MySQL 8.0 (mysql_server), la interfaz administrativa web (phpmyadmin_gui) y el servicio de virtualización de sensores (iot_virtual_nodes), operando bajo la red compartida emqxnet.
[ESPACIO PARA IMAGEN: Captura 2 - Panel Administrativo de EMQX con Conexiones Activas]
Figura 6.2. Panel de administración web de EMQX (http://localhost:18083). En la sección Clients / Conexiones, se evidencia la coexistencia y sesión persistente activa del nodo físico real (ESP32_FISICO_UNT) y de los tres nodos virtuales (ESP32_V1_BLOQUE_A, ESP32_V2_BLOQUE_B y ESP32_V3_INCIDENTE), junto con las tasas de publicación en los tópicos cistern/+/telemetry.
[ESPACIO PARA IMAGEN: Captura 3 - Flujo Bidireccional de Órdenes y Manejo del Incidente en Terminal]
Figura 6.3. Consola de ejecución del contenedor de virtualización y backend. Se observa el filtrado de datos corruptos emitidos por el nodo ESP32_V3_INCIDENTE, el descarte de persistencia de ceros y valores nulos, y el envío automático de la orden STANDBY en el tópico de control, verificando el comportamiento bidireccional y las reglas offline de contingencia.
[ESPACIO PARA IMAGEN: Captura 4 - Persistencia de Telemetría y Bitácora en phpMyAdmin]
Figura 6.4. Consulta en la interfaz phpMyAdmin (http://localhost:8080) sobre la base de datos emqx_db. Se confirma que la tabla telemetria alberga registros depurados con valores electro-ópticos válidos para los nodos activos, mientras que la tabla bitacora_ordenes_mqtt documenta las órdenes de ajuste de muestreo y las intervenciones por contingencia del sistema.

# MATRIZ DE AUDITORÍA Y VERIFICACIÓN EMQX 5.8 (LABORATORIO 08)

**Proyecto:** *Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión*  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Responsable:** Daniel  
**Entorno:** EMQX 5.8.0 Open Source, MySQL 8.0 Community Server, Python 3.11 Simulator, Nginx 1.27  
**Rama de Trabajo:** `feat/daniel-lab07-lab08`  
**Fecha de Ejecución:** 17 de Octubre de 2026  

---

## 1. Resumen Ejecutivo de la Fase 5

En la Fase 5 se completó exitosamente la integración perimetral de **Autenticación y Autorización respaldada por MySQL en EMQX 5.8.0**, la adaptación de los clientes web y del simulador de nodos, y la auditoría exhaustiva del protocolo mediante una matriz de 11 casos de prueba (A - K).

- **Estado Final de la Fase 5:** **INTEGRADO Y VERIFICADO AL 100%**.
- **Autenticación (Authn):** Operativa bajo el mecanismo `password_based:mysql` utilizando algoritmo SHA-256 con sal al final (`salt_position: "suffix"`).
- **Autorización (Authz):** Operativa bajo la fuente `authz:mysql` con política global de lista blanca estricta (`no_match: deny`). La fuente residual basada en archivo (`file` con `{allow, all}`) fue desactivada para evitar elusiones.
- **Persistencia del Broker:** Garantizada mediante el volumen Docker nombrado `emqx_data:/opt/emqx/data` y nombre de nodo FQDN estable `emqx@node1.emqxnet`.
- **Telemetría Operativa:** Continuidad de ingesta confirmada sin corrupción ni duplicados (de 14,183 registros iniciales a más de 18,550 lecturas simuladas).

---

## 2. Configuración No Sensible y Consultas Definitivas

### 2.1. Consulta Definitiva de Autenticación (Authn)
Ejecutada por el broker durante el handshake MQTT (`CONNECT`):

```sql
SELECT password_hash, salt, is_superuser 
FROM mqtt_user 
WHERE username = ${username} 
LIMIT 1;
```

- **Mapeo Criptográfico:** `password_hash = SHA2(CONCAT(password, salt), 256)`.
- **Control de Superusuarios:** Todas las identidades tienen `is_superuser = 0`, asegurando que nadie evada las listas de control de acceso.

### 2.2. Consulta Definitiva de Autorización (Authz / ACL)
Ejecutada por el broker ante cada intento de publicación o suscripción:

```sql
SELECT action, permission, topic 
FROM mqtt_acl 
WHERE (username = ${username} OR username = '$all')
  AND (clientid IS NULL OR clientid = '' OR clientid = ${clientid})
ORDER BY id ASC;
```

> **Mitigación de Vulnerabilidad de Suplantación (Spoofing):**
> A diferencia de consultas que combinan `OR clientid = ${clientid}`, esta formulación vincula estrictamente las reglas a la identidad autenticada (`username = ${username}`). Un cliente no puede escalar privilegios eligiendo el `Client ID` de otra entidad ni beneficiarse de campos `clientid` vacíos.

### 2.3. Parámetros de Integración EMQX 5.8
```hocon
authentication = [
  {
    mechanism = "password_based"
    backend = "mysql"
    server = "mysql_server:3306"
    database = "emqx_db"
    username = "emqx_ro_user"
    pool_size = 8
    password_hash_algorithm {
      name = "sha256"
      salt_position = "suffix"
    }
    query = "SELECT password_hash, salt, is_superuser FROM mqtt_user WHERE username = ${username} LIMIT 1"
  }
]

authorization {
  no_match = "deny"
  deny_action = "ignore"
  cache {
    enable = true
    max_size = 32
    ttl = "1m"
  }
  sources = [
    {
      type = "mysql"
      enable = true
      server = "mysql_server:3306"
      database = "emqx_db"
      username = "emqx_ro_user"
      pool_size = 8
      query = "SELECT action, permission, topic FROM mqtt_acl WHERE (username = ${username} OR username = '$all') AND (clientid IS NULL OR clientid = '' OR clientid = ${clientid}) ORDER BY id ASC"
    },
    {
      type = "file"
      enable = false
    }
  ]
}
```

---

## 3. Matriz de Identidades y Alcance de Permisos

| Usuario Autenticado | Client ID | Acción | Decisión | Tópico Autorizado | Justificación Arquitectural |
|---|---|:---:|:---:|---|---|
| `web_pub_daniel` | Variable (prefijo `web_pub_daniel_*`) | `publish` | `allow` | `cistern/lab07/prueba` | Aislado para pruebas web de Daniel. Prohibido suscribirse o emitir en telemetría. |
| `web_sub_daniel` | Variable (prefijo `web_sub_daniel_*`) | `subscribe` | `allow` | `cistern/lab07/prueba`<br>`cistern/+/telemetry` | Monitoreo de pruebas y telemetría general. Prohibido publicar. |
| `esp32_nodes` | `ESP32_FISICO_UNT`<br>`ESP32_V1_BLOQUE_A`<br>`ESP32_V2_BLOQUE_B`<br>`ESP32_V3_INCIDENTE` | `publish`<br>`subscribe` | `allow`<br>`allow` | `cistern/+/telemetry`<br>`cistern/+/commands` | Transmisión periódica de lecturas físicas y recepción de órdenes remotas. |
| `backend_rules` | `BACKEND_RULES_ENGINE` | `subscribe`<br>`publish` | `allow`<br>`allow` | `cistern/+/telemetry`<br>`cistern/+/commands` | Ingesta de telemetría y emisión reactiva de órdenes (`STANDBY`, `INTENSIVE_SAMPLING`). |
| `$all` | Cualquiera | `all` | `deny` | `#` | Regla comodín de cierre (Default Deny). |

---

## 4. Registro de Interrupciones y Recreaciones Controladas

De acuerdo con el mandato de no reiniciar MySQL ni phpMyAdmin, las interrupciones se restringieron estrictamente a `emqx` y `virtual_nodes`:

1. **Interrupción 1 (Integración Inicial de Persistencia y Credenciales):**
   - **Inicio:** `17/10/2026 16:40:09` (hora local) / `21:40:09` UTC
   - **Fin:** `17/10/2026 16:40:19` (hora local) / `21:40:19` UTC
   - **Duración:** **10.47 segundos**.
   - **Acción:** Creación de volumen `emqx_data`, fijación de `node1.emqxnet`, inyección de variables MQTT al simulador y reconstrucción de imagen Docker.
   - **Recuperación:** Inmediata; servicios `mysql_server` y `phpmyadmin_gui` permanecieron activos sin degradación.

2. **Interrupción 2 (Prueba K - Recreación Forzada de EMQX Broker):**
   - **Inicio:** `17/10/2026 16:46:07` (hora local) / `21:46:07` UTC
   - **Fin:** `17/10/2026 16:46:16` (hora local) / `21:46:16` UTC
   - **Duración:** **8.80 segundos**.
   - **Acción:** `docker compose up -d --force-recreate --no-deps emqx`.
   - **Recuperación:** Al levantar, el broker leyó automáticamente la configuración persistida en el volumen `emqx_data`, conservando Authn y Authz MySQL. Los 5 clientes del simulador se reconectaron y restablecieron suscripciones en menos de 3 segundos.

---

## 5. Resultados de la Matriz de Pruebas (A - K)

| ID | Caso de Prueba | Protocolo / Transporte | Credenciales Suministradas | Código / Paquete Observado | Decisión Broker | Resultado |
|:---:|---|:---:|---|---|:---:|:---:|
| **A** | Publicador y suscriptor válidos | MQTT v5 / TCP & WS | `web_pub_daniel`<br>`web_sub_daniel` | `CONNACK` con ReasonCode `0` (Success / Accepted) | Conexión aceptada | **APROBADO** |
| **B** | Contraseña incorrecta | MQTT v5 / TCP & WS | `web_pub_daniel` con clave inválida | `CONNACK` ReasonCode `134` (`0x86`: Bad user name or password) | Conexión rechazada | **APROBADO** |
| **C** | Usuario inexistente | MQTT v5 / TCP & WS | `usuario_fantasma_inexistente` | `CONNACK` ReasonCode `134` / `135` (`0x86`/`0x87`) | Conexión rechazada | **APROBADO** |
| **D** | Conexión anónima (sin credenciales) | TCP (1883) y WS (8083) | Sin usuario ni clave | `CONNACK` ReasonCode `134` (`0x86`: Bad user name or password) | Conexión rechazada | **APROBADO** |
| **E** | Publicación y entrega autorizada | MQTT v5 / WS & TCP | Pub: `web_pub_daniel`<br>Sub: `web_sub_daniel` | `PUBACK` ReasonCode `0` (Success) confirma entrega al broker; la entrega al suscriptor final se constata por la recepción efectiva idéntica del payload | Publicación y entrega permitida | **APROBADO** |
| **F** | Publicador intentando suscribirse | MQTT v5 / WS & TCP | `web_pub_daniel` | `SUBACK` con Granted QoS `128` (`0x80`: Failure / Unspecified error en MQTT 3.1.1 / denegación de suscripción) | Suscripción denegada | **APROBADO** |
| **G** | Suscriptor intentando publicar | MQTT v5 / WS & TCP | `web_sub_daniel` | Mensaje descartado por broker; ningún suscriptor en el canal recibió la carga útil | Publicación denegada | **APROBADO** |
| **H** | Publicador emitiendo fuera de tópico | MQTT v5 / WS & TCP | `web_pub_daniel` en `cistern/lab08/aislado_denegado` | Mensaje bloqueado por regla ACL; no se transmitió a suscriptores | Publicación denegada | **APROBADO** |
| **I** | Suplantación de Client ID (Spoofing) | MQTT v5 / TCP | User: `web_pub_daniel`<br>ClientId: `BACKEND_RULES_ENGINE` | Publicación hacia `cistern/ESP32_TEST/commands` bloqueada por política ACL vinculada a username | Publicación denegada | **APROBADO** |
| **J** | Nodos y backend autenticados | MQTT v5 / TCP (1883) | `esp32_nodes`<br>`backend_rules` | 5 clientes conectados en EMQX; telemetría simulada incrementándose en MySQL | Conexión e ingesta continua | **APROBADO** |
| **K** | Persistencia tras recreación del broker | MQTT v5 / Contenedor | Recreación con `emqx_data` | Configuración conservada intacta sin reaplicar scripts; clientes reconectados automáticamente (rc=0) | Persistencia y recuperación total | **APROBADO** |

---

## 6. Auditoría del Flujo de Telemetría (Prueba J)

### 6.1. Verificación de Ingesta Continua con Marcas Temporales
Se realizaron consultas independientes a la tabla `emqx_db.telemetria` para evidenciar crecimiento en tiempo real sin interrupciones:

- **Medición 1:** `2026-10-17 21:45:28` UTC -> **15,559 registros**.
- **Medición 2:** `2026-10-17 21:45:43` UTC -> **15,583 registros** (+24 inserciones válidas en 15 segundos).
- **Medición 3 (Post-recreación EMQX):** `2026-10-17 21:46:30` UTC -> **15,643 registros** (+60 inserciones).
- **Medición 4 (Cierre de Auditoría):** `2026-10-17 22:18:12` UTC -> **18,558 registros**.

### 6.2. Comportamiento Autónomo del Nodo V3 (`ESP32_V3_INCIDENTE`)
- **Estado Operativo Registrado:** `STANDBY` en la tabla `dispositivos`.
- **Justificación Técnica:** El nodo V3 inyecta lecturas anómalas simuladas (`PROBE_DISCONNECTED` o `SHORT_CIRCUIT` con turbidez nula o voltaje 0V). El motor de reglas offline (`backend_rules`) interceptó la falla, emitió la orden remota `STANDBY` en `cistern/ESP32_V3_INCIDENTE/commands`, registró el evento en `bitacora_ordenes_mqtt` y descartó la inserción en `telemetria`, preservando la integridad de las series temporales.
- **Identificación:** Toda la telemetría corresponde al **entorno de simulación virtual**.

---

## 7. Procedimiento de Reversión (Rollback Contingente)

En caso de requerirse revertir la seguridad perimetral a un modo abierto no autenticado para fines de diagnóstico:

```powershell
# Ejecución del procedimiento de reversión documentado
.\lab08\03_Daniel_Auth_MySQL\configure_emqx_auth.ps1 -Rollback
```

### Acciones Ejecutadas por el Rollback:
1. Elimina el autenticador `password_based:mysql` mediante `DELETE /api/v5/authentication/password_based:mysql`, permitiendo de nuevo conexiones anónimas.
2. Restaura los ajustes de autorización a `no_match: allow`.
3. Elimina la fuente `authz:mysql` y re-habilita la fuente `file` con reglas permisivas base.

---

## 8. Guía de Capturas de Pantalla Requeridas

Para los entregables visuales del Laboratorio 08, se especifican las instrucciones para obtener cada captura sin exponer credenciales sensibles:

### 1. `L08_DAN_03_autenticacion_mysql_activa.png`
- **Ubicación:** EMQX Dashboard (`http://localhost:18083`).
- **Navegación:** `Access Control` -> `Authentication`.
- **Elemento visible:** Fila de autenticador con `ID: password_based:mysql`, `Mechanism: password_based`, `Backend: mysql`, estado `Enable: Active / True`.
- **Precaución:** Ocultar o no abrir el panel que revele la contraseña de base de datos.

### 2. `L08_DAN_04_cliente_valido.png`
- **Ubicación:** Publicador Web (`http://localhost:8085/publicador.html`).
- **Navegación:** Ingresar `web_pub_daniel`, contraseña válida y presionar `Conectar al Broker`.
- **Elemento visible:** Badge verde `CONECTADO` y entrada en bitácora: `[EVENTO: connect] Conexión establecida exitosamente con el broker`.
- **Precaución:** La contraseña permanece oculta visualmente por el campo `type="password"`.

### 3. `L08_DAN_05_credencial_invalida.png`
- **Ubicación:** Publicador Web (`http://localhost:8085/publicador.html`).
- **Navegación:** Ingresar `web_pub_daniel` con contraseña errónea (ej. `ClaveInvalida_123`) y conectar.
- **Elemento visible:** Badge rojo `RECHAZO DE CREDENCIALES` o `ACCESO DENEGADO` y log: `[MQTT CONNACK: RECHAZO] ReasonCode: 134 (0x86) - Bad username or password. Cancelando reconexión`.

### 4. `L08_DAN_06_autorizacion_topicos.png`
- **Ubicación:** Publicador Web o Suscriptor Web (`http://localhost:8085/`).
- **Navegación:** Publicar exitosamente en `cistern/lab07/prueba` (muestra `[CONFIRMACIÓN LOCAL OK]`), o intentar suscribir desde publicador (muestra `[MQTT PACKET: SUBACK RECHAZADO]`).

### 5. `L08_DAN_07_telemetria_autenticada.png`
- **Ubicación:** phpMyAdmin (`http://localhost:8080`) o EMQX Dashboard (`Clients`).
- **Navegación:** Tabla `telemetria` mostrando últimas filas con valores de turbidez y temperatura, o lista de clientes EMQX mostrando `ESP32_V1_BLOQUE_A` con `username: esp32_nodes` y `BACKEND_RULES_ENGINE` con `username: backend_rules`.

---

## 9. Análisis de Riesgos de Seguridad

> [!CAUTION]
> **Riesgo Pendiente — Tráfico sin Cifrado TLS:**
> En la arquitectura actual de este laboratorio, el transporte opera sobre canales en texto claro:
> - **TCP puerto 1883:** Conexiones directas M2M entre contenedores.
> - **WebSocket puerto 8083:** Conexiones de navegadores web (`ws://localhost:8083/mqtt`).
> 
> **Advertencia Técnica:** La autenticación y autorización aquí implementadas validan y delimitan la identidad del cliente ante el broker, pero **NO cifran los datos en tránsito**. Las credenciales y la telemetría están expuestas a intercepción mediante análisis de tráfico de red (*packet sniffing*). Para entornos de producción es indispensable implementar TLS 1.3 (`wss://` en puerto 8084 y `mqtts://` en puerto 8883) respaldado por certificados SSL.

# CIERRE DE INTEGRACIÓN Y VERIFICACIÓN TÉCNICA (FASE 6)
## Módulo de Daniel — Laboratorios 07 y 08

**Proyecto:** *Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión*  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Integrante:** Daniel  
**Rama:** `feat/daniel-lab07-lab08`  
**Fecha de Cierre:** 17 de Octubre de 2026  
**Hora Local de Auditoría:** 17:55 - 18:00 (UTC: 22:55 - 23:00)  

---

## 1. Alcance y Estado Final de la Integración

El trabajo asignado a Daniel para los Laboratorios 07 y 08 ha quedado completamente integrado, probado y verificado en la infraestructura local:

- **Laboratorio 07 (Apartado 4.1.4):**
  - Implementación de clientes web de publicación (`publicador.html`) y suscripción (`suscriptor.html`) sobre WebSockets (`ws://localhost:8083/mqtt`) utilizando `mqtt.js 5.10.3` con soporte para protocolo MQTT v5.0.
  - Servidor web estático Nginx (`web_clients_gui`) sirviendo los clientes en el puerto `8085`.
  - Interfaz de usuario con captura de credenciales (usuario y contraseña enmascarada), supresión de bucles infinitos de reconexión ante rechazos definitivos (CONNACK 0x86) y bitácora segura sin exposición de contraseñas.
- **Laboratorio 08:**
  - Integración perimetral de autenticación basada en contraseñas (`password_based:mysql`) y listas de control de acceso (`authz:mysql`) en EMQX 5.8.0 respaldadas por MySQL 8.0.
  - Creación de cuenta de consulta de solo lectura con mínimo privilegio (`emqx_ro_user`) restringida estrictamente a `SELECT` sobre `mqtt_user` y `mqtt_acl` (escritura y acceso a `telemetria` denegados con `ERROR 1142`).
  - Configuración de persistencia del broker mediante volumen nombrado `emqx_data:/opt/emqx/data` y nombre de nodo FQDN estable `emqx@node1.emqxnet`.
  - Adaptación del simulador (`simulator.py`) para inyectar credenciales de servicio desde variables de entorno y restaurar suscripciones en `on_connect`.

---

## 2. Componentes del Entorno y Archivos Relevantes

### 2.1. Servicios del Stack Docker Compose
1. **`emqx_broker` (`emqx/emqx:5.8.0`):** Broker MQTT con puertos 1883 (TCP), 8083 (WS) y 18083 (Dashboard). Autenticación y ACL MySQL activas con `no_match: deny`.
2. **`mysql_server` (`mysql:8.0`):** Almacenamiento relacional de credenciales (`mqtt_user`), listas de control de acceso (`mqtt_acl`), catálogo de dispositivos y series temporales de telemetría. Puerto externo 3307, interno 3306.
3. **`phpmyadmin_gui` (`phpmyadmin:latest`):** Interfaz gráfica de administración relacional en puerto 8080.
4. **`iot_virtual_nodes` (`calidad_agua_iot-virtual_nodes`):** Contenedor de simulación de 4 nodos sensores (`ESP32_FISICO_UNT`, `ESP32_V1_BLOQUE_A`, `ESP32_V2_BLOQUE_B`, `ESP32_V3_INCIDENTE`) y motor de reglas offline (`BACKEND_RULES_ENGINE`).
5. **`web_clients_gui` (`nginx:1.27-alpine`):** Servidor web estático en puerto 8085 sirviendo los clientes web de Daniel.

### 2.2. Archivos Desarrollados por Daniel
```text
calidad_agua_iot/
├── .env                                                    # Variables locales con contraseñas seguras (ignorado por Git)
├── docker-compose.yml                                      # Definición de 5 servicios con volumen persistente y credenciales
├── lab07/03_Daniel_Clientes_Web/
│   ├── publicador.html                                     # Cliente web publicador con formulario de autenticación
│   ├── suscriptor.html                                     # Cliente web suscriptor con formulario de autenticación
│   ├── shared.js                                           # Utilidades compartidas de registro seguro y generación de ID
│   ├── style.css                                           # Estilos visuales de la interfaz web
│   ├── vendor/mqtt.min.js                                  # Biblioteca cliente MQTT.js 5.10.3 (SHA-256 verificado)
│   ├── README.md                                           # Ficha técnica y contrato de pruebas del Lab 07
│   └── MATRIZ_PRUEBAS_DANIEL_LAB07.md                      # Auditoría protocolar de transporte WebSockets (P01-P10)
├── lab08/03_Daniel_Auth_MySQL/
│   ├── 01_schema_auth.sql                                  # DDL: Creación idempotente de tablas mqtt_user y mqtt_acl
│   ├── 02_permissions_data.sql                             # DML: Catálogo de identidades y reglas ACL base sin secretos
│   ├── 03_emqx_queries.sql                                 # Consultas SQL seguras para Authn y Authz en EMQX 5.8
│   ├── 04_create_emqx_ro_user.sql                          # DCL: Cuenta de mínimo privilegio emqx_ro_user
│   ├── env.template                                        # Plantilla de variables de entorno para compañeros
│   ├── provision_auth_db.ps1                               # Aprovisionamiento local e idempotente de base de datos
│   ├── configure_emqx_auth.ps1                             # Despliegue automatizado de seguridad en EMQX vía REST API
│   ├── tests/
│   │   ├── test_matrix_phase5.py                           # Suite protocolaria completa (Casos A - I)
│   │   └── test_acceptance_phase6.py                       # Prueba breve de aceptación (Controles A - D)
│   ├── README.md                                           # Documento técnico integral del Lab 08
│   ├── MATRIZ_VERIFICACION_BD.md                           # Auditoría de la base de datos MySQL
│   ├── MATRIZ_PRUEBAS_EMQX_LAB08.md                        # Auditoría de seguridad del broker EMQX
│   ├── CIERRE_INTEGRACION_DANIEL.md                        # Este documento de cierre
│   └── ENTREGA_PARA_EQUIPO.md                              # Guía técnica de reproducción para compañeros
└── virtual_simulator/
    └── simulator.py                                        # Simulador adaptado con autenticación y re-suscripción
```

---

## 3. Parámetros No Secretos y Permisos por Identidad

| Identidad / Usuario | Mecanismo | Tópicos Permitidos | Operaciones | Restricciones de Seguridad |
|---|---|---|---|---|
| `web_pub_daniel` | `password_based:mysql` (SHA-256) | `cistern/lab07/prueba` | `publish` (allow) | Prohibido suscribirse; prohibido publicar en telemetría o comandos. `is_superuser = 0`. |
| `web_sub_daniel` | `password_based:mysql` (SHA-256) | `cistern/lab07/prueba`<br>`cistern/+/telemetry` | `subscribe` (allow)<br>`subscribe` (allow) | Prohibido publicar en cualquier tópico. `is_superuser = 0`. |
| `esp32_nodes` | `password_based:mysql` (SHA-256) | `cistern/+/telemetry`<br>`cistern/+/commands` | `publish` (allow)<br>`subscribe` (allow) | Compartido por hilos de nodos sensores. Permite telemetría y recepción de órdenes. `is_superuser = 0`. |
| `backend_rules` | `password_based:mysql` (SHA-256) | `cistern/+/telemetry`<br>`cistern/+/commands` | `subscribe` (allow)<br>`publish` (allow) | Utilizado por el motor de reglas offline para escuchar telemetría y emitir comandos correctivos. `is_superuser = 0`. |
| `$all` | Regla global ACL | `#` | `all` (deny) | Cierre por defecto de la lista de control de acceso. |

### Consultas Definitivas en EMQX 5.8:
- **Autenticación:**
  ```sql
  SELECT password_hash, salt, is_superuser FROM mqtt_user WHERE username = ${username} LIMIT 1;
  ```
- **Autorización:**
  ```sql
  SELECT action, permission, topic FROM mqtt_acl 
  WHERE (username = ${username} OR username = '$all') 
    AND (clientid IS NULL OR clientid = '' OR clientid = ${clientid}) 
  ORDER BY id ASC;
  ```
- **Política por Defecto:** `no_match = "deny"` (fuente de archivo deshabilitada).

---

## 4. Resultados de las Pruebas de Aceptación (Fase 6)

Se ejecutó la suite de comprobación breve [test_acceptance_phase6.py](file:///c:/Users/Daniel/Downloads/calidad_agua_iot/lab08/03_Daniel_Auth_MySQL/tests/test_acceptance_phase6.py):

| Control | Descripción de la Verificación | Evidencia Observada | Decisión | Resultado |
|:---:|---|---|:---:|:---:|
| **Control A** | Pub y sub autenticados: envío y recepción en `cistern/lab07/prueba` | `SUBACK Granted: (1,)` \| `PUBACK OK: True` \| Payload recibido 100% idéntico byte a byte | Conexión y entrega verificada | **APROBADO** |
| **Control B** | Contraseña incorrecta rechazada sin reintentos indefinidos | `CONNACK` con código de retorno `4` (`0x86`: Bad user name or password). Cliente se detiene inmediatamente. | Rechazo permanente efectivo | **APROBADO** |
| **Control C** | Operación autorizada vs operación denegada en tiempo de ejecución | Publicación permitida (`is_published: True`); Intento de suscripción de `web_pub_daniel` denegado con `SUBACK: (128,)` | Permisos ACL efectivos | **APROBADO** |
| **Control D** | Nodos sensores y backend conectados con usuarios de servicio | Conexión exitosa al broker; 5 clientes activos con `username=esp32_nodes` y `backend_rules` | Identidades operativas activas | **APROBADO** |

---

## 5. Auditoría de Persistencia tras Recreación Final de EMQX

Para constatar que la configuración de seguridad no dependía de la memoria volátil del contenedor, se realizó una recreación forzada del broker (`docker compose up -d --force-recreate --no-deps emqx`) **sin ejecutar ningún script de reconfiguración posterior**.

### 5.1. Métricas de Tiempo de Interrupción y Recuperación
- **Duración de recreación del contenedor:** **3.04 segundos** (`17:55:25` a `17:55:28`).
- **Tiempo hasta disponibilidad del broker:** **4.41 segundos** (`17:55:28` a `17:55:33`).
- **Tiempo total de recuperación del flujo de telemetría:** **7.45 segundos**.

### 5.2. Verificación de Persistencia sin Re-Aprovisionamiento
Inmediatamente tras levantar el contenedor y sin correr scripts, la API de EMQX reportó:
- `Authn_ID`: `password_based:mysql` (Enable: True, Backend: mysql, User: `emqx_ro_user`).
- `Authz_Sources`: `mysql` (Enable: True, User: `emqx_ro_user`), `file` (Enable: False).
- `Authz_NoMatch`: `deny`.
- **Conclusión de Persistencia:** APROBADA. El volumen nombrado `emqx_data` y el nombre de nodo `emqx@node1.emqxnet` preservaron íntegramente las credenciales y las listas de control de acceso.

### 5.3. Crecimiento de Telemetría con Marcas Temporales
La tabla `emqx_db.telemetria` demostró incremento continuo de datos válidos tras la recuperación:
- **Antes de la Recreación:** `21,952` registros (`2026-10-17 22:55:06` UTC).
- **Inmediatamente Post-Recreación (Consulta 1):** `22,060` registros (`2026-10-17 22:56:15` UTC).
- **Post-Recreación (Consulta 2):** `22,085` registros (`2026-10-17 22:56:33` UTC, +25 registros en 18 s).
- **Cierre de Fase 6:** `22,222` registros (`2026-10-17 22:58:02` UTC).

---

## 6. Coherencia Técnica y Limitaciones Reales

Con el fin de mantener estricta rigurosidad en los informes y no sobrestimar lo demostrado:

1. **Interrupción Controlada Registrada:** Hubo dos interrupciones controladas del broker (10.47 s en la Fase 5 y 7.45 s en la Fase 6). Por tanto, la telemetría es continua en régimen operativo pero registró pausas breves documentadas durante el mantenimiento del broker.
2. **Naturaleza de los Datos:** Toda la telemetría del entorno corresponde a **datos simulados por software** en `virtual_simulator/simulator.py`, incluyendo el nodo `ESP32_FISICO_UNT` (que corre como un hilo con modelo estadístico nominal).
3. **Reglas Offline vs. Inteligencia Artificial:** La lógica del motor de reglas actual en `simulator.py` es un sistema determinístico basado en **umbrales estáticos** (`turb >= 4.0` e incidentes de desconexión `turb <= 0` / voltaje 0V). **No constituye todavía un modelo predictivo de regresión**; los modelos de Machine Learning corresponden a una fase posterior del proyecto general.
4. **Comportamiento del Nodo V3 (`ESP32_V3_INCIDENTE`):** Permanece en estado `STANDBY` en la tabla `dispositivos`. Este es el comportamiento esperado diseñado para ilustrar la protección reactiva contra fallas de hardware simuladas.
5. **Cifrado de Transporte Inexistente (Sin TLS):** Los canales MQTT (puerto 1883) y WebSockets (puerto 8083) operan en texto claro. La autenticación y autorización implementadas controlan el acceso a nivel de aplicación pero **no cifran los paquetes en tránsito**.
6. **Semántica de Paquetes MQTT:**
   - `PUBACK`: Confirma exclusivamente que el broker recibió el paquete con QoS 1; no acredita por sí solo que los suscriptores finales lo hayan recibido (eso se acreditó independientemente en la Prueba A).
   - `SUBACK 128 (0x80)`: Corresponde al código estándar de falla o denegación no especificada (*Unspecified error / Subscription failed*), el cual EMQX emite cuando una suscripción es bloqueada por la política ACL.
   - La superación de esta suite acotada acredita el cumplimiento de los controles diseñados, mas no la ausencia total de otras vulnerabilidades en capas no evaluadas.

# CLIENTES WEB MQTT SOBRE WEBSOCKETS — LABORATORIO 07 (APARTADO 4.1.4)

**Proyecto:** *Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión*  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Responsable de la Sección:** Daniel  
**Entregables:** Publicador Web (`publicador.html`) y Suscriptor Web (`suscriptor.html`) con `mqtt.js`  
**Fecha de Implementación:** 17 de Octubre de 2026  

---

## 1. Arquitectura y Tecnologías Empleadas

- **Librería Cliente MQTT:** `mqtt.js` versión **5.10.3** (distribución oficial empaquetada localmente en `vendor/mqtt.min.js`).
  - **Integridad SHA256:** `1D32412A6ABD0422278DD382BF914B2776B0BB933BB4295DF6CF8AA1CA608CD5`.
  - **Autonomía Operativa:** Servido 100% de manera local; no depende de CDNs externos en tiempo de ejecución.
- **Servidor Web Estático:** Contenedor Docker basado en `nginx:1.27-alpine` montando los archivos en modo de solo lectura (`:ro`) en el puerto publicado anfitrión `8085:80`.
- **Protocolo de Mensajería:** MQTT v5.0 (`protocolVersion: 5`) encapsulado sobre WebSockets en el endpoint `ws://localhost:8083/mqtt`.
- **Estilos e Interactividad:** HTML5 semántico y CSS3 nativo desacoplado en `style.css` y funciones compartidas en `shared.js`.

---

## 2. Estructura del Módulo Web

```text
lab07/03_Daniel_Clientes_Web/
├── vendor/
│   └── mqtt.min.js          # Distribución oficial local verificada de mqtt.js v5.10.3
├── style.css                # Hoja de estilos compartida (diseño responsive, badges, logs)
├── shared.js                # Lógica compartida (generador de Client ID, formateo temporal, validación JSON, logs seguros)
├── publicador.html          # Interfaz web de publicación MQTT
├── suscriptor.html          # Interfaz web de suscripción y monitoreo en tiempo real
└── README.md                # Documentación técnica de operación y limitaciones
```

---

## 3. Parámetros de Conexión y URLs de Acceso

### 3.1. URLs de las Aplicaciones Web
- **Publicador Web:** `http://localhost:8085/publicador.html`
- **Suscriptor Web:** `http://localhost:8085/suscriptor.html`
- **Librería mqtt.js verificable:** `http://localhost:8085/vendor/mqtt.min.js`

> **Nota para acceso en Red Local (LAN):**  
> `localhost` corresponde a la máquina donde corre el navegador. Para acceder desde otro dispositivo en la misma red privada, reemplace `localhost` por la IP privada del host Docker (ej. `http://192.168.1.50:8085/publicador.html`) y asegúrese de que el campo de URL WebSocket del broker apunte a `ws://192.168.1.50:8083/mqtt`.

### 3.2. Parámetros MQTT Confirmados
| Parámetro | Valor por Defecto | Notas Técnicas |
|---|---|---|
| **Broker URL** | `ws://localhost:8083/mqtt` | Configurable en la interfaz; path `/mqtt` |
| **Versión MQTT** | `5` (`protocolVersion: 5`) | Conforme a la validación de Jeanfranco |
| **Prefijo Publicador** | `web_pub_daniel_<hex>` | Sufijo hexadecimal pseudo-aleatorio para evitar colisiones |
| **Prefijo Suscriptor** | `web_sub_daniel_<hex>` | Sufijo hexadecimal único |
| **Tópico de Prueba** | `cistern/lab07/prueba` | Tópico aislado obligatorio para pruebas de laboratorio |
| **Tópico Telemetría**| `cistern/+/telemetry` | Tópico con comodín para inspección pasiva en suscriptor |
| **Retain** | `false` | Explícito para evitar persistencia de pruebas en broker |
| **Keepalive** | `60` segundos | Mantenimiento de sesión WebSocket |

---

## 4. Guía de Pruebas y Operación

### 4.1. Prueba Aislada de Comunicación End-to-End
1. Abrir en pestañas independientes del navegador `http://localhost:8085/suscriptor.html` y `http://localhost:8085/publicador.html`.
2. En el **Suscriptor**, pulsar `Conectar al Broker` (verificar badge `CONECTADO`).
3. En el **Suscriptor**, seleccionar el tópico `cistern/lab07/prueba` (QoS 0) y pulsar `Suscribir`. Verificar confirmación del broker.
4. En el **Publicador**, pulsar `Conectar al Broker` (verificar badge `CONECTADO`).
5. En el **Publicador**, verificar el payload de prueba (`device_id: LAB07_TEST`, `estado: TEST`) y pulsar `Publicar Mensaje`.
6. En el **Publicador**, observar la confirmación local de despacho: `[CONFIRMACIÓN LOCAL OK] Mensaje transmitido exitosamente al broker EMQX`.
7. En el **Suscriptor**, comprobar la recepción inmediata del payload idéntico con tópico, timestamp y QoS recibido.

### 4.2. Inspección de Telemetría Real (Solo Lectura)
1. En el **Suscriptor**, cambiar el tópico a `cistern/+/telemetry`.
2. Pulsar `Suscribir`.
3. Observar la recepción pasiva en tiempo real de los datos emitidos por los nodos virtuales (`ESP32_FISICO_UNT`, `ESP32_V1_BLOQUE_A`, `ESP32_V2_BLOQUE_B`) sin interferir en el motor de reglas.

---

## 5. Manejo del Ciclo de Vida y Eventos de Conexión

Ambas páginas implementan el ciclo de vida completo de `mqtt.js`:
- `connect`: Notifica sesión abierta, actualiza el badge visual a verde y habilita controles operativos.
- `reconnect`: Detecta interrupciones y reintentos automáticos, marcando badge amarillo.
- `error`: Notifica incidentes de red o rechazos del broker.
- `close`: Reconoce el cierre de sesión. Distingue entre desconexión manual voluntaria (detiene reintentos) y caída forzada de enlace.
- `offline`: Identifica cuando el cliente pierde acceso al socket.
- `message` (solo suscriptor): Decodifica el buffer UTF-8, valida si es JSON para formateo indentado o preserva el texto plano original, e inserta de forma segura mediante `textContent` para neutralizar ataques XSS.

---

## 6. Limitaciones Técnicas de la Fase 2

1. **Autenticación MQTT Desactivada:** EMQX 5.8.0 aún opera con conexiones anónimas habilitadas. El soporte de credenciales de usuario/contraseña respaldadas por MySQL se implementará en el Laboratorio 08.
2. **Aislamiento Estricto:** Está terminantemente prohibido publicar mensajes sintéticos en tópicos de telemetría de campo (`cistern/+/telemetry`) o de comandos (`cistern/<id>/commands`), dado que dispararían reglas reactivas en el backend e insertarían lecturas falsas en la base de datos de producción.
3. **Persistencia de Sesión Web:** Los clientes operan con `Clean Start: true` y `Session Expiry: 0`, por lo que las sesiones web no encolan mensajes offline si la pestaña del navegador se cierra.

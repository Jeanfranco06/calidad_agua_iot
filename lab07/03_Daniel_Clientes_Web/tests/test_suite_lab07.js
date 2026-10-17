/**
 * Suite de Pruebas de Protocolo y Transporte MQTT v5 sobre WebSockets (Lab 07)
 * Ejecución: node test_suite_lab07.js
 * Requiere: dependencia 'mqtt' instalada (npm install mqtt) y stack Docker activo
 */

const mqtt = require("mqtt");
const { spawnSync } = require("child_process");

const BROKER_URL = process.env.BROKER_URL || "ws://localhost:8083/mqtt";
const TEST_TOPIC = "cistern/lab07/prueba";
const TELEMETRY_TOPIC = "cistern/+/telemetry";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEmqxClients() {
  const res = spawnSync("docker", ["exec", "emqx_broker", "emqx", "ctl", "clients", "list"], { encoding: "utf-8" });
  return (res.stdout || "") + (res.stderr || "");
}

// Validación sintáctica de JSON (idéntica a shared.js)
function validateJson(str) {
  try {
    const parsed = JSON.parse(str);
    return { valid: true, parsed, error: null };
  } catch (err) {
    return { valid: false, parsed: null, error: err.message };
  }
}

async function runSuite() {
  console.log("=== SUITE DE AUDITORÍA DE PROTOCOLO MQTT (LAB 07) ===\n");
  const results = {};

  // P01: Conexión independiente
  console.log("[P01] Conexión independiente de dos clientes...");
  const subId = `web_sub_daniel_${Math.random().toString(16).substring(2, 8)}`;
  const pubId = `web_pub_daniel_${Math.random().toString(16).substring(2, 8)}`;

  const subClient = mqtt.connect(BROKER_URL, {
    clientId: subId,
    protocolVersion: 5,
    clean: true,
    keepalive: 60,
    reconnectPeriod: 3000
  });

  const pubClient = mqtt.connect(BROKER_URL, {
    clientId: pubId,
    protocolVersion: 5,
    clean: true,
    keepalive: 60,
    reconnectPeriod: 3000
  });

  await Promise.all([
    new Promise((resolve) => subClient.once("connect", resolve)),
    new Promise((resolve) => pubClient.once("connect", resolve))
  ]);

  const emqxList = getEmqxClients();
  results.P01 = {
    subId,
    pubId,
    subInEmqx: emqxList.includes(subId),
    pubInEmqx: emqxList.includes(pubId),
    status: emqxList.includes(subId) && emqxList.includes(pubId) ? "APROBADA" : "FALLIDA"
  };

  // P02: Envío y recepción QoS 0
  console.log("[P02] Publicación y recepción con QoS 0...");
  let p02Received = null;
  await new Promise((resolve) => subClient.subscribe(TEST_TOPIC, { qos: 0 }, resolve));

  subClient.on("message", (topic, payload, packet) => {
    if (topic === TEST_TOPIC) {
      try {
        const parsed = JSON.parse(payload.toString());
        if (parsed.test_id === "TEST_P02_QOS0_SUITE") {
          p02Received = { topic, payload: parsed, qos: packet.qos };
        }
      } catch (e) {}
    }
  });

  const p02Payload = {
    test_id: "TEST_P02_QOS0_SUITE",
    device_id: "LAB07_TEST",
    mensaje: "Prueba QoS 0",
    estado: "TEST"
  };

  await new Promise((resolve) => {
    pubClient.publish(TEST_TOPIC, JSON.stringify(p02Payload), { qos: 0, retain: false }, resolve);
  });
  await sleep(1000);

  results.P02 = {
    received: !!p02Received,
    qos: p02Received ? p02Received.qos : null,
    status: p02Received && p02Received.qos === 0 ? "APROBADA" : "FALLIDA"
  };

  // P03: QoS 1 con PUBACK
  console.log("[P03] Publicación y recepción con QoS 1 (PUBACK)...");
  let p03Received = null;
  let p03Puback = null;

  pubClient.on("packetreceive", (packet) => {
    if (packet.cmd === "puback") p03Puback = packet;
  });

  const p03Granted = await new Promise((resolve) => {
    subClient.subscribe(TEST_TOPIC, { qos: 1 }, (err, granted) => resolve(granted));
  });

  subClient.on("message", (topic, payload, packet) => {
    if (topic === TEST_TOPIC) {
      try {
        const parsed = JSON.parse(payload.toString());
        if (parsed.test_id === "TEST_P03_QOS1_SUITE") {
          p03Received = { topic, payload: parsed, qos: packet.qos };
        }
      } catch (e) {}
    }
  });

  const p03Payload = {
    test_id: "TEST_P03_QOS1_SUITE",
    device_id: "LAB07_TEST",
    mensaje: "Prueba QoS 1 con acuse",
    estado: "TEST"
  };

  await new Promise((resolve) => {
    pubClient.publish(TEST_TOPIC, JSON.stringify(p03Payload), { qos: 1, retain: false }, resolve);
  });
  await sleep(1000);

  results.P03 = {
    grantedQos: p03Granted && p03Granted.length > 0 ? p03Granted[0].qos : null,
    pubackMessageId: p03Puback ? p03Puback.messageId : null,
    receivedQos: p03Received ? p03Received.qos : null,
    status: p03Received && p03Received.qos === 1 && p03Puback ? "APROBADA" : "FALLIDA"
  };

  // P04: Validación sintáctica JSON
  console.log("[P04] Validación sintáctica previa de JSON...");
  const invalidJson = '{ "test_id": "TEST_P04", "valor": }';
  const val = validateJson(invalidJson);
  results.P04 = {
    validationBlocked: !val.valid,
    errorDetected: val.error !== null,
    status: !val.valid ? "APROBADA" : "FALLIDA"
  };

  // P05: Cancelación de suscripción
  console.log("[P05] Revocación de suscripción (unsubscribe)...");
  await new Promise((resolve) => subClient.unsubscribe(TEST_TOPIC, resolve));
  await sleep(500);

  let p05Suppressed = true;
  const p05Listener = (topic, payload) => {
    if (payload.toString().includes("TEST_P05_UNSUB")) p05Suppressed = false;
  };
  subClient.on("message", p05Listener);

  await new Promise((resolve) => {
    pubClient.publish(TEST_TOPIC, JSON.stringify({ test_id: "TEST_P05_UNSUB" }), { qos: 0 }, resolve);
  });
  await sleep(2500);
  subClient.removeListener("message", p05Listener);

  results.P05 = {
    messageSuppressedDuringUnsub: p05Suppressed,
    status: p05Suppressed ? "APROBADA" : "FALLIDA"
  };

  // P07: Fallo y recuperación de transporte
  console.log("[P07] Fallo de socket y re-suscripción automática...");
  let p07Reconnected = false;
  let p07PostRecoveryMsg = false;

  subClient.once("connect", () => {
    p07Reconnected = true;
    subClient.subscribe(TEST_TOPIC, { qos: 0 });
  });

  subClient.stream.destroy(new Error("Corte simulado"));
  await sleep(5000);

  subClient.on("message", (topic, payload) => {
    if (payload.toString().includes("TEST_P07_RECOVERY")) p07PostRecoveryMsg = true;
  });

  await new Promise((resolve) => {
    pubClient.publish(TEST_TOPIC, JSON.stringify({ test_id: "TEST_P07_RECOVERY" }), { qos: 0 }, resolve);
  });
  await sleep(1000);

  results.P07 = {
    reconnected: p07Reconnected,
    recoveredMessageReceived: p07PostRecoveryMsg,
    status: p07Reconnected && p07PostRecoveryMsg ? "APROBADA" : "FALLIDA"
  };

  // P09: Telemetría de simulador
  console.log("[P09] Captura de telemetría pasiva...");
  let telemetryCount = 0;
  const teleListener = (t, p) => {
    if (t.endsWith("/telemetry")) telemetryCount++;
  };
  subClient.on("message", teleListener);
  await new Promise((resolve) => subClient.subscribe(TELEMETRY_TOPIC, { qos: 0 }, resolve));
  await sleep(4000);
  subClient.unsubscribe(TELEMETRY_TOPIC);
  subClient.removeListener("message", teleListener);

  results.P09 = {
    telemetrySamples: telemetryCount,
    status: telemetryCount > 0 ? "APROBADA" : "FALLIDA"
  };

  // P06: Desconexión manual
  console.log("[P06] Desconexión voluntaria y verificación en EMQX...");
  await new Promise((resolve) => subClient.end(true, resolve));
  await new Promise((resolve) => pubClient.end(true, resolve));
  await sleep(1500);

  const emqxAfterClose = getEmqxClients();
  results.P06 = {
    sessionsRemoved: !emqxAfterClose.includes(subId) && !emqxAfterClose.includes(pubId),
    status: !emqxAfterClose.includes(subId) && !emqxAfterClose.includes(pubId) ? "APROBADA" : "FALLIDA"
  };

  console.log("\n=== RESULTADOS FINALES DE LA SUITE ===");
  console.log(JSON.stringify(results, null, 2));
}

runSuite().catch(console.error);

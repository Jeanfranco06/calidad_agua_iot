/**
 * Cliente MQTT 3.1.1 mínimo sobre WebSocket nativo (sin dependencias).
 * Solo implementa lo que necesita el monitor: CONNECT, SUBSCRIBE, PUBLISH
 * entrante (QoS 0/1), PINGREQ y DISCONNECT. Funciona igual en React Native
 * (Hermes) y en Node >= 22 (para pruebas).
 */

export type LinkStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface MqttLiteOptions {
  url: string;
  username: string;
  password: string;
  topic: string;
  keepAliveSec?: number;
  connectTimeoutMs?: number;
  retryMs?: number;
  onStatus: (s: LinkStatus) => void;
  onLog: (text: string, level: 'info' | 'success' | 'warn' | 'error') => void;
  onMessage: (topic: string, payload: string) => void;
}

export interface MqttLiteHandle {
  close: () => void;
}

// ---------------------------------------------------------------- utilidades
function utf8Encode(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else {
      cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    }
    if (cp > 0xffff) {
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    } else {
      s += String.fromCharCode(cp);
    }
  }
  return s;
}

const lenPrefixed = (str: string): number[] => {
  const b = utf8Encode(str);
  return [b.length >> 8, b.length & 255, ...b];
};

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return out;
}

const packet = (firstByte: number, body: number[]): ArrayBuffer =>
  new Uint8Array([firstByte, ...remainingLength(body.length), ...body]).buffer as ArrayBuffer;

const CONNACK_TEXT: Record<number, string> = {
  1: 'versión de protocolo no aceptada',
  2: 'identificador de cliente rechazado',
  3: 'servidor no disponible',
  4: 'usuario o contraseña incorrectos',
  5: 'no autorizado',
};

// ------------------------------------------------------------------- cliente
export function connectMqtt(opts: MqttLiteOptions): MqttLiteHandle {
  const keepAlive = opts.keepAliveSec ?? 30;
  const connectTimeout = opts.connectTimeoutMs ?? 8000;
  const retryMs = opts.retryMs ?? 3000;
  const clientId = `turbisense_${Math.random().toString(16).slice(2, 10)}`;

  let ws: WebSocket | null = null;
  let stopped = false;
  let everConnected = false;
  let failed = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let buffer = new Uint8Array(0);
  let packetId = 1;

  const clearTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    pingTimer = timeoutTimer = null;
  };

  const send = (data: ArrayBuffer) => {
    try {
      ws?.send(data);
    } catch (e: any) {
      opts.onLog(`No se pudo enviar: ${e?.message ?? e}`, 'warn');
    }
  };

  const scheduleRetry = (reason: string) => {
    if (stopped) return;
    opts.onStatus('reconnecting');
    opts.onLog(`${reason}. Reintentando en ${Math.round(retryMs / 1000)} s…`, 'warn');
    retryTimer = setTimeout(open, retryMs);
  };

  function handlePacket(first: number, body: Uint8Array) {
    const type = first >> 4;
    if (type === 2) {
      // CONNACK
      const rc = body[1];
      if (rc === 0) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = null;
        everConnected = true;
        opts.onStatus('connected');
        opts.onLog('Sesión MQTT autenticada por EMQX', 'success');
        const id = packetId++;
        send(
          packet(0x82, [id >> 8, id & 255, ...lenPrefixed(opts.topic), 0]),
        );
        pingTimer = setInterval(() => send(packet(0xc0, [])), keepAlive * 1000 * 0.8);
      } else {
        opts.onLog(`Broker rechazó la conexión: ${CONNACK_TEXT[rc] ?? 'código ' + rc}`, 'error');
        opts.onStatus('error');
        failed = true;
        stopped = true; // credenciales malas: no insistir
        ws?.close();
      }
    } else if (type === 9) {
      const granted = body[2];
      if (granted === 0x80) opts.onLog(`Suscripción denegada a ${opts.topic} (ACL)`, 'error');
      else opts.onLog(`Suscrito a ${opts.topic}`, 'success');
    } else if (type === 3) {
      const qos = (first >> 1) & 3;
      const tlen = (body[0] << 8) | body[1];
      const topic = utf8Decode(body.subarray(2, 2 + tlen));
      let off = 2 + tlen;
      if (qos > 0) {
        const id = (body[off] << 8) | body[off + 1];
        off += 2;
        if (qos === 1) send(packet(0x40, [id >> 8, id & 255]));
      }
      try {
        opts.onMessage(topic, utf8Decode(body.subarray(off)));
      } catch (e: any) {
        opts.onLog(`Error procesando trama: ${e?.message ?? e}`, 'warn');
      }
    }
  }

  function onData(chunk: Uint8Array) {
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer, 0);
    merged.set(chunk, buffer.length);
    buffer = merged;
    for (;;) {
      if (buffer.length < 2) return;
      let mult = 1;
      let len = 0;
      let i = 1;
      let b: number;
      do {
        if (i >= buffer.length) return;
        b = buffer[i++];
        len += (b & 127) * mult;
        mult *= 128;
      } while (b & 128);
      if (buffer.length < i + len) return;
      const first = buffer[0];
      const body = buffer.slice(i, i + len);
      buffer = buffer.slice(i + len);
      handlePacket(first, body);
    }
  }

  function open() {
    if (stopped) return;
    clearTimers();
    buffer = new Uint8Array(0);
    opts.onStatus(everConnected ? 'reconnecting' : 'connecting');
    opts.onLog(`Abriendo WebSocket ${opts.url}`, 'info');

    let sock: WebSocket;
    try {
      sock = new WebSocket(opts.url, ['mqtt']);
    } catch (e: any) {
      opts.onLog(`URL inválida: ${e?.message ?? e}`, 'error');
      opts.onStatus('error');
      return;
    }
    ws = sock;
    (sock as any).binaryType = 'arraybuffer';

    timeoutTimer = setTimeout(() => {
      opts.onLog(
        'Sin respuesta del broker en 8 s. Revisa que el teléfono esté en la misma Wi-Fi y que el puerto 8084 esté abierto en el firewall del PC.',
        'error',
      );
      try {
        sock.close();
      } catch {}
    }, connectTimeout);

    sock.onopen = () => {
      const body = [
        ...lenPrefixed('MQTT'),
        4, // nivel 3.1.1
        0xc2, // usuario + contraseña + clean session
        keepAlive >> 8,
        keepAlive & 255,
        ...lenPrefixed(clientId),
        ...lenPrefixed(opts.username),
        ...lenPrefixed(opts.password),
      ];
      send(packet(0x10, body));
    };
    sock.onmessage = (ev: any) => {
      const d = ev.data;
      if (d instanceof ArrayBuffer) onData(new Uint8Array(d));
      else if (typeof d !== 'string') onData(new Uint8Array(d as ArrayBufferLike));
    };
    sock.onerror = (ev: any) => {
      opts.onLog(`Error de socket${ev?.message ? ': ' + ev.message : ''}`, 'error');
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      clearTimers();
      if (stopped) {
        opts.onStatus(failed ? 'error' : 'idle');
        return;
      }
      scheduleRetry(everConnected ? 'Enlace perdido' : 'No se pudo abrir el enlace');
    };
  }

  open();

  return {
    close: () => {
      stopped = true;
      clearTimers();
      if (retryTimer) clearTimeout(retryTimer);
      try {
        if (ws && ws.readyState === 1) ws.send(packet(0xe0, []));
        ws?.close();
      } catch {}
      ws = null;
      opts.onStatus('idle');
    },
  };
}

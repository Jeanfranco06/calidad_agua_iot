import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';
import {connectMqtt, LinkStatus, MqttLiteHandle} from './src/mqttLite';
import {Palette, resolvePalette, ThemeMode} from './src/theme';

// ============================================================================
// Modelo de datos
// ============================================================================
interface Reading {
  adc: number;
  volt: number | null;
  temp: number | null;
  deltaSec: number | null;
  at: number;
}

interface NodeData {
  id: string;
  location: string;
  physical: boolean;
  adc: number;
  adcDerived: boolean;
  voltage: number | null;
  sensorVoltage: number | null;
  temperature: number | null;
  health: string;
  ntpSynced: boolean | null;
  trend: number;
  minAdc: number;
  maxAdc: number;
  packetCount: number;
  gapsDetected: number;
  lastDeltaSec: number | null;
  avgDeltaSec: number | null;
  lastSeen: number;
  history: Reading[];
  raw: unknown;
}

interface LogLine {
  id: number;
  time: string;
  text: string;
  level: 'info' | 'success' | 'warn' | 'error';
}

type Tab = 'resumen' | 'nodos' | 'registro' | 'ajustes';
type ScopeFilter = 'auto' | 'physical' | 'all';

const TOPIC = 'cistern/+/telemetry';
const DEFAULTS = {
  broker: 'ws://192.168.18.10:8084/mqtt',
  local: 'ws://127.0.0.1:8084/mqtt',
  user: 'mobile_monitor',
  pass: 'Nu2eYr2W2tKbm92URpcB!2026',
};

// Valores de referencia obtenidos en el estudio experimental (cuentas ADC de 12 bits, GPIO 34).
const STUDY = {
  s1: 2133,
  s2: 1882,
  s3: 1897,
  ridgeRmse: 167.43,
  persistenceRmse: 185.59,
  ridgeR2: 0.683,
};

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const formatDuration = (sec: number): string => {
  if (sec < 60) return `${Math.max(0, Math.floor(sec))} s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m} min ${pad(s)} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${pad(m % 60)} min`;
};

const describeSignal = (
  adc: number,
): {label: string; detail: string; tone: 'primary' | 'warn' | 'soft'} => {
  if (adc >= 2050) {
    return {
      label: 'Cercana a la línea base S1 (agua limpia)',
      detail:
        'Alta transmisión óptica en el fototransistor TS-300B. El paso de luz infrarroja presenta baja atenuación por partículas.',
      tone: 'primary',
    };
  }
  if (adc >= 1700) {
    return {
      label: 'Cercana al régimen S2 (con sedimento)',
      detail:
        'Disminución de cuentas ADC por dispersión y absorción del haz óptico ante partículas en suspensión.',
      tone: 'warn',
    };
  }
  return {
    label: 'Fuera del rango experimental (S1–S2)',
    detail:
      'Lectura alejada del rango 1700–2300 cuentas del estudio. En un nodo físico puede indicar alta atenuación, sonda desconectada o divisor resistivo distinto.',
    tone: 'soft',
  };
};

const translateHealth = (h: string): {text: string; ok: boolean} => {
  const code = h.toUpperCase();
  if (code === 'OK') return {text: 'Operativo (OK)', ok: true};
  if (code.includes('DISCONNECTED')) return {text: 'Sonda desconectada o atenuación extrema', ok: false};
  if (code.includes('SHORT')) return {text: 'Cortocircuito o lectura nula (0 V)', ok: false};
  if (code.includes('STANDBY')) return {text: 'En espera (Standby por regla backend)', ok: false};
  return {text: h, ok: false};
};

const describeFreshness = (
  lastSeen: number,
  nowMs: number,
): {label: string; ageSec: number; tone: 'good' | 'warn' | 'bad'} => {
  const ageSec = Math.max(0, Math.round((nowMs - lastSeen) / 1000));
  if (ageSec <= 8) return {label: `Al día · hace ${ageSec} s`, ageSec, tone: 'good'};
  if (ageSec <= 16) return {label: `Retraso · hace ${ageSec} s`, ageSec, tone: 'warn'};
  return {label: `Sin tramas recientes · hace ${ageSec} s`, ageSec, tone: 'bad'};
};

const STATUS_TEXT: Record<LinkStatus, string> = {
  idle: 'Sin enlace',
  connecting: 'Conectando',
  connected: 'En línea',
  reconnecting: 'Reintentando',
  error: 'Error',
};

// ============================================================================
// Componentes visuales
// ============================================================================
function Bars({
  values,
  color,
  track,
  height = 36,
}: {
  values: number[];
  color: string;
  track: string;
  height?: number;
}) {
  if (values.length < 2) {
    return <View style={{height, borderRadius: 6, backgroundColor: track}} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 40);
  return (
    <View style={{height, flexDirection: 'row', alignItems: 'flex-end', gap: 2}}>
      {values.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: Math.max(3, ((v - min) / span) * (height - 3) + 3),
            borderRadius: 2,
            backgroundColor: color,
            opacity: 0.35 + 0.65 * ((i + 1) / values.length),
          }}
        />
      ))}
    </View>
  );
}

function ReferenceScale({adc, p}: {adc: number | null; p: Palette}) {
  // Escala enfocada en la ventana experimental 1500 – 2400 cuentas con S2 y S1 marcadas.
  const lo = 1500;
  const hi = 2400;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%` as const;
  return (
    <View style={{marginTop: 18}}>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6}}>
        <Text style={{fontSize: 11, color: p.inkFaint}}>Mayor turbidez (menos luz)</Text>
        <Text style={{fontSize: 11, color: p.inkFaint}}>Agua más clara (más luz)</Text>
      </View>
      <View style={{height: 8, borderRadius: 4, backgroundColor: p.surfaceAlt}}>
        <View
          style={{
            position: 'absolute',
            left: pos(STUDY.s2),
            top: -3,
            width: 2,
            height: 14,
            backgroundColor: p.warn,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: pos(STUDY.s1),
            top: -3,
            width: 2,
            height: 14,
            backgroundColor: p.primary,
          }}
        />
        {adc !== null && (
          <View
            style={{
              position: 'absolute',
              left: pos(adc),
              top: -4,
              marginLeft: -8,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: p.ink,
              borderWidth: 3,
              borderColor: p.surface,
            }}
          />
        )}
      </View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10}}>
        <Text style={{fontSize: 11, fontWeight: '600', color: p.warn}}>
          S2 sedimento · {STUDY.s2} ADC
        </Text>
        <Text style={{fontSize: 11, fontWeight: '600', color: p.primary}}>
          S1 agua limpia · {STUDY.s1} ADC
        </Text>
      </View>
    </View>
  );
}

// ============================================================================
// Aplicación principal
// ============================================================================
function Main() {
  const system = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('light');
  const p = useMemo(() => resolvePalette(mode, system), [mode, system]);
  const s = useMemo(() => makeStyles(p), [p]);
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('resumen');
  const [scope, setScope] = useState<ScopeFilter>('auto');
  const [url, setUrl] = useState(DEFAULTS.broker);
  const [user, setUser] = useState(DEFAULTS.user);
  const [pass, setPass] = useState(DEFAULTS.pass);
  const [showPass, setShowPass] = useState(false);

  const [status, setStatus] = useState<LinkStatus>('idle');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [nodes, setNodes] = useState<Record<string, NodeData>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [mix, setMix] = useState<number[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [total, setTotal] = useState(0);
  const [totalGaps, setTotalGaps] = useState(0);
  const [rate, setRate] = useState(0);

  const handle = useRef<MqttLiteHandle | null>(null);
  const counter = useRef(0);
  const logId = useRef(0);

  const log = useCallback((text: string, level: LogLine['level'] = 'info') => {
    logId.current += 1;
    const line = {id: logId.current, time: clock(Date.now()), text, level};
    setLogs(prev => [line, ...prev].slice(0, 100));
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setRate(counter.current);
      counter.current = 0;
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => handle.current?.close(), []);

  const onMessage = useCallback(
    (topic: string, payload: string) => {
      const raw = JSON.parse(payload);
      const now = Date.now();
      const id = String(raw.device_id || topic.split('/')[1] || 'nodo');
      const m = raw.metrics || {};

      const volt =
        typeof m.pin_voltage_v === 'number'
          ? m.pin_voltage_v
          : typeof m.sensor_voltage === 'number'
          ? m.sensor_voltage
          : null;
      const sensorVolt =
        typeof m.sensor_voltage_v === 'number'
          ? m.sensor_voltage_v
          : volt !== null
          ? Number((volt * 2).toFixed(3))
          : null;

      let adc: number;
      let derived = false;
      if (typeof m.adc_raw === 'number') {
        adc = m.adc_raw;
      } else if (volt !== null) {
        adc = Math.round((volt / 3.3) * 4095);
        derived = true;
      } else {
        return;
      }
      adc = Math.max(0, Math.min(4095, adc));

      const temp = typeof m.temperature_c === 'number' ? m.temperature_c : null;
      const origin = String(raw.origin || '').toUpperCase();
      const physical =
        origin.includes('FISICO') ||
        origin.includes('PHYSICAL') ||
        id.toUpperCase().includes('FISICO') ||
        typeof m.adc_raw === 'number';
      const ntpSynced = typeof raw.timestamp_synced === 'boolean' ? raw.timestamp_synced : null;

      counter.current += 1;
      setTotal(v => v + 1);
      setMix(prev => [...prev, adc].slice(-36));

      setNodes(prev => {
        const old = prev[id];
        let deltaSec: number | null = null;
        let avgDelta = old?.avgDeltaSec ?? null;
        let missedInGap = 0;

        if (old) {
          deltaSec = Math.max(0.1, Number(((now - old.lastSeen) / 1000).toFixed(1)));
          const expected = old.avgDeltaSec ?? (physical ? 4.5 : 3.5);
          if (deltaSec > Math.max(10, expected * 2.2)) {
            missedInGap = Math.max(1, Math.round(deltaSec / expected) - 1);
          } else if (deltaSec >= 0.8 && deltaSec <= 12) {
            avgDelta = old.avgDeltaSec
              ? Number((0.7 * old.avgDeltaSec + 0.3 * deltaSec).toFixed(1))
              : deltaSec;
          }
        }

        if (missedInGap > 0) {
          setTotalGaps(g => g + missedInGap);
          log(
            `Salto temporal en ${id}: ${deltaSec?.toFixed(1)} s sin tramas (~${missedInGap} muestra${
              missedInGap > 1 ? 's' : ''
            } no recibida${missedInGap > 1 ? 's' : ''} en la APK)`,
            'warn',
          );
        }

        const history = [
          ...(old?.history ?? []),
          {adc, volt, temp, deltaSec, at: now},
        ].slice(-30);
        const trend = old ? old.trend + 0.3 * (adc - old.trend) : adc;
        const minAdc = old ? Math.min(old.minAdc, adc) : adc;
        const maxAdc = old ? Math.max(old.maxAdc, adc) : adc;

        return {
          ...prev,
          [id]: {
            id,
            location: String(raw.location || '—').replace(/_/g, ' '),
            physical,
            adc,
            adcDerived: derived,
            voltage: volt,
            sensorVoltage: sensorVolt,
            temperature: temp,
            health: String(raw.hardware_health || 'OK'),
            ntpSynced,
            trend,
            minAdc,
            maxAdc,
            packetCount: (old?.packetCount ?? 0) + 1,
            gapsDetected: (old?.gapsDetected ?? 0) + missedInGap,
            lastDeltaSec: deltaSec,
            avgDeltaSec: avgDelta,
            lastSeen: now,
            history,
            raw,
          },
        };
      });
    },
    [log],
  );

  const connect = useCallback(
    (target?: string) => {
      handle.current?.close();
      const finalUrl = (target ?? url).trim();
      if (!/^wss?:\/\//i.test(finalUrl)) {
        log('La dirección debe empezar con ws:// o wss://', 'error');
        setStatus('error');
        return;
      }
      if (target) setUrl(target);
      setConnectedAt(null);
      handle.current = connectMqtt({
        url: finalUrl,
        username: user.trim(),
        password: pass,
        topic: TOPIC,
        onStatus: st => {
          setStatus(st);
          if (st === 'connected') setConnectedAt(Date.now());
        },
        onLog: log,
        onMessage: (t, pl) => {
          try {
            onMessage(t, pl);
          } catch (e: any) {
            log(`Trama descartada: ${e?.message ?? e}`, 'warn');
          }
        },
      });
    },
    [url, user, pass, log, onMessage],
  );

  const disconnect = useCallback(() => {
    handle.current?.close();
    handle.current = null;
    setConnectedAt(null);
    log('Enlace cerrado manualmente', 'info');
  }, [log]);

  // Ordenar poniendo primero los nodos físicos y luego los virtuales.
  const list = useMemo(
    () =>
      Object.values(nodes).sort((a, b) => {
        if (a.physical !== b.physical) return a.physical ? -1 : 1;
        return a.id.localeCompare(b.id);
      }),
    [nodes],
  );

  const physicalList = useMemo(() => list.filter(n => n.physical), [list]);
  const hasPhysical = physicalList.length > 0;

  // Nodos activos para las métricas principales de Resumen según el selector.
  const activeNodes = useMemo(() => {
    if (scope === 'physical') return physicalList;
    if (scope === 'auto' && hasPhysical) return physicalList;
    return list;
  }, [scope, physicalList, hasPhysical, list]);

  const activeHistoryValues = useMemo(() => {
    if (activeNodes.length === 1) {
      return activeNodes[0].history.map(h => h.adc);
    }
    return mix;
  }, [activeNodes, mix]);

  const avg = useMemo(() => {
    if (!activeNodes.length) return null;
    const mean = (f: (n: NodeData) => number | null) => {
      const v = activeNodes.map(f).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const minAdc = Math.min(...activeNodes.map(n => n.minAdc));
    const maxAdc = Math.max(...activeNodes.map(n => n.maxAdc));
    return {
      adc: Math.round(activeNodes.reduce((a, n) => a + n.adc, 0) / activeNodes.length),
      volt: mean(n => n.voltage),
      sensorVolt: mean(n => n.sensorVoltage),
      temp: mean(n => n.temperature),
      trend: Math.round(activeNodes.reduce((a, n) => a + n.trend, 0) / activeNodes.length),
      minAdc,
      maxAdc,
      deltaSec: mean(n => n.lastDeltaSec),
    };
  }, [activeNodes]);

  const continuityPct = useMemo(() => {
    if (total === 0) return null;
    return ((total / (total + totalGaps)) * 100).toFixed(totalGaps === 0 ? 0 : 1);
  }, [total, totalGaps]);

  const online = status === 'connected';
  const busy = status === 'connecting' || status === 'reconnecting';
  const selectedNode = selected ? nodes[selected] : null;
  const sessionSec = connectedAt && online ? Math.max(0, (nowMs - connectedAt) / 1000) : 0;

  const tone = (t: 'primary' | 'warn' | 'soft') =>
    t === 'primary' ? p.primary : t === 'warn' ? p.warn : p.inkSoft;
  const freshColor = (t: 'good' | 'warn' | 'bad') =>
    t === 'good' ? p.good : t === 'warn' ? p.warn : p.bad;

  // --------------------------------------------------------------- Resumen
  const Resumen = (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      {!online && (
        <View style={s.card}>
          <Text style={s.eyebrow}>Enlace con el broker</Text>
          <Text style={s.cardTitle}>{busy ? 'Estableciendo conexión…' : 'Sin conexión activa'}</Text>
          <Text style={s.body}>
            Conecta con el broker EMQX mediante la cuenta de lectura{' '}
            <Text style={s.strong}>{user}</Text> para recibir la telemetría de{' '}
            <Text style={s.mono}>{TOPIC}</Text>.
          </Text>
          <Text style={[s.mono, {marginTop: 8, color: p.inkSoft}]}>{url}</Text>
          <Pressable style={[s.btn, busy && s.btnDisabled]} disabled={busy} onPress={() => connect()}>
            {busy ? <ActivityIndicator color={p.onPrimary} /> : <Text style={s.btnText}>Conectar ahora</Text>}
          </Pressable>
          {status === 'error' || status === 'reconnecting' ? (
            <Text style={[s.small, {marginTop: 10, color: p.bad}]}>
              Si no logra enlazar, consulta la pestaña Registro para ver el diagnóstico o verifica la IP en Ajustes.
            </Text>
          ) : null}
        </View>
      )}

      {/* Selector de fuente cuando hay nodos conectados */}
      {list.length > 0 && (
        <View style={s.card}>
          <View style={s.spread}>
            <View style={{flex: 1, paddingRight: 8}}>
              <Text style={s.eyebrow}>Fuente mostrada en resumen</Text>
              <Text style={s.small}>
                {hasPhysical
                  ? 'Se prioriza automáticamente tu ESP32 físico al detectar sus tramas.'
                  : 'Mostrando nodos virtuales de prueba. Al encender tu ESP32 físico, pasará al frente.'}
              </Text>
            </View>
            <View style={[s.badge, {backgroundColor: hasPhysical ? p.goodSoft : p.surfaceAlt}]}>
              <Text style={[s.badgeText, {color: hasPhysical ? p.good : p.inkSoft}]}>
                {hasPhysical ? `${physicalList.length} físico` : `${list.length} virtual`}
              </Text>
            </View>
          </View>
          <View style={[s.segment, {marginTop: 10}]}>
            {(
              [
                {k: 'auto', label: hasPhysical ? 'Priorizar ESP32' : 'Automático'},
                {k: 'physical', label: 'Solo ESP32 físico'},
                {k: 'all', label: `Todos (${list.length})`},
              ] as {k: ScopeFilter; label: string}[]
            ).map(item => (
              <Pressable
                key={item.k}
                style={[s.segItem, scope === item.k && s.segItemOn]}
                onPress={() => setScope(item.k)}>
                <Text style={[s.segText, scope === item.k && s.segTextOn]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Tarjeta principal de señal óptica */}
      <View style={s.card}>
        <View style={s.spread}>
          <Text style={s.eyebrow}>
            {activeNodes.length === 1
              ? `Señal óptica · ${activeNodes[0].id}`
              : 'Señal óptica · sensor TS-300B'}
          </Text>
          {activeNodes.length === 1 && (
            <Text
              style={[
                s.small,
                {color: freshColor(describeFreshness(activeNodes[0].lastSeen, nowMs).tone), fontWeight: '600'},
              ]}>
              {describeFreshness(activeNodes[0].lastSeen, nowMs).label}
            </Text>
          )}
        </View>

        <View style={{flexDirection: 'row', alignItems: 'baseline', marginTop: 6}}>
          <Text style={s.bigNumber}>{avg ? avg.adc : '—'}</Text>
          <Text style={s.unit}> cuentas ADC (0–4095)</Text>
        </View>

        <Text
          style={[
            s.body,
            {
              fontWeight: '600',
              color: avg ? tone(describeSignal(avg.adc).tone) : p.inkFaint,
            },
          ]}>
          {avg
            ? describeSignal(avg.adc).label
            : scope === 'physical' && !hasPhysical
            ? 'Esperando la primera trama del nodo ESP32_FISICO_UNT…'
            : 'Esperando la primera lectura desde el broker'}
        </Text>
        {avg && <Text style={s.small}>{describeSignal(avg.adc).detail}</Text>}

        <ReferenceScale adc={avg ? avg.adc : null} p={p} />

        <View style={{marginTop: 18}}>
          <Bars values={activeHistoryValues} color={p.primary} track={p.surfaceAlt} height={48} />
          <View style={[s.spread, {marginTop: 6}]}>
            <Text style={s.small}>
              Últimas {activeHistoryValues.length || 0} muestras
            </Text>
            {avg && (
              <Text style={s.small}>
                Rango sesión: {avg.minAdc} – {avg.maxAdc} ADC (Δ {avg.maxAdc - avg.minAdc})
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Cuadrícula de variables instrumentales */}
      <View style={s.row}>
        <View style={[s.card, s.cell]}>
          <Text style={s.eyebrow}>Tensión GPIO 34</Text>
          <Text style={s.metric}>{avg?.volt != null ? `${avg.volt.toFixed(2)} V` : '—'}</Text>
          <Text style={s.small}>
            {avg?.sensorVolt != null
              ? `Salida sensor ≈ ${avg.sensorVolt.toFixed(2)} V`
              : 'Rango ADC: 0 a 3.30 V'}
          </Text>
        </View>
        <View style={[s.card, s.cell]}>
          <Text style={s.eyebrow}>Temperatura</Text>
          <Text style={s.metric}>{avg?.temp != null ? `${avg.temp.toFixed(1)} °C` : '—'}</Text>
          <Text style={s.small}>Sonda DS18B20 · GPIO 4</Text>
        </View>
      </View>

      <View style={s.row}>
        <View style={[s.card, s.cell]}>
          <Text style={s.eyebrow}>Tendencia suavizada</Text>
          <Text style={s.metric}>{avg ? avg.trend : '—'}</Text>
          <Text style={s.small}>Filtro exponencial (α = 0.3)</Text>
        </View>
        <View style={[s.card, s.cell]}>
          <Text style={s.eyebrow}>Intervalo de llegada</Text>
          <Text style={s.metric}>
            {avg?.deltaSec != null ? `${avg.deltaSec.toFixed(1)} s` : rate > 0 ? `${rate}/s` : '—'}
          </Text>
          <Text style={s.small}>{total} muestras en esta sesión</Text>
        </View>
      </View>

      {/* Tarjeta de Continuidad y Mecanismos contra Pérdida de Datos */}
      <View style={s.card}>
        <View style={s.spread}>
          <Text style={s.eyebrow}>Continuidad de datos (ESP32 → APK)</Text>
          <View
            style={[
              s.badge,
              {
                backgroundColor:
                  total === 0 ? p.surfaceAlt : totalGaps === 0 ? p.goodSoft : p.warnSoft,
              },
            ]}>
            <Text
              style={[
                s.badgeText,
                {
                  color: total === 0 ? p.inkSoft : totalGaps === 0 ? p.good : p.warn,
                },
              ]}>
              {continuityPct !== null ? `${continuityPct}% recibido` : 'En espera'}
            </Text>
          </View>
        </View>

        <Text style={s.cardTitle}>¿Se pierden datos y cómo se gestiona?</Text>
        <Text style={s.body}>
          El sistema separa el <Text style={s.strong}>almacenamiento permanente</Text> de la{' '}
          <Text style={s.strong}>visualización móvil en vivo</Text> mediante tres mecanismos:
        </Text>

        <View style={s.divider} />

        <View style={s.stepBox}>
          <Text style={s.stepTitle}>1. En el ESP32 (Borde · Sobremuestreo y Autoreconexión)</Text>
          <Text style={s.stepBody}>
            En cada ciclo de 4–5 s, el microcontrolador toma 20 lecturas consecutivas del ADC (separadas por 5 ms) y transmite el promedio para mitigar picos de ruido eléctrico. Si el Wi-Fi o el broker se desconectan, reintenta cada 5 s de forma no bloqueante.
          </Text>
        </View>

        <View style={[s.stepBox, {marginTop: 10}]}>
          <Text style={s.stepTitle}>2. En el Servidor (EMQX → MySQL con QoS 1)</Text>
          <Text style={s.stepBody}>
            El servicio backend escucha permanentemente con nivel de entrega garantizada (QoS 1) y guarda cada paquete en MySQL 8.0. Aunque cierres esta APK o el celular pierda Wi-Fi, ninguna lectura del ESP32 se pierde en la base de datos.
          </Text>
        </View>

        <View style={[s.stepBox, {marginTop: 10}]}>
          <Text style={s.stepTitle}>3. En esta APK (WebSocket en Tiempo Real + Detector Δt)</Text>
          <Text style={s.stepBody}>
            La app usa suscripción directa (QoS 0 sobre TCP) con pulsos de vida cada 24 s y reconexión cada 3 s para mostrar siempre el dato más reciente sin acumular retrasos. Si tu celular pierde cobertura unos segundos, la APK mide el intervalo entre paquetes (Δt) y contabiliza abajo si hubo muestras omitidas en pantalla.
          </Text>
        </View>

        <View style={s.divider} />

        <View style={s.kv}>
          <Text style={s.kvKey}>Muestras recibidas en la APK</Text>
          <Text style={s.kvVal}>{total}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>Saltos temporales detectados (Δt &gt; 2.2×)</Text>
          <Text style={[s.kvVal, totalGaps > 0 && {color: p.warn}]}>{totalGaps}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>Tiempo continuo en línea</Text>
          <Text style={s.kvVal}>{online ? formatDuration(sessionSec) : '—'}</Text>
        </View>
      </View>

      {/* Guía rápida de interpretación física */}
      <View style={s.card}>
        <Text style={s.eyebrow}>Guía rápida de lectura</Text>
        <Text style={s.cardTitle}>Cómo leer las cuentas ADC y el estudio</Text>
        <Text style={s.body}>
          El sensor óptico TS-300B emite luz infrarroja a través del agua. Cuando el agua está limpia, llega más luz al receptor y entrega mayor voltaje al pin GPIO 34 (más cuentas ADC). Cuando hay sedimento, las partículas dispersan la luz y las cuentas bajan.
        </Text>
        <View style={s.divider} />
        <View style={s.kv}>
          <Text style={s.kvKey}>Sesión 1 · Agua limpia (línea base)</Text>
          <Text style={s.kvVal}>≈ {STUDY.s1} ADC (~1.72 V)</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>Sesión 2 · Agua con sedimento</Text>
          <Text style={s.kvVal}>≈ {STUDY.s2} ADC (~1.52 V)</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>Sesión 3 · Repetición experimental</Text>
          <Text style={s.kvVal}>≈ {STUDY.s3} ADC (~1.53 V)</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>Regresión Ridge (h = 5 pasos), RMSE</Text>
          <Text style={s.kvVal}>{STUDY.ridgeRmse} ADC (R² = {STUDY.ridgeR2})</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}> Línea base de persistencia, RMSE</Text>
          <Text style={s.kvVal}>{STUDY.persistenceRmse} ADC</Text>
        </View>
        <Text style={[s.small, {marginTop: 8}]}>
          Nota metodológica: el sistema caracteriza variaciones relativas de la señal óptica (0–4095 ADC). No sustituye un turbidímetro nefelométrico calibrado en NTU ni evalúa potabilidad.
        </Text>
      </View>
    </ScrollView>
  );

  // ----------------------------------------------------------------- Nodos
  const Nodos = (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Text style={s.screenTitle}>Nodos</Text>
      <Text style={[s.body, {marginBottom: 8}]}>
        Dispositivos detectados en <Text style={s.mono}>{TOPIC}</Text>. Toca cualquier tarjeta para inspeccionar su continuidad, voltajes e historial.
      </Text>
      {list.length === 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Sin nodos recibidos todavía</Text>
          <Text style={s.body}>
            Conéctate al broker y asegúrate de que tu ESP32 físico o el contenedor simulador estén publicando.
          </Text>
        </View>
      )}
      {list.map(n => {
        const d = describeSignal(n.adc);
        const fresh = describeFreshness(n.lastSeen, nowMs);
        const hw = translateHealth(n.health);
        return (
          <Pressable key={n.id} style={s.card} onPress={() => setSelected(n.id)}>
            <View style={s.spread}>
              <View style={{flex: 1, paddingRight: 8}}>
                <Text style={s.cardTitle} numberOfLines={1}>
                  {n.id}
                </Text>
                <Text style={s.small} numberOfLines={1}>
                  {n.location}
                </Text>
              </View>
              <View style={[s.badge, {backgroundColor: n.physical ? p.goodSoft : p.surfaceAlt}]}>
                <Text style={[s.badgeText, {color: n.physical ? p.good : p.inkSoft}]}>
                  {n.physical ? 'ESP32 Físico' : 'Simulación Virtual'}
                </Text>
              </View>
            </View>

            <View style={[s.spread, {marginTop: 12, alignItems: 'flex-end'}]}>
              <View>
                <Text style={s.metric}>{n.adc}</Text>
                <Text style={s.small}>
                  cuentas ADC · tendencia {Math.round(n.trend)}
                </Text>
              </View>
              <View style={{alignItems: 'flex-end'}}>
                <Text style={s.body}>
                  {n.voltage != null ? `${n.voltage.toFixed(2)} V (pin)` : '— V'}
                </Text>
                <Text style={s.body}>
                  {n.temperature != null ? `${n.temperature.toFixed(1)} °C` : '— °C'}
                </Text>
              </View>
            </View>

            <View style={{marginTop: 12}}>
              <Bars
                values={n.history.map(h => h.adc)}
                color={tone(d.tone)}
                track={p.surfaceAlt}
                height={30}
              />
            </View>

            <View style={[s.spread, {marginTop: 10}]}>
              <Text style={[s.small, {color: freshColor(fresh.tone), fontWeight: '600'}]}>
                {fresh.label}
              </Text>
              <Text style={s.small}>
                {n.packetCount} muestras · {n.gapsDetected === 0 ? 'sin saltos' : `${n.gapsDetected} saltos`}
              </Text>
            </View>
            <Text style={[s.small, {marginTop: 4, color: hw.ok ? tone(d.tone) : p.bad}]}>
              {hw.ok ? d.label : hw.text}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  // -------------------------------------------------------------- Registro
  const Registro = (
    <View style={{flex: 1}}>
      <View style={[s.spread, {paddingHorizontal: 20, paddingTop: 20}]}>
        <View>
          <Text style={s.screenTitle}>Registro</Text>
          <Text style={s.small}>Eventos de conexión WebSocket, suscripciones y saltos Δt</Text>
        </View>
        <Pressable onPress={() => setLogs([])} hitSlop={10}>
          <Text style={s.link}>Limpiar</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[s.content, {paddingTop: 12}]}
        showsVerticalScrollIndicator={false}>
        {logs.length === 0 ? (
          <View style={s.card}>
            <Text style={s.body}>Todavía no hay eventos registrados en esta sesión.</Text>
          </View>
        ) : (
          <View style={s.card}>
            {logs.map((l, i) => (
              <View
                key={l.id}
                style={[
                  s.logRow,
                  i > 0 && {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line},
                ]}>
                <Text style={s.logTime}>{l.time}</Text>
                <Text
                  style={[
                    s.logText,
                    l.level === 'error' && {color: p.bad},
                    l.level === 'warn' && {color: p.warn},
                    l.level === 'success' && {color: p.good},
                  ]}>
                  {l.text}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );

  // --------------------------------------------------------------- Ajustes
  const Ajustes = (
    <ScrollView
      contentContainerStyle={[s.content, {paddingBottom: 140}]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <Text style={s.screenTitle}>Ajustes</Text>

      <View style={s.card}>
        <Text style={s.eyebrow}>Apariencia</Text>
        <View style={s.segment}>
          {(['light', 'dark', 'system'] as ThemeMode[]).map(m => (
            <Pressable
              key={m}
              style={[s.segItem, mode === m && s.segItemOn]}
              onPress={() => setMode(m)}>
              <Text style={[s.segText, mode === m && s.segTextOn]}>
                {m === 'light' ? 'Claro' : m === 'dark' ? 'Oscuro' : 'Sistema'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={s.card}>
        <View style={s.spread}>
          <Text style={s.eyebrow}>Conexión MQTT por WebSocket</Text>
          {url !== DEFAULTS.broker && (
            <Pressable onPress={() => setUrl(DEFAULTS.broker)} hitSlop={8}>
              <Text style={s.link}>Restablecer IP</Text>
            </Pressable>
          )}
        </View>

        <Text style={s.label}>Dirección del broker EMQX</Text>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholderTextColor={p.inkFaint}
        />
        <Text style={s.small}>
          El puerto 8084 corresponde a WebSockets para esta app; el ESP32 físico publica por el puerto TCP 1884.
        </Text>

        <Text style={s.label}>Usuario</Text>
        <TextInput
          style={s.input}
          value={user}
          onChangeText={setUser}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={p.inkFaint}
        />

        <View style={s.spread}>
          <Text style={s.label}>Contraseña</Text>
          <Pressable onPress={() => setShowPass(v => !v)} hitSlop={10}>
            <Text style={s.link}>{showPass ? 'Ocultar' : 'Mostrar'}</Text>
          </Pressable>
        </View>
        <TextInput
          style={s.input}
          value={pass}
          onChangeText={setPass}
          secureTextEntry={!showPass}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={p.inkFaint}
        />

        <View style={{flexDirection: 'row', gap: 10, marginTop: 16}}>
          <Pressable
            style={[s.btn, {flex: 1, marginTop: 0}, busy && s.btnDisabled]}
            disabled={busy}
            onPress={() => connect()}>
            {busy ? (
              <ActivityIndicator color={p.onPrimary} />
            ) : (
              <Text style={s.btnText}>{online ? 'Reconectar' : 'Conectar'}</Text>
            )}
          </Pressable>
          <Pressable
            style={[s.btnGhost, !(online || busy) && {opacity: 0.4}]}
            disabled={!(online || busy)}
            onPress={disconnect}>
            <Text style={s.btnGhostText}>Desconectar</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.eyebrow}>Control de acceso y seguridad</Text>
        <Text style={s.body}>
          • <Text style={s.strong}>Mínimo privilegio (ACL):</Text> La cuenta{' '}
          <Text style={s.mono}>mobile_monitor</Text> tiene permiso exclusivo de lectura (SUBSCRIBE) sobre{' '}
          <Text style={s.mono}>{TOPIC}</Text>. El nodo físico usa la identidad separada{' '}
          <Text style={s.mono}>esp32_nodes</Text>.
        </Text>
        <Text style={s.body}>
          • <Text style={s.strong}>Autenticación en base de datos:</Text> EMQX 5.8 valida las credenciales contra MySQL 8.0 mediante hashes SHA-256 con salado individual y aplica política de denegación por defecto (<Text style={s.mono}>no_match: deny</Text>).
        </Text>
        <Text style={[s.small, {marginTop: 8}]}>
          El enlace opera con ws:// dentro de la red local privada. Para despliegues en redes públicas se debe habilitar wss:// con certificado TLS.
        </Text>
      </View>
    </ScrollView>
  );

  const tabs: {key: Tab; label: string}[] = [
    {key: 'resumen', label: 'Resumen'},
    {key: 'nodos', label: 'Nodos'},
    {key: 'registro', label: 'Registro'},
    {key: 'ajustes', label: 'Ajustes'},
  ];

  const dot = online ? p.good : status === 'error' ? p.bad : busy ? p.warn : p.inkFaint;

  return (
    <View style={[s.root, {paddingTop: insets.top}]}>
      <StatusBar barStyle={p.isDark ? 'light-content' : 'dark-content'} />

      <View style={s.header}>
        <View>
          <Text style={s.brand}>TurbiSense</Text>
          <Text style={s.brandSub}>Señal óptica en agua almacenada</Text>
        </View>
        <Pressable
          style={s.status}
          onPress={() => (online ? setTab('nodos') : setTab('ajustes'))}>
          <View style={[s.statusDot, {backgroundColor: dot}]} />
          <Text style={s.statusText}>{STATUS_TEXT[status]}</Text>
        </Pressable>
      </View>

      <View style={{flex: 1}}>
        {tab === 'resumen' && Resumen}
        {tab === 'nodos' && Nodos}
        {tab === 'registro' && Registro}
        {tab === 'ajustes' && Ajustes}
      </View>

      <View style={[s.tabBar, {paddingBottom: Math.max(insets.bottom, 10)}]}>
        {tabs.map(t => (
          <Pressable key={t.key} style={s.tab} onPress={() => setTab(t.key)}>
            <View style={[s.tabBar2, tab === t.key && {backgroundColor: p.primary}]} />
            <Text style={[s.tabText, tab === t.key && s.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <Modal
        visible={!!selectedNode}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}>
        <Pressable style={s.scrim} onPress={() => setSelected(null)} />
        {selectedNode && (
          <View style={[s.sheet, {paddingBottom: Math.max(insets.bottom, 16) + 8}]}>
            <View style={s.grabber} />
            <View style={s.spread}>
              <View style={{flex: 1, paddingRight: 8}}>
                <Text style={s.cardTitle}>{selectedNode.id}</Text>
                <Text style={s.small}>
                  {selectedNode.location} ·{' '}
                  {selectedNode.physical ? 'Hardware ESP32 físico' : 'Simulación virtual'}
                </Text>
              </View>
              <Pressable onPress={() => setSelected(null)} hitSlop={12}>
                <Text style={s.link}>Cerrar</Text>
              </Pressable>
            </View>

            <ScrollView style={{maxHeight: 490, marginTop: 8}} showsVerticalScrollIndicator={false}>
              <View style={[s.row, {marginTop: 6}]}>
                <View style={[s.cell, s.mini]}>
                  <Text style={s.eyebrow}>Señal ADC (12 bits)</Text>
                  <Text style={s.metric}>{selectedNode.adc}</Text>
                  <Text style={s.small}>
                    {selectedNode.adcDerived ? 'Derivado de tensión' : 'Lectura directa GPIO 34'}
                  </Text>
                </View>
                <View style={[s.cell, s.mini]}>
                  <Text style={s.eyebrow}>Tendencia (EMA)</Text>
                  <Text style={s.metric}>{Math.round(selectedNode.trend)}</Text>
                  <Text style={s.small}>
                    Rango: {selectedNode.minAdc} – {selectedNode.maxAdc}
                  </Text>
                </View>
              </View>

              <View style={[s.row, {marginTop: 10}]}>
                <View style={[s.cell, s.mini]}>
                  <Text style={s.eyebrow}>Tensión Pin / Sensor</Text>
                  <Text style={s.metric}>
                    {selectedNode.voltage != null ? `${selectedNode.voltage.toFixed(3)} V` : '—'}
                  </Text>
                  <Text style={s.small}>
                    {selectedNode.sensorVoltage != null
                      ? `Salida AO ≈ ${selectedNode.sensorVoltage.toFixed(2)} V`
                      : 'GPIO 34'}
                  </Text>
                </View>
                <View style={[s.cell, s.mini]}>
                  <Text style={s.eyebrow}>Temperatura</Text>
                  <Text style={s.metric}>
                    {selectedNode.temperature != null
                      ? `${selectedNode.temperature.toFixed(1)} °C`
                      : '—'}
                  </Text>
                  <Text style={s.small}>DS18B20 · GPIO 4</Text>
                </View>
              </View>

              <Text style={[s.eyebrow, {marginTop: 16, marginBottom: 4}]}>
                Continuidad y estado del dispositivo
              </Text>
              <View style={s.kv}>
                <Text style={s.kvKey}>Estado del enlace</Text>
                <Text
                  style={[
                    s.kvVal,
                    {color: freshColor(describeFreshness(selectedNode.lastSeen, nowMs).tone)},
                  ]}>
                  {describeFreshness(selectedNode.lastSeen, nowMs).label}
                </Text>
              </View>
              <View style={s.kv}>
                <Text style={s.kvKey}>Muestras recibidas / Saltos Δt</Text>
                <Text style={s.kvVal}>
                  {selectedNode.packetCount} recibidas · {selectedNode.gapsDetected} saltos
                </Text>
              </View>
              <View style={s.kv}>
                <Text style={s.kvKey}>Intervalo entre muestras (Δt)</Text>
                <Text style={s.kvVal}>
                  {selectedNode.lastDeltaSec != null
                    ? `Último: ${selectedNode.lastDeltaSec.toFixed(1)} s`
                    : 'Primera muestra'}
                  {selectedNode.avgDeltaSec != null
                    ? ` (media: ${selectedNode.avgDeltaSec.toFixed(1)} s)`
                    : ''}
                </Text>
              </View>
              <View style={s.kv}>
                <Text style={s.kvKey}>Diagnóstico de hardware</Text>
                <Text
                  style={[
                    s.kvVal,
                    !translateHealth(selectedNode.health).ok && {color: p.bad},
                  ]}>
                  {translateHealth(selectedNode.health).text}
                </Text>
              </View>
              {selectedNode.ntpSynced !== null && (
                <View style={s.kv}>
                  <Text style={s.kvKey}>Sincronización reloj NTP</Text>
                  <Text style={s.kvVal}>
                    {selectedNode.ntpSynced ? 'Sincronizado (UTC-5)' : 'Pendiente'}
                  </Text>
                </View>
              )}
              <View style={s.kv}>
                <Text style={s.kvKey}>Hora de última recepción</Text>
                <Text style={s.kvVal}>{clock(selectedNode.lastSeen)}</Text>
              </View>

              <Text style={[s.eyebrow, {marginTop: 16, marginBottom: 8}]}>
                Evolución reciente (cuentas ADC)
              </Text>
              <Bars
                values={selectedNode.history.map(h => h.adc)}
                color={p.primary}
                track={p.surfaceAlt}
                height={56}
              />
              <View style={{marginTop: 12}}>
                {[...selectedNode.history]
                  .reverse()
                  .slice(0, 6)
                  .map((h, i) => (
                    <View key={i} style={s.kv}>
                      <Text style={s.kvKey}>
                        {clock(h.at)}
                        {h.deltaSec != null ? `  (Δt ${h.deltaSec.toFixed(1)}s)` : ''}
                      </Text>
                      <Text style={s.kvVal}>
                        {h.adc} ADC
                        {h.volt != null ? ` · ${h.volt.toFixed(2)}V` : ''}
                        {h.temp != null ? ` · ${h.temp.toFixed(1)}°C` : ''}
                      </Text>
                    </View>
                  ))}
              </View>
            </ScrollView>

            <Pressable style={s.btnGhostFull} onPress={() => setSelected(null)}>
              <Text style={s.btnGhostText}>Volver</Text>
            </Pressable>
          </View>
        )}
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

// ============================================================================
// Estilos
// ============================================================================
const makeStyles = (p: Palette) =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: p.bg},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 10,
    },
    brand: {fontSize: 22, fontWeight: '700', color: p.ink, letterSpacing: -0.3},
    brandSub: {fontSize: 12, color: p.inkSoft, marginTop: 1},
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.line,
    },
    statusDot: {width: 8, height: 8, borderRadius: 4},
    statusText: {fontSize: 12, fontWeight: '600', color: p.ink},

    content: {paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, gap: 14},
    screenTitle: {fontSize: 26, fontWeight: '700', color: p.ink, letterSpacing: -0.4},
    card: {
      backgroundColor: p.surface,
      borderRadius: 18,
      padding: 18,
      borderWidth: 1,
      borderColor: p.line,
    },
    row: {flexDirection: 'row', gap: 12},
    cell: {flex: 1},
    mini: {backgroundColor: p.surfaceAlt, borderRadius: 14, padding: 14},
    spread: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},

    eyebrow: {
      fontSize: 11,
      fontWeight: '600',
      color: p.inkSoft,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    cardTitle: {fontSize: 17, fontWeight: '700', color: p.ink, marginTop: 4},
    body: {fontSize: 14, lineHeight: 20, color: p.inkSoft, marginTop: 6},
    strong: {fontWeight: '700', color: p.ink},
    small: {fontSize: 12, lineHeight: 17, color: p.inkFaint, marginTop: 2},
    mono: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
      color: p.ink,
    },
    bigNumber: {
      fontSize: 52,
      fontWeight: '700',
      color: p.ink,
      letterSpacing: -1.5,
      fontVariant: ['tabular-nums'],
    },
    unit: {fontSize: 14, color: p.inkSoft},
    metric: {
      fontSize: 25,
      fontWeight: '700',
      color: p.ink,
      marginTop: 6,
      fontVariant: ['tabular-nums'],
    },
    divider: {height: StyleSheet.hairlineWidth, backgroundColor: p.line, marginVertical: 14},
    kv: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6},
    kvKey: {fontSize: 13, color: p.inkSoft, flex: 1, paddingRight: 10},
    kvVal: {fontSize: 13, fontWeight: '700', color: p.ink, fontVariant: ['tabular-nums']},
    badge: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999},
    badgeText: {fontSize: 11, fontWeight: '700'},

    stepBox: {
      backgroundColor: p.surfaceAlt,
      borderRadius: 12,
      padding: 12,
    },
    stepTitle: {fontSize: 13, fontWeight: '700', color: p.ink},
    stepBody: {fontSize: 12, lineHeight: 18, color: p.inkSoft, marginTop: 4},

    btn: {
      marginTop: 16,
      backgroundColor: p.primary,
      borderRadius: 14,
      height: 50,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnDisabled: {opacity: 0.6},
    btnText: {fontSize: 15, fontWeight: '700', color: p.onPrimary},
    btnGhost: {
      borderRadius: 14,
      height: 50,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: p.line,
    },
    btnGhostFull: {
      marginTop: 14,
      borderRadius: 14,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: p.line,
    },
    btnGhostText: {fontSize: 14, fontWeight: '600', color: p.ink},
    link: {fontSize: 13, fontWeight: '600', color: p.primary},

    label: {fontSize: 12, fontWeight: '600', color: p.inkSoft, marginTop: 14, marginBottom: 6},
    input: {
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.line,
      backgroundColor: p.bg,
      paddingHorizontal: 14,
      fontSize: 14,
      color: p.ink,
    },
    segment: {
      flexDirection: 'row',
      backgroundColor: p.surfaceAlt,
      borderRadius: 12,
      padding: 4,
      marginTop: 12,
    },
    segItem: {flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
    segItemOn: {backgroundColor: p.surface},
    segText: {fontSize: 12, fontWeight: '600', color: p.inkSoft},
    segTextOn: {color: p.ink},

    logRow: {flexDirection: 'row', gap: 12, paddingVertical: 9},
    logTime: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      color: p.inkFaint,
      width: 58,
      paddingTop: 2,
    },
    logText: {flex: 1, fontSize: 13, lineHeight: 18, color: p.ink},

    tabBar: {
      flexDirection: 'row',
      backgroundColor: p.surface,
      borderTopWidth: 1,
      borderTopColor: p.line,
      paddingTop: 8,
    },
    tab: {flex: 1, alignItems: 'center', gap: 6, paddingVertical: 4},
    tabBar2: {width: 22, height: 3, borderRadius: 2, backgroundColor: 'transparent'},
    tabText: {fontSize: 12, fontWeight: '600', color: p.inkFaint},
    tabTextOn: {color: p.primary},

    scrim: {flex: 1, backgroundColor: p.scrim},
    sheet: {
      backgroundColor: p.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: p.line,
      marginBottom: 14,
    },
  });

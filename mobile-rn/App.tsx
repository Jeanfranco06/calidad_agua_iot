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
  at: number;
}

interface NodeData {
  id: string;
  location: string;
  physical: boolean;
  adc: number;
  adcDerived: boolean;
  voltage: number | null;
  temperature: number | null;
  health: string;
  trend: number;
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

const TOPIC = 'cistern/+/telemetry';
const DEFAULTS = {
  wifi: 'ws://192.168.18.10:8084/mqtt',
  local: 'ws://127.0.0.1:8084/mqtt',
  user: 'mobile_monitor',
  pass: 'Nu2eYr2W2tKbm92URpcB!2026',
};

// Valores medidos en el estudio (cuentas ADC de 12 bits, GPIO 34).
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

const describeSignal = (adc: number): {label: string; tone: 'primary' | 'warn' | 'soft'} => {
  if (adc >= 2050) return {label: 'Cercana a la línea base S1 (agua limpia)', tone: 'primary'};
  if (adc >= 1700) return {label: 'Cercana al régimen S2 (con sedimento)', tone: 'warn'};
  return {label: 'Fuera del rango de referencia del estudio', tone: 'soft'};
};

const STATUS_TEXT: Record<LinkStatus, string> = {
  idle: 'Sin enlace',
  connecting: 'Conectando',
  connected: 'En línea',
  reconnecting: 'Reintentando',
  error: 'Error',
};

// ============================================================================
// Componentes pequeños
// ============================================================================
function Bars({values, color, track, height = 36}: {values: number[]; color: string; track: string; height?: number}) {
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
  // Escala 1500 – 2400 cuentas con las referencias S2 y S1 marcadas.
  const lo = 1500;
  const hi = 2400;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%` as const;
  return (
    <View style={{marginTop: 18}}>
      <View style={{height: 8, borderRadius: 4, backgroundColor: p.surfaceAlt}}>
        <View style={{position: 'absolute', left: pos(STUDY.s2), top: -3, width: 2, height: 14, backgroundColor: p.warn}} />
        <View style={{position: 'absolute', left: pos(STUDY.s1), top: -3, width: 2, height: 14, backgroundColor: p.primary}} />
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
        <Text style={{fontSize: 11, color: p.warn}}>S2 · {STUDY.s2}</Text>
        <Text style={{fontSize: 11, color: p.primary}}>S1 · {STUDY.s1}</Text>
      </View>
    </View>
  );
}

// ============================================================================
// Aplicación
// ============================================================================
function Main() {
  const system = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('light');
  const p = useMemo(() => resolvePalette(mode, system), [mode, system]);
  const s = useMemo(() => makeStyles(p), [p]);
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('resumen');
  const [url, setUrl] = useState(DEFAULTS.wifi);
  const [user, setUser] = useState(DEFAULTS.user);
  const [pass, setPass] = useState(DEFAULTS.pass);
  const [showPass, setShowPass] = useState(false);

  const [status, setStatus] = useState<LinkStatus>('idle');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [nodes, setNodes] = useState<Record<string, NodeData>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [mix, setMix] = useState<number[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [total, setTotal] = useState(0);
  const [rate, setRate] = useState(0);

  const handle = useRef<MqttLiteHandle | null>(null);
  const counter = useRef(0);
  const logId = useRef(0);

  const log = useCallback((text: string, level: LogLine['level'] = 'info') => {
    logId.current += 1;
    const line = {id: logId.current, time: clock(Date.now()), text, level};
    setLogs(prev => [line, ...prev].slice(0, 80));
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setRate(counter.current);
      counter.current = 0;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => handle.current?.close(), []);

  const onMessage = useCallback((topic: string, payload: string) => {
    const raw = JSON.parse(payload);
    const now = Date.now();
    const id = String(raw.device_id || topic.split('/')[1] || 'nodo');
    const m = raw.metrics || {};

    const volt = typeof m.pin_voltage_v === 'number' ? m.pin_voltage_v : typeof m.sensor_voltage === 'number' ? m.sensor_voltage : null;
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
    const physical = origin.includes('FISICO') || origin.includes('PHYSICAL');

    counter.current += 1;
    setTotal(v => v + 1);
    setMix(prev => [...prev, adc].slice(-36));
    setNodes(prev => {
      const old = prev[id];
      const history = [...(old?.history ?? []), {adc, at: now}].slice(-30);
      const trend = old ? old.trend + 0.3 * (adc - old.trend) : adc;
      return {
        ...prev,
        [id]: {
          id,
          location: String(raw.location || '—').replace(/_/g, ' '),
          physical,
          adc,
          adcDerived: derived,
          voltage: volt,
          temperature: temp,
          health: String(raw.hardware_health || 'OK'),
          trend,
          lastSeen: now,
          history,
          raw,
        },
      };
    });
  }, []);

  const connect = useCallback(
    (target?: string) => {
      handle.current?.close();
      const finalUrl = (target ?? url).trim();
      if (!/^wss?:\/\//i.test(finalUrl)) {
        log('La URL debe empezar con ws:// o wss://', 'error');
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
            log(`Trama no válida: ${e?.message ?? e}`, 'warn');
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
    log('Enlace cerrado por el usuario', 'info');
  }, [log]);

  const list = useMemo(() => Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id)), [nodes]);
  const avg = useMemo(() => {
    if (!list.length) return null;
    const mean = (f: (n: NodeData) => number | null) => {
      const v = list.map(f).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    return {
      adc: Math.round(list.reduce((a, n) => a + n.adc, 0) / list.length),
      volt: mean(n => n.voltage),
      temp: mean(n => n.temperature),
      trend: Math.round(list.reduce((a, n) => a + n.trend, 0) / list.length),
    };
  }, [list]);

  const online = status === 'connected';
  const busy = status === 'connecting' || status === 'reconnecting';
  const selectedNode = selected ? nodes[selected] : null;

  const tone = (t: 'primary' | 'warn' | 'soft') => (t === 'primary' ? p.primary : t === 'warn' ? p.warn : p.inkSoft);

  // --------------------------------------------------------------- Resumen
  const Resumen = (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      {!online && (
        <View style={s.card}>
          <Text style={s.eyebrow}>Enlace con el broker</Text>
          <Text style={s.cardTitle}>{busy ? 'Estableciendo conexión…' : 'Aún no hay datos'}</Text>
          <Text style={s.body}>
            Se conecta a EMQX con el usuario de solo lectura <Text style={s.strong}>{user}</Text> y se suscribe a{' '}
            <Text style={s.mono}>{TOPIC}</Text>.
          </Text>
          <Text style={[s.mono, {marginTop: 8, color: p.inkSoft}]}>{url}</Text>
          <Pressable style={[s.btn, busy && s.btnDisabled]} disabled={busy} onPress={() => connect()}>
            {busy ? <ActivityIndicator color={p.onPrimary} /> : <Text style={s.btnText}>Conectar</Text>}
          </Pressable>
          {status === 'error' || status === 'reconnecting' ? (
            <Text style={[s.small, {marginTop: 10, color: p.bad}]}>
              Si no conecta, revisa en Registro el motivo exacto, o prueba otra dirección en Ajustes.
            </Text>
          ) : null}
        </View>
      )}

      <View style={s.card}>
        <Text style={s.eyebrow}>Señal óptica promedio · sensor TS-300B</Text>
        <View style={{flexDirection: 'row', alignItems: 'baseline', marginTop: 6}}>
          <Text style={s.bigNumber}>{avg ? avg.adc : '—'}</Text>
          <Text style={s.unit}> cuentas ADC</Text>
        </View>
        <Text style={[s.body, {color: avg ? tone(describeSignal(avg.adc).tone) : p.inkFaint}]}>
          {avg ? describeSignal(avg.adc).label : 'Esperando la primera lectura'}
        </Text>
        <ReferenceScale adc={avg ? avg.adc : null} p={p} />
        <View style={{marginTop: 18}}>
          <Bars values={mix} color={p.primary} track={p.surfaceAlt} height={44} />
          <Text style={[s.small, {marginTop: 6}]}>Últimas {mix.length || 0} lecturas combinadas</Text>
        </View>
      </View>

      <View style={s.row}>
        <View style={[s.card, s.cell]}>
          <Text style={s.eyebrow}>Tensión GPIO 34</Text>
          <Text style={s.metric}>{avg?.volt != null ? avg.volt.toFixed(2) : '—'}</Text>
          <Text style={s.small}>voltios</Text>
        </View>
        <View style={[s.card, s.cell]}>
          <Text style={s.eyebrow}>Temperatura</Text>
          <Text style={s.metric}>{avg?.temp != null ? avg.temp.toFixed(1) : '—'}</Text>
          <Text style={s.small}>°C · DS18B20</Text>
        </View>
      </View>
      <View style={s.row}>
        <View style={[s.card, s.cell]}>
          <Text style={s.eyebrow}>Tendencia</Text>
          <Text style={s.metric}>{avg ? avg.trend : '—'}</Text>
          <Text style={s.small}>suavizado exp.</Text>
        </View>
        <View style={[s.card, s.cell]}>
          <Text style={s.eyebrow}>Recepción</Text>
          <Text style={s.metric}>{rate}</Text>
          <Text style={s.small}>msg/s · {total} en total</Text>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.eyebrow}>Referencia del estudio</Text>
        <Text style={s.cardTitle}>Qué mide y qué no</Text>
        <Text style={s.body}>
          El prototipo registra la señal óptica asociada a turbidez como cuentas ADC (0–4095). No está calibrado en NTU ni
          determina si el agua es potable.
        </Text>
        <View style={s.divider} />
        <View style={s.kv}>
          <Text style={s.kvKey}>Sesión 1 · agua limpia</Text>
          <Text style={s.kvVal}>≈ {STUDY.s1}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>Sesión 2 · con sedimento</Text>
          <Text style={s.kvVal}>≈ {STUDY.s2}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>Regresión Ridge (h = 5), RMSE</Text>
          <Text style={s.kvVal}>{STUDY.ridgeRmse}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>Persistencia, RMSE</Text>
          <Text style={s.kvVal}>{STUDY.persistenceRmse}</Text>
        </View>
        <View style={s.kv}>
          <Text style={s.kvKey}>R² del modelo Ridge</Text>
          <Text style={s.kvVal}>{STUDY.ridgeR2}</Text>
        </View>
        <Text style={[s.small, {marginTop: 8}]}>Resultados exploratorios, sobre tres sesiones de laboratorio.</Text>
      </View>
    </ScrollView>
  );

  // ----------------------------------------------------------------- Nodos
  const Nodos = (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Text style={s.screenTitle}>Nodos</Text>
      <Text style={[s.body, {marginBottom: 14}]}>Cada ESP32 publica en su propio tópico. Toca un nodo para ver el detalle.</Text>
      {list.length === 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Sin nodos todavía</Text>
          <Text style={s.body}>Conéctate al broker para que aparezcan los dispositivos que estén publicando.</Text>
        </View>
      )}
      {list.map(n => {
        const d = describeSignal(n.adc);
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
                <Text style={[s.badgeText, {color: n.physical ? p.good : p.inkSoft}]}>{n.physical ? 'Físico' : 'Virtual'}</Text>
              </View>
            </View>
            <View style={[s.spread, {marginTop: 12, alignItems: 'flex-end'}]}>
              <View>
                <Text style={s.metric}>{n.adc}</Text>
                <Text style={s.small}>cuentas ADC</Text>
              </View>
              <View style={{alignItems: 'flex-end'}}>
                <Text style={s.body}>{n.voltage != null ? `${n.voltage.toFixed(2)} V` : '— V'}</Text>
                <Text style={s.body}>{n.temperature != null ? `${n.temperature.toFixed(1)} °C` : '— °C'}</Text>
              </View>
            </View>
            <View style={{marginTop: 12}}>
              <Bars values={n.history.map(h => h.adc)} color={tone(d.tone)} track={p.surfaceAlt} height={28} />
            </View>
            <Text style={[s.small, {marginTop: 8, color: tone(d.tone)}]}>{d.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  // -------------------------------------------------------------- Registro
  const Registro = (
    <View style={{flex: 1}}>
      <View style={[s.spread, {paddingHorizontal: 20, paddingTop: 20}]}>
        <Text style={s.screenTitle}>Registro</Text>
        <Pressable onPress={() => setLogs([])} hitSlop={10}>
          <Text style={[s.link]}>Limpiar</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, {paddingTop: 12}]} showsVerticalScrollIndicator={false}>
        {logs.length === 0 ? (
          <Text style={s.body}>Todavía no hay eventos.</Text>
        ) : (
          <View style={s.card}>
            {logs.map((l, i) => (
              <View key={l.id} style={[s.logRow, i > 0 && {borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line}]}>
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
            <Pressable key={m} style={[s.segItem, mode === m && s.segItemOn]} onPress={() => setMode(m)}>
              <Text style={[s.segText, mode === m && s.segTextOn]}>{m === 'light' ? 'Claro' : m === 'dark' ? 'Oscuro' : 'Sistema'}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.eyebrow}>Conexión MQTT por WebSocket</Text>
        <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}>
          <Pressable style={s.chip} onPress={() => setUrl(DEFAULTS.wifi)}>
            <Text style={s.chipText}>Wi-Fi del laboratorio</Text>
          </Pressable>
          <Pressable style={s.chip} onPress={() => setUrl(DEFAULTS.local)}>
            <Text style={s.chipText}>Este equipo</Text>
          </Pressable>
        </View>
        <Text style={s.label}>Dirección del broker</Text>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholderTextColor={p.inkFaint}
        />
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
          <Pressable style={[s.btn, {flex: 1, marginTop: 0}, busy && s.btnDisabled]} disabled={busy} onPress={() => connect()}>
            {busy ? <ActivityIndicator color={p.onPrimary} /> : <Text style={s.btnText}>{online ? 'Reconectar' : 'Conectar'}</Text>}
          </Pressable>
          <Pressable style={[s.btnGhost, !(online || busy) && {opacity: 0.4}]} disabled={!(online || busy)} onPress={disconnect}>
            <Text style={s.btnGhostText}>Desconectar</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.eyebrow}>Seguridad</Text>
        <Text style={s.body}>
          La cuenta <Text style={s.mono}>mobile_monitor</Text> solo puede suscribirse a <Text style={s.mono}>{TOPIC}</Text>; no puede
          publicar. Las credenciales se validan contra MySQL en EMQX y el resto de tópicos queda denegado por defecto.
        </Text>
        <Text style={[s.small, {marginTop: 8}]}>
          El enlace usa ws:// dentro de la red local. Fuera del laboratorio debería usarse wss:// con certificado.
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
        <Pressable style={s.status} onPress={() => (online ? setTab('nodos') : setTab('ajustes'))}>
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

      <Modal visible={!!selectedNode} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable style={s.scrim} onPress={() => setSelected(null)} />
        {selectedNode && (
          <View style={[s.sheet, {paddingBottom: Math.max(insets.bottom, 16) + 8}]}>
            <View style={s.grabber} />
            <View style={s.spread}>
              <View style={{flex: 1}}>
                <Text style={s.cardTitle}>{selectedNode.id}</Text>
                <Text style={s.small}>{selectedNode.location}</Text>
              </View>
              <Pressable onPress={() => setSelected(null)} hitSlop={12}>
                <Text style={s.link}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView style={{maxHeight: 460}} showsVerticalScrollIndicator={false}>
              <View style={[s.row, {marginTop: 14}]}>
                <View style={[s.cell, s.mini]}>
                  <Text style={s.eyebrow}>ADC</Text>
                  <Text style={s.metric}>{selectedNode.adc}</Text>
                  <Text style={s.small}>{selectedNode.adcDerived ? 'derivado de la tensión' : 'lectura directa'}</Text>
                </View>
                <View style={[s.cell, s.mini]}>
                  <Text style={s.eyebrow}>Tendencia</Text>
                  <Text style={s.metric}>{Math.round(selectedNode.trend)}</Text>
                  <Text style={s.small}>suavizado exp.</Text>
                </View>
              </View>
              <View style={[s.row, {marginTop: 10}]}>
                <View style={[s.cell, s.mini]}>
                  <Text style={s.eyebrow}>Tensión</Text>
                  <Text style={s.metric}>{selectedNode.voltage != null ? selectedNode.voltage.toFixed(3) : '—'}</Text>
                  <Text style={s.small}>V en GPIO 34</Text>
                </View>
                <View style={[s.cell, s.mini]}>
                  <Text style={s.eyebrow}>Temperatura</Text>
                  <Text style={s.metric}>{selectedNode.temperature != null ? selectedNode.temperature.toFixed(1) : '—'}</Text>
                  <Text style={s.small}>°C</Text>
                </View>
              </View>
              <View style={[s.kv, {marginTop: 14}]}>
                <Text style={s.kvKey}>Estado del hardware</Text>
                <Text style={s.kvVal}>{selectedNode.health}</Text>
              </View>
              <View style={s.kv}>
                <Text style={s.kvKey}>Origen</Text>
                <Text style={s.kvVal}>{selectedNode.physical ? 'Dispositivo físico' : 'Simulación virtual'}</Text>
              </View>
              <View style={s.kv}>
                <Text style={s.kvKey}>Última lectura</Text>
                <Text style={s.kvVal}>{clock(selectedNode.lastSeen)}</Text>
              </View>
              <Text style={[s.eyebrow, {marginTop: 16, marginBottom: 8}]}>Historial reciente (ADC)</Text>
              <Bars values={selectedNode.history.map(h => h.adc)} color={p.primary} track={p.surfaceAlt} height={56} />
              <View style={{marginTop: 12}}>
                {[...selectedNode.history]
                  .reverse()
                  .slice(0, 6)
                  .map((h, i) => (
                    <View key={i} style={s.kv}>
                      <Text style={s.kvKey}>{clock(h.at)}</Text>
                      <Text style={s.kvVal}>{h.adc}</Text>
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

    eyebrow: {fontSize: 11, fontWeight: '600', color: p.inkSoft, letterSpacing: 0.6, textTransform: 'uppercase'},
    cardTitle: {fontSize: 17, fontWeight: '700', color: p.ink, marginTop: 4},
    body: {fontSize: 14, lineHeight: 20, color: p.inkSoft, marginTop: 6},
    strong: {fontWeight: '700', color: p.ink},
    small: {fontSize: 12, color: p.inkFaint, marginTop: 2},
    mono: {fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: p.ink},
    bigNumber: {fontSize: 52, fontWeight: '700', color: p.ink, letterSpacing: -1.5, fontVariant: ['tabular-nums']},
    unit: {fontSize: 15, color: p.inkSoft},
    metric: {fontSize: 26, fontWeight: '700', color: p.ink, marginTop: 6, fontVariant: ['tabular-nums']},
    divider: {height: StyleSheet.hairlineWidth, backgroundColor: p.line, marginVertical: 14},
    kv: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6},
    kvKey: {fontSize: 13, color: p.inkSoft, flex: 1, paddingRight: 10},
    kvVal: {fontSize: 13, fontWeight: '700', color: p.ink, fontVariant: ['tabular-nums']},
    badge: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999},
    badgeText: {fontSize: 11, fontWeight: '700'},

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
    link: {fontSize: 14, fontWeight: '600', color: p.primary},

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
    chip: {paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: p.primarySoft},
    chipText: {fontSize: 12, fontWeight: '600', color: p.primary},
    segment: {flexDirection: 'row', backgroundColor: p.surfaceAlt, borderRadius: 12, padding: 4, marginTop: 12},
    segItem: {flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
    segItemOn: {backgroundColor: p.surface},
    segText: {fontSize: 13, fontWeight: '600', color: p.inkSoft},
    segTextOn: {color: p.ink},

    logRow: {flexDirection: 'row', gap: 12, paddingVertical: 9},
    logTime: {fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, color: p.inkFaint, width: 58, paddingTop: 2},
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
    grabber: {alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: p.line, marginBottom: 14},
  });

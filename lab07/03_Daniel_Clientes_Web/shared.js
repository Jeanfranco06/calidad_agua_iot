/**
 * Utilitarios compartidos para los clientes web MQTT de Daniel (Lab 07)
 */

// Genera un identificador de cliente único con prefijo y sufijo aleatorio
function generateClientId(prefix) {
  const randomSuffix = Math.random().toString(16).substring(2, 8);
  return `${prefix}_${randomSuffix}`;
}

// Formato de hora legible con milisegundos para auditoría
function formatTimestamp(d = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const millis = pad(d.getMilliseconds(), 3);
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`;
}

// Validación segura de JSON
function validateJson(str) {
  try {
    const parsed = JSON.parse(str);
    return { valid: true, parsed, error: null };
  } catch (err) {
    return { valid: false, parsed: null, error: err.message };
  }
}

// Agrega una entrada al registro en pantalla con renderizado seguro (sin innerHTML)
// y control estricto de límite para prevenir desbordamiento de memoria.
function appendSafeLog(container, { type = "info", meta = "", text = "" }, maxEntries = 50) {
  if (!container) return;

  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;

  const metaEl = document.createElement("div");
  metaEl.className = "log-meta";
  metaEl.textContent = meta;

  const payloadEl = document.createElement("div");
  payloadEl.className = "log-payload";
  payloadEl.textContent = text;

  entry.appendChild(metaEl);
  entry.appendChild(payloadEl);

  // Inserción al inicio (más reciente arriba)
  container.insertBefore(entry, container.firstChild);

  // Poda de entradas excedentes
  while (container.children.length > maxEntries) {
    container.removeChild(container.lastChild);
  }
}

// Actualiza el indicador visual del badge de estado
function updateStatusBadge(badgeEl, status, customText = null) {
  if (!badgeEl) return;
  badgeEl.className = `badge badge-${status.toLowerCase()}`;
  badgeEl.textContent = customText || status.toUpperCase();
}

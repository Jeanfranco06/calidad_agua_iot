# ENTREGA PARA DANIEL — LABORATORIO 08

**De:** Jeanfranco (preparación MySQL para autenticación/autorización)  
**Para:** Daniel (configuración del autenticador/autorizador MySQL en EMQX)  
**Fecha:** 15 de octubre de 2026  
**Objeto:** todos los datos técnicos necesarios para configurar EMQX 5.8 contra MySQL sin preguntar datos básicos. **La autenticación NO está activa: no se modificó EMQX.**

---

## A. DATOS DE CONEXIÓN (CONFIRMADO)

| Dato | Valor |
|---|---|
| Versión EMQX | 5.8.0 (`emqx/emqx:5.8.0`, contenedor `emqx_broker`) |
| Versión MySQL | 8.0.46 (contenedor `mysql_server`) |
| **Host MySQL desde EMQX** | **`mysql_server`** (alias `mysql`; red Docker `emqxnet`) |
| **Puerto MySQL desde EMQX** | **`3306`** |
| Host MySQL desde la máquina host (solo pruebas externas) | `localhost` |
| Puerto desde la máquina host | `3307` |
| Base | `emqx_db` |
| Usuario MySQL para EMQX | `emqx_user` |
| Contraseña MySQL | Definida en `docker-compose.yml` (no incluida aquí) |

> No uses `localhost:3307` desde la configuración de EMQX: EMQX y MySQL están en el mismo bridge y deben comunicarse por nombre de contenedor/servicio en el puerto interno.

## B. AUTENTICACIÓN — tabla y consulta (CONFIRMADO / PROPUESTA EMQX)

| Dato | Valor |
|---|---|
| Tabla | `emqx_db.mqtt_user` |
| Columnas | `id`, `username`, `password_hash`, `salt`, `is_superuser`, `enabled`, `created` |
| Clave de búsqueda | `UNIQUE(username)` |
| Algoritmo hash | **bcrypt** (`password_hash_algorithm.name = bcrypt`, sin salt externo) |
| Consulta para EMQX | `SELECT password_hash, salt, is_superuser FROM mqtt_user WHERE username = ${username} LIMIT 1` |

Configuración sugerida en EMQX Dashboard → Access Control → Authentication → Create → Password-Based → Backend: MySQL; server `mysql_server:3306`; database `emqx_db`; username `emqx_user`; password (del compose); la consulta y el algoritmo de la tabla.

## C. AUTORIZACIÓN — tabla y consulta (CONFIRMADO / PROPUESTA EMQX)

| Dato | Valor |
|---|---|
| Tabla | `emqx_db.mqtt_acl` |
| Columnas | `id`, `ipaddress`, `username`, `clientid`, `action`, `permission`, `topic`, `qos`, `retain` |
| Consulta para EMQX | `SELECT action, permission, topic FROM mqtt_acl WHERE username = ${username}` |

Dashboard → Access Control → Authorization → Create → Backend: MySQL (mismos datos de servidor/base/usuario).

## D. USUARIO MQTT DE PRUEBA (CONFIRMADO)

| Dato | Valor |
|---|---|
| Username | `lab08_jeanfranco` |
| is_superuser | 0 |
| enabled | 1 |
| Contraseña | **No persistida.** Solo existe el hash bcrypt en la BD. Para (re)generar: |

```bash
py -c "import bcrypt,secrets; p=secrets.token_urlsafe(14); print('PASSWORD:',p); print('HASH:',bcrypt.hashpw(p.encode(),bcrypt.gensalt(rounds=10)).decode())"
```

```sql
UPDATE emqx_db.mqtt_user SET password_hash='<HASH_GENERADO>' WHERE username='lab08_jeanfranco';
```

(Genera la contraseña, úsala en las pruebas de Alexis y actualiza el hash; no la escribas en archivos del repositorio.)

## E. REGLAS ACL DEL USUARIO DE PRUEBA (CONFIRMADO)

| Acción | Permiso | Tópico |
|---|---|---|
| publish | allow | `cistern/LAB08_TEST/telemetry` |
| subscribe | allow | `cistern/LAB08_TEST/#` |

## F. COMPORTAMIENTO ESPERADO (PROPUESTO — validar tras activar)

| Escenario | Resultado esperado |
|---|---|
| Username `lab08_jeanfranco` + contraseña correcta | Conexión aceptada; puede publicar en `cistern/LAB08_TEST/telemetry` y suscribirse bajo `cistern/LAB08_TEST/#`; recibe `permission_denied` en cualquier otro tópico (p. ej. telemetría real de otros dispositivos) |
| Username correcto + contraseña incorrecta | Conexión rechazada con error de autenticación (`not_authorized` / bad username or password) |
| Username inexistente | Conexión rechazada (una vez deshabilitada la autenticación anónima) |
| Conexiones anónimas (sin username) | Seguirán permitidas **mientras no se deshabilite** `allow_anonymous` ni se encadene el autenticador con deny_anonymous; **esto es intencional** para no romper el Laboratorio 07 |

## G. PRECAUCIONES (obligatorias)

1. **NO deshabilitar la autenticación anónima** hasta que Alexis valide con clientes autenticados y el equipo coordene: el simulador y los clientes del Lab 07 se conectan sin credenciales.
2. **NO modificar** listeners, tópicos, simulador, motor de reglas ni tablas de negocio (`dispositivos`, `telemetria`, `bitacora_ordenes_mqtt`).
3. Al crear el autenticador/autorizador MySQL en EMQX, estos se **encadenan** con el default (`allow_anonymous` sigue activo salvo que se apague explícitamente): un autenticador nuevo no corta el Lab 07 por sí solo; apagar `allow_anonymous` sí lo haría.
4. Prueba recomendada primero con el usuario `lab08_jeanfranco` y tópicos `LAB08_TEST`, sin tocar telemetría real.

## H. PENDIENTE DE VALIDACIÓN

1. Ejecución real de las consultas desde EMQX (solo Daniel/Alexis activan y prueban).
2. Comportamiento de la cadena de autenticación con `allow_anonymous=true` (esperado: anónimos siguen conectando; usuarios con credenciales válidas también).
3. QoS/retain a nivel de ACL (`mqtt_acl.qos/retain` en NULL = sin restricción) si se desea refinar.
4. Escalabilidad: índices ya presentes (`username` UNIQUE y `idx_username`); reevaluar con gran volumen de usuarios.

## I. ARCHIVOS DE APOYO

- `SQL_LAB08_JEANFRANCO.sql` — script idempotente con DDL e inserts (hash con placeholder).
- `CONTRATO_MYSQL_EMQX_LAB08.md` — contrato formal MySQL → EMQX.
- `MATRIZ_PRUEBAS_JEANFRANCO_LAB08.md` — pruebas P01–P12.
- `INFORME_JEANFRANCO_LAB08.md` — texto académico 5.1.2 / 5.1.3.

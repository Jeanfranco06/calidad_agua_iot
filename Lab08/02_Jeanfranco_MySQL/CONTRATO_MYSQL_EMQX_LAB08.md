# CONTRATO MYSQL → EMQX LAB 08

**Responsable:** Jeanfranco (etapa MySQL del Laboratorio 08)  
**Fecha:** 15 de octubre de 2026  
**Propósito:** dejar documentado el contrato entre MySQL y la futura configuración de autenticación/autorización de EMQX 5.8 a cargo de Daniel. **Este contrato NO implica que la autenticación esté activa en EMQX.**

---

## Servidor MySQL

| Elemento | Valor | Estado |
|---|---|---|
| Versión | MySQL 8.0.46 (Community Server, imagen `mysql:8.0`) | CONFIRMADO |
| Host desde máquina anfitriona | `localhost` (o `127.0.0.1`) | CONFIRMADO |
| Puerto desde host | `3307` | CONFIRMADO |
| Host desde red Docker (`emqxnet`) | `mysql_server` (alias de servicio: `mysql`) | CONFIRMADO |
| Puerto interno | `3306` | CONFIRMADO |
| Contenedor / servicio | `mysql_server` / `mysql` (docker-compose) | CONFIRMADO |
| Bind interno | `bind_address = *`, publicación host `0.0.0.0:3307` | CONFIRMADO |

## Base

| Elemento | Valor | Estado |
|---|---|---|
| Nombre | `emqx_db` | CONFIRMADO |
| Motivo de elección | Es la base del proyecto (`MYSQL_DATABASE` en docker-compose), propiedad de `emqx_user`, y concentra el esquema de negocio; un único punto de configuración para Daniel. El esquema `lab07_prep` (preparación del Laboratorio 07) queda **superseded sin eliminarse**. | CONFIRMADO |

## Usuario MySQL utilizado por EMQX

| Elemento | Valor |
|---|---|
| Username | `emqx_user` |
| Host permitido | `%` (creado por el contenedor MySQL; accesible desde la red Docker y desde el host) |
| Permisos | Todos sobre `emqx_db` (incluye `mqtt_user` y `mqtt_acl`) |
| Contraseña | **NO DOCUMENTADA** (definida en `docker-compose.yml`; no reproducir en entregables) |

> **CRÍTICO:** EMQX debe usar `mysql_server:3306` (o `mysql:3306`), **nunca** `localhost:3307`, porque EMQX y MySQL corren en contenedores de la misma red.

## Tabla de autenticación

| Elemento | Valor | Estado |
|---|---|---|
| Nombre | `mqtt_user` (en `emqx_db`) | CONFIRMADO |
| Columnas | `id`, `username`, `password_hash`, `salt`, `is_superuser`, `enabled`, `created` | CONFIRMADO |
| Clave de búsqueda | `username` (UNIQUE `mqtt_username`) | CONFIRMADO |
| Campo username | `username` | CONFIRMADO |
| Campo password_hash | `password_hash` (VARCHAR 255; hash bcrypt, prefijo `$2b$10$`) | CONFIRMADO |
| Campo salt | `salt` (NULL: bcrypt ya incorpora salt) | CONFIRMADO |
| Algoritmo | **bcrypt** | CONFIRMADO (hash real insertado y verificado) |
| Consulta SQL sugerida para EMQX | `SELECT password_hash, salt, is_superuser FROM mqtt_user WHERE username = ${username} LIMIT 1` | PROPUESTA (documentación oficial EMQX 5.x) |

## Tabla de autorización

| Elemento | Valor | Estado |
|---|---|---|
| Nombre | `mqtt_acl` (en `emqx_db`) | CONFIRMADO |
| Columnas | `id`, `ipaddress`, `username`, `clientid`, `action`, `permission`, `topic`, `qos`, `retain` | CONFIRMADO |
| Usuario | `username` (índice `idx_username`) | CONFIRMADO |
| Acción | `action ENUM('publish','subscribe','all')` | CONFIRMADO |
| Tópico | `topic` (soporta comodines MQTT) | CONFIRMADO |
| Permission | `permission ENUM('allow','deny')` | CONFIRMADO |
| Consulta SQL sugerida | `SELECT action, permission, topic FROM mqtt_acl WHERE username = ${username}` | PROPUESTA (documentación oficial EMQX 5.x) |

## Usuario MQTT de prueba

| Elemento | Valor | Estado |
|---|---|---|
| Username | `lab08_jeanfranco` | CONFIRMADO (exactamente 1 registro) |
| is_superuser | 0 | CONFIRMADO |
| enabled | 1 | CONFIRMADO |
| Contraseña | Generada localmente, **no persistida**; solo existe el hash bcrypt en BD | CONFIRMADO |

## Reglas ACL

| Permiso | Tópico | Estado |
|---|---|---|
| Publicación (allow) | `cistern/LAB08_TEST/telemetry` | CONFIRMADO |
| Suscripción (allow) | `cistern/LAB08_TEST/#` | CONFIRMADO |

Mínimo privilegio: sin permiso `#` global y sin permiso sobre telemetría real de otros dispositivos.

## Estado

| Componente | Estado |
|---|---|
| MySQL | CONFIRMADO |
| Base (`emqx_db`) | CONFIRMADO |
| Tabla usuarios (`mqtt_user`) | CONFIRMADO |
| Tabla ACL (`mqtt_acl`) | CONFIRMADO |
| Usuario (`lab08_jeanfranco`) | CONFIRMADO |
| ACL (2 reglas) | CONFIRMADO |
| Activación del autenticador/autorizador en EMQX | **PENDIENTE (tarea de Daniel; NO realizado en esta etapa)** |

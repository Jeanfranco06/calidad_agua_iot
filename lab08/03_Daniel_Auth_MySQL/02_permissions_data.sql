-- =============================================================================
-- PROYECTO: calidad_agua_iot
-- MÓDULO: Laboratorio 08 (Apartado Daniel) - Datos Iniciales y Reglas ACL
-- ARCHIVO: 02_permissions_data.sql
-- =============================================================================

USE emqx_db;

-- -----------------------------------------------------------------------------
-- 1. IDENTIDADES MQTT DE SERVICIO Y CLIENTES WEB (Authn)
-- Algoritmo: SHA-256 con salt (salt_position: "suffix")
-- Hash = SHA2(CONCAT(password, salt), 256)
--
-- NOTA DE SEGURIDAD: Los registros se insertan de forma idempotente.
-- Si el usuario ya existe, se preserva el registro sin alterar credenciales.
-- -----------------------------------------------------------------------------

-- 1.1 Publicador Web (Daniel)
INSERT INTO mqtt_user (username, password_hash, salt, is_superuser)
VALUES (
    'web_pub_daniel',
    -- Hash calculado como SHA2(CONCAT(password, salt), 256)
    'b7e6c4ddca36cefe85a6a12519bfdcda56847c2ba31fbaae7b29a242f36d6ea9',
    's4lt_pub_d4n13l_2026',
    0
)
ON DUPLICATE KEY UPDATE is_superuser = VALUES(is_superuser);

-- 1.2 Suscriptor Web (Daniel)
INSERT INTO mqtt_user (username, password_hash, salt, is_superuser)
VALUES (
    'web_sub_daniel',
    -- Hash calculado como SHA2(CONCAT(password, salt), 256)
    '5ce960e980dd3327d5300be1f5b0ebdf0297398188147dca08945cfd37e7a718',
    's4lt_sub_d4n13l_2026',
    0
)
ON DUPLICATE KEY UPDATE is_superuser = VALUES(is_superuser);

-- 1.3 Nodos Sensores Simulados (ESP32 Físico y Nodos Virtuales V1, V2, V3)
-- ALCANCE: Los hilos de simulación en iot_virtual_nodes comparten esta identidad
-- para conectarse al broker. La separación de privilegios se impone mediante reglas ACL.
INSERT INTO mqtt_user (username, password_hash, salt, is_superuser)
VALUES (
    'esp32_nodes',
    -- Hash calculado como SHA2(CONCAT(password, salt), 256)
    '238634ea8196152b1b3fbdb594ba7234a949e29f1b953d6ebef427429188e630',
    's4lt_n0d3s_3sp32_2026',
    0
)
ON DUPLICATE KEY UPDATE is_superuser = VALUES(is_superuser);

-- 1.4 Motor de Reglas Backend Offline
INSERT INTO mqtt_user (username, password_hash, salt, is_superuser)
VALUES (
    'backend_rules',
    -- Hash calculado como SHA2(CONCAT(password, salt), 256)
    '83188d22dfb420067646a782422709ffaa2276527581e2ebdddbfa6bc2391ce4',
    's4lt_b4ck3nd_rul3s_2026',
    0
)
ON DUPLICATE KEY UPDATE is_superuser = VALUES(is_superuser);


-- -----------------------------------------------------------------------------
-- 2. LISTAS DE CONTROL DE ACCESO (Authz / ACL)
-- Principio de Mínimo Privilegio (POLP - Principle of Least Privilege)
-- Idempotencia garantizada por la restricción UNIQUE (username, clientid, action, topic)
-- -----------------------------------------------------------------------------

-- 2.1 Reglas para Publicador Web: Únicamente publicar en el tópico de prueba de laboratorio
INSERT INTO mqtt_acl (username, clientid, action, permission, topic)
VALUES ('web_pub_daniel', '', 'publish', 'allow', 'cistern/lab07/prueba')
ON DUPLICATE KEY UPDATE permission = VALUES(permission);

-- 2.2 Reglas para Suscriptor Web: Suscribirse al tópico de prueba y a telemetría general
INSERT INTO mqtt_acl (username, clientid, action, permission, topic)
VALUES 
    ('web_sub_daniel', '', 'subscribe', 'allow', 'cistern/lab07/prueba'),
    ('web_sub_daniel', '', 'subscribe', 'allow', 'cistern/+/telemetry')
ON DUPLICATE KEY UPDATE permission = VALUES(permission);

-- 2.3 Reglas para Nodos Sensores: Publicar en su propio canal de telemetría y recibir comandos
INSERT INTO mqtt_acl (username, clientid, action, permission, topic)
VALUES 
    ('esp32_nodes', '', 'publish', 'allow', 'cistern/+/telemetry'),
    ('esp32_nodes', '', 'subscribe', 'allow', 'cistern/+/commands')
ON DUPLICATE KEY UPDATE permission = VALUES(permission);

-- 2.4 Reglas para Motor de Reglas Backend: Escuchar toda la telemetría y emitir órdenes
INSERT INTO mqtt_acl (username, clientid, action, permission, topic)
VALUES 
    ('backend_rules', '', 'subscribe', 'allow', 'cistern/+/telemetry'),
    ('backend_rules', '', 'publish', 'allow', 'cistern/+/commands')
ON DUPLICATE KEY UPDATE permission = VALUES(permission);

-- 2.5 Regla de Denegación por Defecto (Default Deny Fallback)
-- Denegar cualquier otra acción sobre cualquier tópico no autorizado expresamente
INSERT INTO mqtt_acl (username, clientid, action, permission, topic)
VALUES ('$all', '', 'all', 'deny', '#')
ON DUPLICATE KEY UPDATE permission = VALUES(permission);

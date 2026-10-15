-- =====================================================================
-- LABORATORIO 08 - JEANFRANCO
-- Preparacion de MySQL para autenticacion/autorizacion de EMQX 5.8
-- Proyecto: Monitoreo y prediccion de turbidez en tanques de
--           almacenamiento de agua (UNT) - IoT
-- Fecha: 2026-10-15
-- Servidor: MySQL 8.0.46 (contenedor mysql_server, host:3307 -> 3306)
-- Base: emqx_db (base del proyecto; propiedad de emqx_user)
--
-- IMPORTANTE:
--   * Este script NO modifica EMQX. Solo prepara MySQL.
--   * NO contiene contraseñas reales: el hash del usuario de prueba
--     usa el placeholder <TEST_PASSWORD_HASH>. Daniel/Alexis deben
--     generar un hash bcrypt real (ver comandos al final).
--   * Idempotente: puede ejecutarse de nuevo sin duplicar registros
--     ni romper tablas. PROHIBIDO agregar DROP sobre tablas existentes.
--   * No toca las tablas de negocio: dispositivos, telemetria,
--     bitacora_ordenes_mqtt.
-- =====================================================================

USE emqx_db;

-- ---------------------------------------------------------------------
-- 1) Tabla de autenticacion (usuarios MQTT)
--    Compatible con el autenticador MySQL de EMQX 5.8:
--    query: SELECT password_hash, salt, is_superuser FROM mqtt_user
--           WHERE username = ${username} LIMIT 1
--    password_hash_algorithm: bcrypt (sin salt externo; columna salt NULL)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mqtt_user (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(100) DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  salt          VARCHAR(64)  DEFAULT NULL,
  is_superuser  TINYINT(1)   DEFAULT 0,
  enabled       TINYINT(1)   DEFAULT 1,
  created       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY mqtt_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 2) Tabla de autorizacion (reglas ACL)
--    Compatible con el autorizador MySQL de EMQX 5.8:
--    query: SELECT action, permission, topic FROM mqtt_acl
--           WHERE username = ${username}
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mqtt_acl (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ipaddress  VARCHAR(60)  NOT NULL DEFAULT '',
  username   VARCHAR(255) NOT NULL DEFAULT '',
  clientid   VARCHAR(255) NOT NULL DEFAULT '',
  action     ENUM('publish','subscribe','all') NOT NULL,
  permission ENUM('allow','deny') NOT NULL,
  topic      VARCHAR(255) NOT NULL DEFAULT '',
  qos        TINYINT(1)   DEFAULT NULL,
  retain     TINYINT(1)   DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 3) Usuario MQTT de prueba (minimo privilegio; NO root/admin/emqx_user)
--    Idempotente: solo inserta si el username no existe.
-- ---------------------------------------------------------------------
INSERT INTO mqtt_user (username, password_hash, salt, is_superuser, enabled)
SELECT 'lab08_jeanfranco', '<TEST_PASSWORD_HASH>', NULL, 0, 1
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT username FROM mqtt_user) t
  WHERE t.username = 'lab08_jeanfranco'
);

-- ---------------------------------------------------------------------
-- 4) Reglas ACL de prueba (minimo privilegio; sin '#' global)
--    - publicar unicamente en cistern/LAB08_TEST/telemetry
--    - suscribirse unicamente bajo cistern/LAB08_TEST/#
--    Idempotentes por (username, action, topic).
-- ---------------------------------------------------------------------
INSERT INTO mqtt_acl (ipaddress, username, clientid, action, permission, topic, qos, retain)
SELECT '', 'lab08_jeanfranco', '', 'publish', 'allow', 'cistern/LAB08_TEST/telemetry', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT username, action, topic FROM mqtt_acl) t
  WHERE t.username = 'lab08_jeanfranco'
    AND t.action = 'publish'
    AND t.topic  = 'cistern/LAB08_TEST/telemetry'
);

INSERT INTO mqtt_acl (ipaddress, username, clientid, action, permission, topic, qos, retain)
SELECT '', 'lab08_jeanfranco', '', 'subscribe', 'allow', 'cistern/LAB08_TEST/#', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT username, action, topic FROM mqtt_acl) t
  WHERE t.username = 'lab08_jeanfranco'
    AND t.action = 'subscribe'
    AND t.topic  = 'cistern/LAB08_TEST/#'
);

-- ---------------------------------------------------------------------
-- 5) Consultas de verificacion
-- ---------------------------------------------------------------------
SELECT id, username,
       CONCAT(LEFT(password_hash, 12), '...[OCULTO]') AS hash_resumido,
       salt, is_superuser, enabled, created
FROM mqtt_user
WHERE username = 'lab08_jeanfranco';

SELECT id, username, action, permission, topic
FROM mqtt_acl
WHERE username = 'lab08_jeanfranco'
ORDER BY id;

SELECT (SELECT COUNT(*) FROM mqtt_user WHERE username = 'lab08_jeanfranco') AS usuarios_lab08,
       (SELECT COUNT(*) FROM mqtt_acl   WHERE username = 'lab08_jeanfranco') AS reglas_lab08,
       (SELECT COUNT(*) FROM (SELECT username FROM mqtt_user GROUP BY username HAVING COUNT(*) > 1) d) AS duplicados;

-- ---------------------------------------------------------------------
-- 6) Generacion del hash bcrypt real (ejecutar en el equipo local;
--    la contraseña NO debe escribirse en archivos del repositorio)
--
--    py -c "import bcrypt,secrets; p=secrets.token_urlsafe(14); \
--    print('PASSWORD:',p); print('HASH:',bcrypt.hashpw(p.encode(),bcrypt.gensalt(rounds=10)).decode())"
--
--    Luego:
--    UPDATE mqtt_user SET password_hash='<HASH_GENERADO>'
--    WHERE username='lab08_jeanfranco';
-- =====================================================================

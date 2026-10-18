-- =============================================================================
-- PROYECTO: calidad_agua_iot
-- MÓDULO: Laboratorio 08 (Apartado Daniel) - Consultas de Integración EMQX 5.8
-- ARCHIVO: 03_emqx_queries.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CONSULTA DE AUTENTICACIÓN (Authn - password_based:mysql)
-- Documentación: https://docs.emqx.com/en/emqx/v5.8/access-control/authn/mysql.html
--
-- Parámetros sustituidos por el broker:
--   ${username} -> Identificador de usuario proporcionado por el cliente MQTT en el CONNECT
--
-- Formato de Hash previsto: SHA-256 con salt al final (salt_position: "suffix")
-- Cálculo de verificación del broker: SHA256(password + salt) == password_hash
-- -----------------------------------------------------------------------------
SELECT password_hash, salt, is_superuser 
FROM mqtt_user 
WHERE username = ${username} 
LIMIT 1;


-- -----------------------------------------------------------------------------
-- 2. CONSULTA DE AUTORIZACIÓN / REGLAS ACL (Authz - authz:mysql)
-- Documentación: https://docs.emqx.com/en/emqx/v5.8/access-control/authz/mysql.html
--
-- Parámetros sustituidos por el broker:
--   ${username} -> Nombre de usuario del cliente autenticado
--   ${clientid} -> Identificador de cliente (Client ID) en el paquete MQTT
--
-- Evaluación de Reglas:
--   EMQX evalúa las reglas devueltas en orden: si coincide acción y tópico, aplica
--   el permiso (allow / deny). Si ninguna regla coincide, aplica la directiva
--   global 'no_match: deny'.
-- -----------------------------------------------------------------------------
SELECT action, permission, topic 
FROM mqtt_acl 
WHERE (username = ${username} OR username = '$all')
  AND (clientid IS NULL OR clientid = '' OR clientid = ${clientid})
ORDER BY id ASC;

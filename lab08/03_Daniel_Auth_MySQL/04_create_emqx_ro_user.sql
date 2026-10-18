-- =============================================================================
-- PROYECTO: calidad_agua_iot
-- MÓDULO: Laboratorio 08 (Apartado Daniel) - Cuenta de Consulta para EMQX
-- ARCHIVO: 04_create_emqx_ro_user.sql
-- =============================================================================

-- Creación de la cuenta de base de datos dedicada exclusivamente para que el broker
-- EMQX consulte credenciales y listas de control de acceso.
-- Principio de mínimo privilegio: Únicamente permiso SELECT sobre las 2 tablas necesarias.
-- No posee permisos sobre telemetría, dispositivos ni bitácora de órdenes.

-- NOTA DE SEGURIDAD: En el script de aprovisionamiento automatizado, la contraseña
-- se inyecta desde la variable de entorno EMQX_RO_DB_PASS (no versionada).
-- Plantilla de referencia:

-- CREATE USER IF NOT EXISTS 'emqx_ro_user'@'%' IDENTIFIED BY 'CAMBIAR_EN_PRODUCCION';

GRANT SELECT ON emqx_db.mqtt_user TO 'emqx_ro_user'@'%';
GRANT SELECT ON emqx_db.mqtt_acl TO 'emqx_ro_user'@'%';

-- Revocar cualquier privilegio de escritura o modificación estructural
REVOKE INSERT, UPDATE, DELETE, DROP, ALTER, CREATE ON emqx_db.mqtt_user FROM 'emqx_ro_user'@'%';
REVOKE INSERT, UPDATE, DELETE, DROP, ALTER, CREATE ON emqx_db.mqtt_acl FROM 'emqx_ro_user'@'%';

FLUSH PRIVILEGES;

-- =============================================================================
-- PROYECTO: calidad_agua_iot
-- MÓDULO: Laboratorio 08 (Apartado Daniel) - Autenticación y Autorización MySQL
-- BROKER: EMQX 5.8.0 Open Source
-- ARCHIVO: 01_schema_auth.sql (Estructura DDL)
-- =============================================================================

USE emqx_db;

-- 1. Tabla de Autenticación de Usuarios MQTT (Authn)
-- Compatible con EMQX 5.8 (password_based:mysql)
-- Documentación oficial: https://docs.emqx.com/en/emqx/v5.8/access-control/authn/mysql.html
CREATE TABLE IF NOT EXISTS mqtt_user (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(64) DEFAULT '',
    is_superuser TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_mqtt_user_username UNIQUE (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tabla de Lista de Control de Acceso MQTT (Authz / ACL)
-- Compatible con EMQX 5.8 (authz:mysql)
-- Documentación oficial: https://docs.emqx.com/en/emqx/v5.8/access-control/authz/mysql.html
CREATE TABLE IF NOT EXISTS mqtt_acl (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    clientid VARCHAR(100) DEFAULT '',
    action ENUM('publish', 'subscribe', 'all') NOT NULL,
    permission ENUM('allow', 'deny') NOT NULL,
    topic VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_acl_rule UNIQUE (username, clientid, action, topic),
    INDEX idx_acl_lookup (username, clientid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

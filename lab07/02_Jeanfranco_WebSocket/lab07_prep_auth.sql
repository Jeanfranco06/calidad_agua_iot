CREATE DATABASE IF NOT EXISTS lab07_prep CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lab07_prep;

CREATE TABLE IF NOT EXISTS mqtt_auth_user (
    username VARCHAR(64) NOT NULL PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(64) DEFAULT NULL,
    is_superuser TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    note VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mqtt_auth_acl (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    login VARCHAR(64) NOT NULL,
    action ENUM('publish','subscribe','all') NOT NULL DEFAULT 'all',
    permission ENUM('allow','deny') NOT NULL DEFAULT 'allow',
    topic VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE INDEX idx_acl_login ON mqtt_auth_acl(login);

INSERT INTO mqtt_auth_user (username, password_hash, is_superuser, note) VALUES
('web_pub_daniel', 'PLACEHOLDER_HASH_NO_ACTIVO', 0, 'Usuario previsto para publicacion.php (hash pendiente de generar con emqx ctl)'),
('web_sub_daniel', 'PLACEHOLDER_HASH_NO_ACTIVO', 0, 'Usuario previsto para suscritor.php (hash pendiente de generar con emqx ctl)'),
('lab07_jeanfranco_sub', 'PLACEHOLDER_HASH_NO_ACTIVO', 0, 'Cliente de prueba WebSocket Lab07 (suscriptor)'),
('lab07_jeanfranco_pub', 'PLACEHOLDER_HASH_NO_ACTIVO', 0, 'Cliente de prueba WebSocket Lab07 (publicador)')
ON DUPLICATE KEY UPDATE note=VALUES(note);

INSERT INTO mqtt_auth_acl (login, action, permission, topic) VALUES
('web_pub_daniel', 'publish', 'allow', 'cistern/lab07/prueba'),
('web_sub_daniel', 'subscribe', 'allow', 'cistern/lab07/prueba'),
('web_sub_daniel', 'subscribe', 'allow', 'cistern/+/telemetry'),
('web_sub_daniel', 'publish', 'deny', 'cistern/+/telemetry'),
('lab07_jeanfranco_sub', 'subscribe', 'allow', 'cistern/lab07/prueba'),
('lab07_jeanfranco_pub', 'publish', 'allow', 'cistern/lab07/prueba');

SELECT 'AUTH_USERS' AS tabla, COUNT(*) AS registros FROM mqtt_auth_user
UNION ALL
SELECT 'ACL_RULES', COUNT(*) FROM mqtt_auth_acl;

SELECT username, is_superuser, note FROM mqtt_auth_user ORDER BY username;
SELECT login, action, permission, topic FROM mqtt_auth_acl ORDER BY id;

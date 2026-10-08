-- Creación de la Base de Datos
CREATE DATABASE IF NOT EXISTS emqx_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE emqx_db;

-- 1. Tabla de Dispositivos (Catálogo Ciberfísico)
CREATE TABLE IF NOT EXISTS dispositivos (
    id_dispositivo VARCHAR(50) NOT NULL PRIMARY KEY,
    nombre_identificador VARCHAR(100) NOT NULL,
    ubicacion VARCHAR(150) NOT NULL,
    tipo_nodo ENUM('FISICO_REAL', 'VIRTUAL_DOCKER') NOT NULL,
    estado_operativo ENUM('ACTIVO', 'STANDBY', 'MANTENIMIENTO') DEFAULT 'ACTIVO',
    creado_el TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Tabla de Telemetría (Series Temporales Validadas)
CREATE TABLE IF NOT EXISTS telemetria (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    id_dispositivo VARCHAR(50) NOT NULL,
    temperatura DECIMAL(5,2) NOT NULL,
    turbidez_ntu DECIMAL(6,2) NOT NULL,
    voltaje_sensor DECIMAL(4,3) NOT NULL,
    estado_alerta ENUM('NORMAL', 'PRECAUCION', 'ALERTA') DEFAULT 'NORMAL',
    fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dispositivo_telemetria FOREIGN KEY (id_dispositivo) 
        REFERENCES dispositivos(id_dispositivo) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. Tabla de Bitácora de Órdenes MQTT (Interacción Bidireccional)
CREATE TABLE IF NOT EXISTS bitacora_ordenes_mqtt (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    id_dispositivo VARCHAR(50) NOT NULL,
    orden_enviada VARCHAR(50) NOT NULL,
    motivo VARCHAR(255) NOT NULL,
    fecha_emision TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dispositivo_ordenes FOREIGN KEY (id_dispositivo) 
        REFERENCES dispositivos(id_dispositivo) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Poblamiento Inicial de Nodos
INSERT INTO dispositivos (id_dispositivo, nombre_identificador, ubicacion, tipo_nodo, estado_operativo) VALUES
('ESP32_FISICO_UNT', 'Nodo Base Físico ESP32', 'Cisterna Comedor UNT', 'FISICO_REAL', 'ACTIVO'),
('ESP32_V1_BLOQUE_A', 'Cisterna Edificio Bloque A', 'Sótano Bloque A', 'VIRTUAL_DOCKER', 'ACTIVO'),
('ESP32_V2_BLOQUE_B', 'Cisterna Edificio Bloque B', 'Sótano Bloque B', 'VIRTUAL_DOCKER', 'ACTIVO'),
('ESP32_V3_INCIDENTE', 'Tanque Elevado Comedor', 'Azotea Comedor UNT', 'VIRTUAL_DOCKER', 'ACTIVO')
ON DUPLICATE KEY UPDATE nombre_identificador=VALUES(nombre_identificador);
-- =====================================================================
-- MIGRACIÓN INCREMENTAL: INTEGRACIÓN DE HARDWARE FÍSICO ESP32
-- =====================================================================
-- Base de datos: emqx_db
-- Objetivo: Añadir soporte para lecturas analógicas brutas (ADC),
--           bandera de calibración en laboratorio y procedencia física,
--           manteniendo 100% de compatibilidad con los nodos virtuales V1, V2, V3.
-- =====================================================================

USE emqx_db;

-- 1. Asegurar catálogo de dispositivos para nodos físicos
INSERT INTO dispositivos (id_dispositivo, nombre_identificador, ubicacion, tipo_nodo, estado_operativo)
VALUES 
    ('ESP32_FISICO_UNT', 'Nodo Base Físico ESP32 (TS-300B + DS18B20)', 'Cisterna Comedor UNT', 'FISICO_REAL', 'ACTIVO'),
    ('ESP32_FISICO_REAL', 'Prototipo Físico ESP32 DevKit V1', 'Laboratorio de Pruebas IoT', 'FISICO_REAL', 'ACTIVO')
ON DUPLICATE KEY UPDATE 
    tipo_nodo = VALUES(tipo_nodo),
    estado_operativo = 'ACTIVO';

-- 2. Modificaciones incrementales seguras en la tabla telemetria
-- Procedimiento para agregar columnas solo si no existen (idempotente)
DELIMITER $$

CREATE PROCEDURE IF NOT EXISTS migrar_telemetria_esp32_fisico()
BEGIN
    -- Columna adc_raw
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = 'emqx_db' AND TABLE_NAME = 'telemetria' AND COLUMN_NAME = 'adc_raw'
    ) THEN
        ALTER TABLE telemetria ADD COLUMN adc_raw INT NULL 
            COMMENT 'Lectura cruda ADC GPIO 34 (0-4095) del sensor TS-300B';
    END IF;

    -- Columna turbidez_calibrada
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = 'emqx_db' AND TABLE_NAME = 'telemetria' AND COLUMN_NAME = 'turbidez_calibrada'
    ) THEN
        ALTER TABLE telemetria ADD COLUMN turbidez_calibrada TINYINT(1) DEFAULT 0 
            COMMENT '0 = Estimacion preliminar teorica; 1 = Calibrada con estandares NTU';
    END IF;

    -- Columna procedencia
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = 'emqx_db' AND TABLE_NAME = 'telemetria' AND COLUMN_NAME = 'procedencia'
    ) THEN
        ALTER TABLE telemetria ADD COLUMN procedencia ENUM('FISICO_REAL', 'VIRTUAL_DOCKER') DEFAULT 'FISICO_REAL' 
            COMMENT 'Origen ciberfisico del registro';
    END IF;
END$$

DELIMITER ;

CALL migrar_telemetria_esp32_fisico();
DROP PROCEDURE IF EXISTS migrar_telemetria_esp32_fisico;

-- 3. Vistas analíticas para inspección en phpMyAdmin o consultas SQL
CREATE OR REPLACE VIEW v_ultimas_lecturas_fisicas AS
SELECT 
    t.id,
    t.id_dispositivo,
    d.nombre_identificador,
    d.ubicacion,
    t.temperatura AS temp_celsius,
    t.turbidez_ntu,
    t.voltaje_sensor AS sensor_volts,
    t.adc_raw,
    CASE 
        WHEN t.turbidez_calibrada = 1 THEN 'CALIBRADA (NTU)'
        ELSE 'ESTIMACION PRELIMINAR'
    END AS estado_calibracion,
    t.estado_alerta,
    t.fecha_hora
FROM telemetria t
JOIN dispositivos d ON t.id_dispositivo = d.id_dispositivo
WHERE d.tipo_nodo = 'FISICO_REAL' OR t.procedencia = 'FISICO_REAL'
ORDER BY t.fecha_hora DESC
LIMIT 50;

CREATE OR REPLACE VIEW v_resumen_dispositivos AS
SELECT 
    d.id_dispositivo,
    d.nombre_identificador,
    d.tipo_nodo,
    d.estado_operativo,
    COUNT(t.id) AS total_lecturas,
    ROUND(AVG(t.temperatura), 2) AS temp_promedio,
    ROUND(AVG(t.turbidez_ntu), 2) AS turbidez_promedio,
    ROUND(AVG(t.voltaje_sensor), 3) AS voltaje_promedio,
    MAX(t.fecha_hora) AS ultima_lectura
FROM dispositivos d
LEFT JOIN telemetria t ON d.id_dispositivo = t.id_dispositivo
GROUP BY d.id_dispositivo, d.nombre_identificador, d.tipo_nodo, d.estado_operativo;

CREATE OR REPLACE VIEW v_auditoria_incidentes AS
SELECT 
    b.id,
    b.id_dispositivo,
    d.tipo_nodo,
    b.orden_enviada,
    b.motivo,
    b.fecha_emision
FROM bitacora_ordenes_mqtt b
LEFT JOIN dispositivos d ON b.id_dispositivo = d.id_dispositivo
ORDER BY b.fecha_emision DESC
LIMIT 50;

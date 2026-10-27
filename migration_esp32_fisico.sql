-- =====================================================================
-- MIGRACIÓN INCREMENTAL: INTEGRACIÓN CIBERFÍSICA ESP32 DEFINITIVA
-- =====================================================================
-- Base de datos: emqx_db
-- Objetivo: 
--   1. Permitir turbidez_ntu NULL para lecturas físicas no calibradas.
--   2. Agregar columna turbidez_estimada para modelos teóricos preliminares.
--   3. Agregar columna adc_raw (0-4095) y procedencia para trazabilidad científica.
--   4. Crear vistas para investigación y exportación de datasets sin contaminación.
-- =====================================================================

USE emqx_db;

-- 1. Actualizar catálogo oficial de dispositivos hacia entorno doméstico
INSERT INTO dispositivos (id_dispositivo, nombre_identificador, ubicacion, tipo_nodo, estado_operativo)
VALUES 
    ('ESP32_FISICO_UNT', 'Sensor Cisterna Hogar (ESP32 Físico)', 'Cisterna Hogar', 'FISICO_REAL', 'ACTIVO'),
    ('ESP32_FISICO_HOGAR', 'Sensor Tanque Residencial (ESP32 DevKit V1)', 'Cisterna Hogar', 'FISICO_REAL', 'ACTIVO')
ON DUPLICATE KEY UPDATE 
    nombre_identificador = VALUES(nombre_identificador),
    ubicacion = VALUES(ubicacion),
    tipo_nodo = 'FISICO_REAL',
    estado_operativo = 'ACTIVO';

-- 2. Modificaciones incrementales seguras en la tabla telemetria
DELIMITER $$

CREATE PROCEDURE IF NOT EXISTS migrar_telemetria_esp32_definitiva()
BEGIN
    -- Permitir que turbidez_ntu acepte NULL (indispensable para datos no calibrados)
    ALTER TABLE telemetria MODIFY COLUMN turbidez_ntu DECIMAL(6,2) NULL DEFAULT NULL
        COMMENT 'Turbidez certificada en NTU (NULL si no cuenta con calibracion experimental)';

    -- Columna adc_raw
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = 'emqx_db' AND TABLE_NAME = 'telemetria' AND COLUMN_NAME = 'adc_raw'
    ) THEN
        ALTER TABLE telemetria ADD COLUMN adc_raw INT NULL 
            COMMENT 'Lectura cruda ADC GPIO 34 (0-4095) del sensor TS-300B';
    END IF;

    -- Columna turbidez_estimada
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = 'emqx_db' AND TABLE_NAME = 'telemetria' AND COLUMN_NAME = 'turbidez_estimada'
    ) THEN
        ALTER TABLE telemetria ADD COLUMN turbidez_estimada DECIMAL(6,2) NULL 
            COMMENT 'Estimacion preliminar teorica mediante funcion inversa del divisor';
    END IF;

    -- Columna turbidez_calibrada
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = 'emqx_db' AND TABLE_NAME = 'telemetria' AND COLUMN_NAME = 'turbidez_calibrada'
    ) THEN
        ALTER TABLE telemetria ADD COLUMN turbidez_calibrada TINYINT(1) DEFAULT 0 
            COMMENT '0 = No calibrada en laboratorio; 1 = Calibrada con estandares formazina';
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

CALL migrar_telemetria_esp32_definitiva();
DROP PROCEDURE IF EXISTS migrar_telemetria_esp32_definitiva;

-- 3. Vista de inspección operativa en phpMyAdmin
CREATE OR REPLACE VIEW v_ultimas_lecturas_fisicas AS
SELECT 
    t.id,
    t.id_dispositivo,
    d.nombre_identificador,
    d.ubicacion,
    t.temperatura AS temp_celsius,
    t.turbidez_ntu AS ntu_validada,
    t.turbidez_estimada AS ntu_estimada_preliminar,
    t.voltaje_sensor AS sensor_volts,
    t.adc_raw,
    CASE 
        WHEN t.turbidez_calibrada = 1 THEN 'CERTIFICADA (NTU)'
        ELSE 'NO CALIBRADA (VOLTAJE/ADC)'
    END AS estado_calibracion,
    t.estado_alerta,
    t.fecha_hora
FROM telemetria t
JOIN dispositivos d ON t.id_dispositivo = d.id_dispositivo
WHERE d.tipo_nodo = 'FISICO_REAL' OR t.procedencia = 'FISICO_REAL'
ORDER BY t.id DESC
LIMIT 50;

-- 4. Vista de auditoría histórica: clasifica registros sintéticos antiguos vs físicos
CREATE OR REPLACE VIEW v_auditoria_historica_fisica AS
SELECT 
    t.id,
    t.id_dispositivo,
    t.temperatura,
    t.turbidez_ntu,
    t.turbidez_estimada,
    t.voltaje_sensor,
    t.adc_raw,
    t.turbidez_calibrada,
    t.procedencia,
    t.fecha_hora,
    CASE 
        WHEN t.id < 40940 THEN 'SINTETICO_SIMULADOR_ANTIGUO'
        WHEN t.adc_raw IS NULL AND t.turbidez_ntu IS NOT NULL THEN 'FISICO_PRELIMINAR_TRANSITORIO'
        ELSE 'FISICO_DEFINITIVO_CIENTIFICO'
    END AS categoria_auditoria
FROM telemetria t
WHERE t.id_dispositivo IN ('ESP32_FISICO_UNT', 'ESP32_FISICO_HOGAR')
ORDER BY t.id DESC;

-- 5. Dataset de entrenamiento exportable para modelos de regresión y artículo científico
CREATE OR REPLACE VIEW v_dataset_regresion_cientifica AS
SELECT 
    t.id AS sample_id,
    t.id_dispositivo AS device_id,
    d.ubicacion AS location,
    t.fecha_hora AS timestamp_utc,
    t.adc_raw AS predictor_adc_raw,
    t.voltaje_sensor AS predictor_sensor_volts,
    t.temperatura AS predictor_temp_celsius,
    t.turbidez_estimada AS target_ntu_theoretical,
    t.turbidez_ntu AS target_ntu_ground_truth,
    t.turbidez_calibrada AS is_calibrated,
    t.procedencia AS data_source
FROM telemetria t
JOIN dispositivos d ON t.id_dispositivo = d.id_dispositivo
WHERE t.id >= 40940
ORDER BY t.id ASC;

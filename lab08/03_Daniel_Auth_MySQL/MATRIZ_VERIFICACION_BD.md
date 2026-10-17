# MATRIZ DE VERIFICACIÓN DE BASE DE DATOS — LABORATORIO 08 (APARTADO DANIEL)

**Proyecto:** *Monitoreo y predicción de turbidez en tanques de almacenamiento de agua mediante una arquitectura IoT y modelos de regresión*  
**Curso:** Internet de las Cosas — Universidad Nacional de Trujillo  
**Responsable:** Daniel  
**Entorno Evaluado:** MySQL 8.0 (`mysql_server`, base de datos `emqx_db`)  
**Fecha de Ejecución:** 17 de Octubre de 2026  

---

## 1. Resumen de Verificaciones

Se auditó de manera exhaustiva la preparación de la base de datos relacional para dar soporte a la autenticación y autorización de EMQX 5.8.0. La totalidad de las comprobaciones de base de datos resultaron **APROBADAS (10/10)**, garantizando que el entorno relacional se encuentra listo para la posterior integración del broker.

| ID | Verificación Realizada | Objetivo Técnico | Resultado Esperado | Resultado Observado | Estado |
|:---:|---|---|---|---|:---:|
| **V01** | Compatibilidad DDL | Comprobar tipos de campo requeridos por EMQX 5.8 | Tablas `mqtt_user` y `mqtt_acl` creadas con columnas y tipos correctos | Columnas `username`, `password_hash`, `salt`, `action`, `permission`, `topic` conformes | **APROBADA** |
| **V02** | Población de Identidades | Verificar creación de las 4 identidades operativas | 4 usuarios registrados sin superusuarios | `web_pub_daniel`, `web_sub_daniel`, `esp32_nodes`, `backend_rules` creados (`is_superuser=0`) | **APROBADA** |
| **V03** | Idempotencia | Re-ejecutar scripts para validar ausencia de duplicados | Exactamente 4 usuarios y 8 reglas ACL tras múltiples ejecuciones | 4 usuarios y 8 reglas ACL confirmados; 0 duplicados | **APROBADA** |
| **V04** | Consultas Authn/Authz | Ejecutar las consultas exactas de EMQX con valores de prueba | Retorno de credenciales y permisos correspondientes | `web_pub_daniel` devuelve hash/salt válidos y regla `publish allow cistern/lab07/prueba` | **APROBADA** |
| **V05** | Usuario Inexistente | Consultar credenciales de un usuario no registrado | Conjunto vacío (0 filas) para rechazo en broker | `SELECT ... WHERE username = 'usuario_inexistente'` devolvió 0 filas | **APROBADA** |
| **V06** | Privilegios de `emqx_ro_user` | Auditar privilegios efectivos de la cuenta de consulta | Únicamente `SELECT` sobre `mqtt_user` y `mqtt_acl` | `SHOW GRANTS` confirma `SELECT` en las 2 tablas y `USAGE` global | **APROBADA** |
| **V07** | Bloqueo de Escritura | Intentar inserción maliciosa con `emqx_ro_user` | Rechazo inmediato con error de privilegios insuficientes | `ERROR 1142 (42000): INSERT command denied to user 'emqx_ro_user'` | **APROBADA** |
| **V08** | Integridad Operativa | Comprobar tablas preexistentes y flujo telemétrico | Preservación de catálogo y crecimiento de series temporales | `dispositivos` (4), `bitacora` (2), `telemetria` aumentó de 12,828 a >13,360 | **APROBADA** |
| **V09** | Estabilidad del Stack | Verificar estado de los 5 contenedores Docker | Todos los servicios en estado `Up` continuo | `emqx`, `mysql`, `phpmyadmin`, `virtual_nodes`, `web_clients` ininterrumpidos | **APROBADA** |
| **V10** | Protección de Secretos | Auditar exclusión de respaldos y archivos sensibles | Reglas en `.gitignore` validadas con `git check-ignore` | `backups/` y archivos `.env` ignorados por git; 0 secretos en el repositorio | **APROBADA** |

---

## 2. Detalle de las Verificaciones

### V01 — Compatibilidad de Esquema DDL
- **Comando:** `DESCRIBE mqtt_user; DESCRIBE mqtt_acl;`
- **Campos verificados en `mqtt_user`:** `id (int)`, `username (varchar 100, UNIQUE)`, `password_hash (varchar 255)`, `salt (varchar 64)`, `is_superuser (tinyint 1)`.
- **Campos verificados en `mqtt_acl`:** `id (int)`, `username (varchar 100)`, `clientid (varchar 100)`, `action (enum)`, `permission (enum)`, `topic (varchar 255)`.
- **Evaluación:** Plenamente compatible con las especificaciones de EMQX 5.8 para backends MySQL.

### V02 — Existencia de Identidades y Reglas Mínimas
- **Comando:**  
  `SELECT id, username, is_superuser FROM mqtt_user;`  
  `SELECT id, username, clientid, action, permission, topic FROM mqtt_acl;`
- **Salida:**
  ```text
  --- mqtt_user ---
  1  web_pub_daniel   0
  2  web_sub_daniel   0
  3  esp32_nodes      0
  4  backend_rules    0

  --- mqtt_acl ---
  1  web_pub_daniel    publish    allow  cistern/lab07/prueba
  2  web_sub_daniel    subscribe  allow  cistern/lab07/prueba
  3  web_sub_daniel    subscribe  allow  cistern/+/telemetry
  4  esp32_nodes       publish    allow  cistern/+/telemetry
  5  esp32_nodes       subscribe  allow  cistern/+/commands
  6  backend_rules     subscribe  allow  cistern/+/telemetry
  7  backend_rules     publish    allow  cistern/+/commands
  8  $all              all        deny   #
  ```
- **Evaluación:** Las 4 identidades y las 8 reglas reflejan estrictamente el principio de mínimo privilegio.

### V03 — Verificación de Idempotencia
- **Procedimiento:** Ejecución repetida consecutiva de `01_schema_auth.sql` y `02_permissions_data.sql`.
- **Recuentos obtenidos tras la segunda ejecución:**
  - `SELECT COUNT(*) FROM mqtt_user;` -> **4**
  - `SELECT COUNT(*) FROM mqtt_acl;` -> **8**
- **Evaluación:** La presencia de `CONSTRAINT uq_acl_rule UNIQUE (username, clientid, action, topic)` y cláusulas `ON DUPLICATE KEY UPDATE` previene la duplicación de filas ante despliegues continuos.

### V04 y V05 — Ejecución de Consultas con `emqx_ro_user`
- **Consulta Authn:**  
  `SELECT (password_hash IS NOT NULL) AS has_hash, (salt IS NOT NULL) AS has_salt, is_superuser FROM mqtt_user WHERE username = 'web_pub_daniel' LIMIT 1;`  
  *Resultado:* 1 fila (`has_hash=1`, `has_salt=1`, `is_superuser=0`).
- **Consulta Authz:**  
  `SELECT action, permission, topic FROM mqtt_acl WHERE username = "web_pub_daniel" OR username = "$all" ORDER BY id ASC;`  
  *Resultado:* 2 filas (`publish allow cistern/lab07/prueba` y `$all deny #`).
- **Consulta Usuario Inexistente:**  
  `SELECT password_hash, salt, is_superuser FROM mqtt_user WHERE username = 'usuario_inexistente' LIMIT 1;`  
  *Resultado:* 0 filas (conjunto vacío). Permite al broker identificar inmediatamente el rechazo de credenciales.

### V06 y V07 — Privilegios y Bloqueo de Escritura en `emqx_ro_user`
- **Inspección de Privilegios:**
  ```text
  GRANT USAGE ON *.* TO `emqx_ro_user`@`%`
  GRANT SELECT ON `emqx_db`.`mqtt_acl` TO `emqx_ro_user`@`%`
  GRANT SELECT ON `emqx_db`.`mqtt_user` TO `emqx_ro_user`@`%`
  ```
- **Prueba de Inyección de Escritura:**  
  `INSERT INTO mqtt_user (username, password_hash) VALUES ('test_hack', '12345');`  
  *Resultado:* `ERROR 1142 (42000): INSERT command denied to user 'emqx_ro_user'@'localhost' for table 'mqtt_user'`.  
  *Evaluación:* Bloqueo estricto confirmado. La superficie de ataque de la base de datos queda protegida.

### V08 — Integridad de Datos Operativos y Flujo Telemétrico
- `dispositivos`: 4 registros precargados intactos.
- `bitacora_ordenes_mqtt`: 2 registros de auditoría de incidentes intactos.
- `telemetria`: Inició en 12,828 registros y superó los 13,360 registros durante las pruebas, confirmando que la inserción periódica de los nodos virtuales y el filtrado del motor de reglas offline continuaron sin la más mínima interrupción.

### V09 — Estabilidad de Infraestructura
- Los 5 contenedores (`emqx_broker`, `mysql_server`, `phpmyadmin_gui`, `iot_virtual_nodes`, `web_clients_gui`) reportan estado `Up` continuo por más de 3 horas.

### V10 — Exclusión de Respaldos y Secretos en Git
- Archivo de respaldo: `backups/emqx_db_backup_pre_lab08.sql` (998,617 bytes).
- Validación `git check-ignore -v backups/emqx_db_backup_pre_lab08.sql` -> Regla `.gitignore:2:backups/`.
- Validación `git status --short` confirma que `backups/` no es rastreado por el control de versiones.

---

## 3. Pruebas Pendientes para la Fase 5

1. **Activación de Authn en EMQX:** Configurar el recurso de autenticación MySQL en el broker apuntando a `emqx_ro_user`.
2. **Activación de Authz en EMQX:** Configurar el proveedor de autorización MySQL en el broker.
3. **Prueba de Conexión Exitosa con Credenciales:** Conectar el publicador web y suscriptor web enviando `username` y `password` válidos.
4. **Prueba de Rechazo por Credencial Inválida:** Verificar que clientes anónimos o con claves erróneas reciban código `0x86` / `0x87` (Not Authorized / Bad User Name or Password).
5. **Prueba de Aplicación de ACL:** Verificar que un intento de publicar en `cistern/+/telemetry` por parte de `web_pub_daniel` sea bloqueado con código `0x87` (Not Authorized).

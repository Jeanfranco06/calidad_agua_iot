# MATRIZ DE PRUEBAS — LABORATORIO 08 (Jeanfranco)

**Fecha:** 15 de octubre de 2026  
**Entorno:** Docker Compose del proyecto; MySQL 8.0.46 (`mysql_server`), phpMyAdmin 5.2.3 (`phpmyadmin_gui`), EMQX 5.8.0 (`emqx_broker`, no modificado).

| ID | Prueba | Entrada | Resultado esperado | Resultado obtenido | Estado | Evidencia |
|----|--------|---------|--------------------|--------------------|--------|-----------|
| P01 | MySQL activo | Docker | Up | `mysql_server` Up (además `emqx_broker`, `phpmyadmin_gui`, `iot_virtual_nodes`); MySQL 8.0.46 | CONFORME | `01_Estado_MySQL.png` |
| P02 | Puerto | MySQL | Accesible | `docker compose port mysql 3306` → `0.0.0.0:3307`; acceso host OK vía `127.0.0.1:3307` | CONFORME | `02_Puerto_Binding_MySQL.png` |
| P03 | Binding | MySQL | Configuración válida | `bind_address=*`, `port=3306` (interno), publicación host `0.0.0.0:3307`; sin cambios aplicados | CONFORME | `02_Puerto_Binding_MySQL.png` |
| P04 | Login SQL | Credencial válida | Acceso | Interno: `root@localhost`; host: `emqx_user@172.18.0.1` sobre `emqx_db`, versión 8.0.46 | CONFORME | `03_Acceso_MySQL.png` |
| P05 | Base | MySQL | Disponible | `emqx_db` con tablas de negocio intactas (dispositivos=4, telemetria=13 498+ y creciendo, ordenes=8); tablas de auth previas solo en `lab07_prep` (Lab07) | CONFORME | `04_Base_Datos.png` |
| P06 | Tabla usuarios | DDL | Correcta | `mqtt_user` creada/validada: PK `id`, UNIQUE `username`, columnas `password_hash`, `salt`, `is_superuser`, `enabled`, `created` | CONFORME | `05_Tabla_Usuarios.png` |
| P07 | Tabla ACL | DDL | Correcta | `mqtt_acl` creada/validada: PK `id`, índice `username`, columnas `action`, `permission`, `topic`, `qos`, `retain`, `ipaddress`, `clientid` | CONFORME | `06_Tabla_ACL.png` |
| P08 | Usuario prueba | INSERT | Único | `lab08_jeanfranco` insertado con hash bcrypt (prefijo `$2b$10$`, longitud 60); COUNT=1; sin duplicados; is_superuser=0, enabled=1 | CONFORME | `07_Usuario_Prueba.png` |
| P09 | Reglas ACL | INSERT | Correctas | 2 reglas idempotentes: publish allow `cistern/LAB08_TEST/telemetry`; subscribe allow `cistern/LAB08_TEST/#` | CONFORME | `08_Reglas_ACL.png` |
| P10 | phpMyAdmin | Web | Datos visibles | PMA 5.2.3 en `localhost:8080` (auto-login PMA_USER): estructura `emqx_db` muestra 5 tablas; `mqtt_user` 1 fila (hash enmascarado); `mqtt_acl` 2 filas | CONFORME | `09_Verificacion_phpMyAdmin.png` |
| P11 | Integridad | Constraints | Correcta | `SHOW CREATE TABLE` confirma PK/UNIQUE/índices; usernames duplicados=0; script ejecutado 2× sin duplicar registros | CONFORME | `11_Prueba_Integridad.png` |
| P12 | Stack final | Docker | Up | Los 4 contenedores Up; EMQX sin ninguna modificación (autenticación/autorización MySQL preparadas, no activas) | CONFORME | `12_Estado_Final.png` |

Adicional: `10_Verificacion_SQL.png` (consultas de consistencia usuario/ACL/duplicados).

## Notas de ejecución

1. **Mínimo privilegio:** no se crearon permisos globales (`#`); el usuario de prueba solo cubre `cistern/LAB08_TEST/…`.
2. **Seguridad:** contraseñas no escritas en Markdown/SQL/capturas; solo hash bcrypt en BD y resúmenes enmascarados (`$2b$10$g0Jeo...[OCULTO]`).
3. **No destrucción:** prohibiciones respetadas — sin DROP/TRUNCATE; tablas de negocio sin tocar; `lab07_prep` (Lab07) conservada.
4. **EMQX intocado:** ninguna configuración de autenticación/autorización fue activada (límite explícito de la etapa).

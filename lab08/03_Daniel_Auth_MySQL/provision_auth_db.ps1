# =============================================================================
# PROYECTO: calidad_agua_iot
# MODULO: Laboratorio 08 (Apartado Daniel)
# ARCHIVO: provision_auth_db.ps1
# DESCRIPCION: Aprovisionamiento automatizado e idempotente de Authn y Authz MySQL
#              con gestion local de secretos, rotacion explicita y auditoria de privilegios.
# =============================================================================

param (
    [string]$ContainerName = "mysql_server",
    [string]$DatabaseName = "emqx_db",
    [string]$RootUser = "root",
    [string]$RootPass = "rootpass",
    [string]$RoUser = "emqx_ro_user",
    [switch]$RotateCredentials
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$EnvPath = Join-Path $RepoRoot ".env"

Write-Host "=== APROVISIONAMIENTO Y GESTION DE SEGURIDAD MYSQL PARA EMQX 5.8 ===" -ForegroundColor Cyan
Write-Host "Contenedor destino : $ContainerName" -ForegroundColor Gray
Write-Host "Base de datos      : $DatabaseName" -ForegroundColor Gray
Write-Host "Modo de rotacion   : $(if ($RotateCredentials) {'ROTACION ACTIVA'} else {'IDEMPOTENTE (PRESERVACION)'})" -ForegroundColor Gray

# -----------------------------------------------------------------------------
# Funcion auxiliar para generar cadenas criptograficamente robustas
# -----------------------------------------------------------------------------
function New-SecureSecret([int]$Length = 24) {
    $bytes = New-Object byte[] $Length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).Replace('+', '').Replace('/', '').Replace('=', '').Substring(0, [Math]::Min($Length, 20)) + "!2026"
}

function Compute-Sha256SaltSuffix([string]$password, [string]$salt) {
    $toHash = $password + $salt
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($toHash)
    $hashBytes = $hasher.ComputeHash($bytes)
    return -join ($hashBytes | ForEach-Object { "{0:x2}" -f $_ })
}

# -----------------------------------------------------------------------------
# Carga o inicializacion de secretos locales fuera de Git (.env)
# -----------------------------------------------------------------------------
$envMap = @{}
if (Test-Path $EnvPath) {
    Get-Content $EnvPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $envMap[$parts[0].Trim()] = $parts[1].Trim()
        }
    }
}

$needEnvWrite = $false

# Generar o actualizar contrasenas en caso de rotacion o ausencia
if ($RotateCredentials -or -not $envMap.ContainsKey("EMQX_RO_DB_PASS")) {
    $envMap["EMQX_RO_DB_PASS"] = New-SecureSecret 26
    $needEnvWrite = $true
}
if ($RotateCredentials -or -not $envMap.ContainsKey("MQTT_PASS_PUB")) {
    $envMap["MQTT_PASS_PUB"] = New-SecureSecret 24
    $needEnvWrite = $true
}
if ($RotateCredentials -or -not $envMap.ContainsKey("MQTT_PASS_SUB")) {
    $envMap["MQTT_PASS_SUB"] = New-SecureSecret 24
    $needEnvWrite = $true
}
if ($RotateCredentials -or -not $envMap.ContainsKey("MQTT_PASS_NODES")) {
    $envMap["MQTT_PASS_NODES"] = New-SecureSecret 24
    $needEnvWrite = $true
}
if ($RotateCredentials -or -not $envMap.ContainsKey("MQTT_PASS_BACKEND")) {
    $envMap["MQTT_PASS_BACKEND"] = New-SecureSecret 24
    $needEnvWrite = $true
}

# Configuracion complementaria
$envMap["DB_HOST"] = "mysql_server"
$envMap["DB_PORT"] = "3306"
$envMap["DB_NAME"] = $DatabaseName
$envMap["EMQX_RO_DB_USER"] = $RoUser
$envMap["MQTT_USER_PUB"] = "web_pub_daniel"
$envMap["MQTT_USER_SUB"] = "web_sub_daniel"
$envMap["MQTT_USER_NODES"] = "esp32_nodes"
$envMap["MQTT_USER_BACKEND"] = "backend_rules"

if ($needEnvWrite) {
    $envContent = @"
# =============================================================================
# VARIABLES DE ENTORNO LOCALES (SECRETO - NO VERSIONAR)
# Generado de forma automatizada por provision_auth_db.ps1
# =============================================================================
DB_HOST=$($envMap['DB_HOST'])
DB_PORT=$($envMap['DB_PORT'])
DB_NAME=$($envMap['DB_NAME'])

# Credencial de consulta EMQX (Rotacion aplicada)
EMQX_RO_DB_USER=$($envMap['EMQX_RO_DB_USER'])
EMQX_RO_DB_PASS=$($envMap['EMQX_RO_DB_PASS'])

# Credenciales MQTT para Identidades de Servicio y Clientes
MQTT_USER_PUB=$($envMap['MQTT_USER_PUB'])
MQTT_PASS_PUB=$($envMap['MQTT_PASS_PUB'])

MQTT_USER_SUB=$($envMap['MQTT_USER_SUB'])
MQTT_PASS_SUB=$($envMap['MQTT_PASS_SUB'])

MQTT_USER_NODES=$($envMap['MQTT_USER_NODES'])
MQTT_PASS_NODES=$($envMap['MQTT_PASS_NODES'])

MQTT_USER_BACKEND=$($envMap['MQTT_USER_BACKEND'])
MQTT_PASS_BACKEND=$($envMap['MQTT_PASS_BACKEND'])
"@
    Set-Content -Path $EnvPath -Value $envContent -Encoding UTF8
    Write-Host "[SEGURIDAD] Archivo de secretos locales actualizado en: $EnvPath" -ForegroundColor Green
}

$RoPass = $envMap["EMQX_RO_DB_PASS"]

# -----------------------------------------------------------------------------
# 1. Aplicar Esquema DDL (Idempotente: CREATE TABLE IF NOT EXISTS)
# -----------------------------------------------------------------------------
Write-Host "`n[1/4] Verificando esquema DDL de autenticacion y autorizacion..." -ForegroundColor Yellow
$schemaSql = Get-Content (Join-Path $ScriptDir "01_schema_auth.sql") -Raw
$schemaSql | docker exec -i $ContainerName mysql -u $RootUser "-p$($RootPass)" $DatabaseName
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error aplicando esquema DDL." -ForegroundColor Red
    exit 1
}
Write-Host "Esquema DDL verificado exitosamente." -ForegroundColor Green

# -----------------------------------------------------------------------------
# 2. Aplicar Reglas ACL e Identidades
# -----------------------------------------------------------------------------
Write-Host "`n[2/4] Aplicando catalogo base de identidades y reglas ACL..." -ForegroundColor Yellow
$dataSql = Get-Content (Join-Path $ScriptDir "02_permissions_data.sql") -Raw
$dataSql | docker exec -i $ContainerName mysql -u $RootUser "-p$($RootPass)" $DatabaseName
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error aplicando datos de permisos." -ForegroundColor Red
    exit 1
}
Write-Host "Reglas ACL e identidades base sincronizadas." -ForegroundColor Green

# -----------------------------------------------------------------------------
# 3. Rotacion o Sincronizacion de Contrasenas y Hashes de Usuarios MQTT
# -----------------------------------------------------------------------------
Write-Host "`n[3/4] Sincronizando credenciales de usuarios MQTT y cuenta de consulta..." -ForegroundColor Yellow

$usersToSync = @(
    @{ User = "web_pub_daniel"; Pass = $envMap["MQTT_PASS_PUB"]; Salt = "s4lt_pub_d4n13l_2026" },
    @{ User = "web_sub_daniel"; Pass = $envMap["MQTT_PASS_SUB"]; Salt = "s4lt_sub_d4n13l_2026" },
    @{ User = "esp32_nodes";    Pass = $envMap["MQTT_PASS_NODES"]; Salt = "s4lt_n0d3s_3sp32_2026" },
    @{ User = "backend_rules";  Pass = $envMap["MQTT_PASS_BACKEND"]; Salt = "s4lt_b4ck3nd_rul3s_2026" }
)

foreach ($u in $usersToSync) {
    $computedHash = Compute-Sha256SaltSuffix $u.Pass $u.Salt
    $sqlSync = "UPDATE mqtt_user SET password_hash = '$computedHash', salt = '$($u.Salt)', is_superuser = 0 WHERE username = '$($u.User)';"
    $sqlSync | docker exec -i $ContainerName mysql -u $RootUser "-p$($RootPass)" $DatabaseName
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error sincronizando credenciales para $($u.User)." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Hashes SHA-256 (con salt suffix) coherentes para las 4 identidades." -ForegroundColor Green

# Configurar o rotar cuenta de consulta de solo lectura para EMQX
$sqlRo = @"
CREATE USER IF NOT EXISTS '$RoUser'@'%' IDENTIFIED BY '$RoPass';
ALTER USER '$RoUser'@'%' IDENTIFIED BY '$RoPass';
GRANT SELECT ON $DatabaseName.mqtt_user TO '$RoUser'@'%';
GRANT SELECT ON $DatabaseName.mqtt_acl TO '$RoUser'@'%';
REVOKE INSERT, UPDATE, DELETE, DROP, ALTER, CREATE ON $DatabaseName.mqtt_user FROM '$RoUser'@'%';
REVOKE INSERT, UPDATE, DELETE, DROP, ALTER, CREATE ON $DatabaseName.mqtt_acl FROM '$RoUser'@'%';
FLUSH PRIVILEGES;
"@
$sqlRo | docker exec -i $ContainerName mysql -u $RootUser "-p$($RootPass)" $DatabaseName
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error configurando cuenta de solo lectura ($RoUser)." -ForegroundColor Red
    exit 1
}
Write-Host "Cuenta de consulta '$RoUser' verificada con exito $(if ($RotateCredentials) {'(credencial rotada)'} else {'(credencial preservada)'})." -ForegroundColor Green

# -----------------------------------------------------------------------------
# 4. Verificacion de Minimo Privilegio (Principle of Least Privilege)
# -----------------------------------------------------------------------------
Write-Host "`n[4/4] Verificando privilegios efectivos de '$RoUser'..." -ForegroundColor Yellow

$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"

# A. Lectura en tablas permitidas
$testAllowed = docker exec $ContainerName mysql -u $RoUser "-p$($RoPass)" $DatabaseName -e "SELECT COUNT(*) FROM mqtt_user; SELECT COUNT(*) FROM mqtt_acl;" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] SELECT en mqtt_user y mqtt_acl autorizado." -ForegroundColor Green
} else {
    Write-Host "  [ERROR] Fallo SELECT permitido para ${RoUser}: $testAllowed" -ForegroundColor Red
    $ErrorActionPreference = $oldEAP
    exit 1
}

# B. Lectura en telemetria (debe ser DENEGADA)
$testTelemetry = docker exec $ContainerName mysql -u $RoUser "-p$($RoPass)" $DatabaseName -e "SELECT COUNT(*) FROM telemetria;" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [OK] SELECT en telemetria correctamente denegado (ERROR 1142 esperado)." -ForegroundColor Green
} else {
    Write-Host "  [ALERTA CRITICA] $RoUser pudo leer la tabla telemetria. Principio de minimo privilegio violado." -ForegroundColor Red
    $ErrorActionPreference = $oldEAP
    exit 1
}

# C. Escritura en mqtt_acl (debe ser DENEGADA)
$testWrite = docker exec $ContainerName mysql -u $RoUser "-p$($RoPass)" $DatabaseName -e "INSERT INTO mqtt_acl (username, action, permission, topic) VALUES ('test', 'publish', 'allow', 'test');" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [OK] INSERT en mqtt_acl correctamente denegado (ERROR 1142 esperado)." -ForegroundColor Green
} else {
    Write-Host "  [ALERTA CRITICA] $RoUser pudo insertar en mqtt_acl. Privilegio de escritura no restringido." -ForegroundColor Red
    $ErrorActionPreference = $oldEAP
    exit 1
}

$ErrorActionPreference = $oldEAP

# Resumen de auditoria
Write-Host "`n=== RESUMEN DE REGISTROS EN BASE DE DATOS ===" -ForegroundColor Cyan
docker exec $ContainerName mysql -u $RootUser "-p$($RootPass)" $DatabaseName -e "
    SELECT COUNT(*) AS total_usuarios_mqtt FROM mqtt_user;
    SELECT COUNT(*) AS total_reglas_acl FROM mqtt_acl;
    SELECT COUNT(*) AS total_telemetria_operativa FROM telemetria;
"
Write-Host "Aprovisionamiento y auditoria de seguridad completados con exito." -ForegroundColor Green

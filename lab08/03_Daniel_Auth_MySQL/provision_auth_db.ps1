# =============================================================================
# PROYECTO: calidad_agua_iot
# MODULO: Laboratorio 08 (Apartado Daniel)
# ARCHIVO: provision_auth_db.ps1
# DESCRIPCION: Aprovisionamiento automatizado e idempotente de Authn y Authz MySQL
#              con gestion local de secretos, preservacion estricta de .env,
#              rotacion explicita y auditoria de privilegios minimos.
# =============================================================================

param (
    [string]$ContainerName = "mysql_server",
    [string]$DatabaseName = "emqx_db",
    [string]$RootUser = "root",
    [string]$RootPass = "rootpass",
    [string]$RoUser = "emqx_ro_user",
    [string]$EnvFile = "",
    [switch]$RotateCredentials,
    [switch]$SkipDbApply
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

if ($EnvFile -and $EnvFile.Trim() -ne "") {
    $EnvPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $EnvFile)) }
} else {
    $EnvPath = Join-Path $RepoRoot ".env"
}

Write-Host "=== APROVISIONAMIENTO Y GESTION DE SEGURIDAD MYSQL PARA EMQX 5.8 ===" -ForegroundColor Cyan
Write-Host "Contenedor destino : $ContainerName" -ForegroundColor Gray
Write-Host "Base de datos      : $DatabaseName" -ForegroundColor Gray
Write-Host "Archivo .env       : $EnvPath" -ForegroundColor Gray
Write-Host "Modo de rotacion   : $(if ($RotateCredentials) {'ROTACION ACTIVA'} else {'IDEMPOTENTE (PRESERVACION)'})" -ForegroundColor Gray

# -----------------------------------------------------------------------------
# Funciones auxiliares criptograficas
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
# Preservacion estricta y actualizacion segura de .env
# -----------------------------------------------------------------------------
function Update-EnvFileSafely {
    param (
        [string]$FilePath,
        [switch]$Rotate
    )

    $secretKeys = @(
        "EMQX_RO_DB_PASS",
        "MQTT_PASS_PUB",
        "MQTT_PASS_SUB",
        "MQTT_PASS_NODES",
        "MQTT_PASS_BACKEND"
    )

    $defaultConfig = [ordered]@{
        "DB_HOST" = "mysql_server"
        "DB_PORT" = "3306"
        "DB_NAME" = $DatabaseName
        "EMQX_RO_DB_USER" = $RoUser
        "MQTT_USER_PUB" = "web_pub_daniel"
        "MQTT_USER_SUB" = "web_sub_daniel"
        "MQTT_USER_NODES" = "esp32_nodes"
        "MQTT_USER_BACKEND" = "backend_rules"
    }

    $rawLines = @()
    $existingMap = @{}
    $seenKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    if (Test-Path $FilePath) {
        $rawLines = Get-Content $FilePath
        foreach ($line in $rawLines) {
            $trimmed = $line.Trim()
            if ($trimmed -and -not $trimmed.StartsWith("#") -and $trimmed.Contains("=")) {
                $p = $trimmed.Split("=", 2)
                $k = $p[0].Trim()
                $v = $p[1].Trim()
                $existingMap[$k] = $v
                $seenKeys.Add($k) | Out-Null
            }
        }
    }

    $newMap = @{}
    $modified = $false

    # 1. Procesar secretos gestionados
    foreach ($k in $secretKeys) {
        $currVal = if ($existingMap.ContainsKey($k)) { $existingMap[$k] } else { $null }
        $isPlaceholder = ($currVal -and ($currVal.StartsWith("CAMBIAR_POR_") -or $currVal.Contains("CAMBIAR_POR_")))
        $isEmpty = [string]::IsNullOrWhiteSpace($currVal)
        $isMissing = -not $existingMap.ContainsKey($k)

        if ($Rotate -or $isMissing -or $isEmpty -or $isPlaceholder) {
            $len = if ($k -eq "EMQX_RO_DB_PASS") { 26 } else { 24 }
            $newMap[$k] = New-SecureSecret $len
            $modified = $true
            if ($isPlaceholder) {
                Write-Host "  [SEGURIDAD] Marcador de plantilla detectado en $k. Sustituido por credencial segura." -ForegroundColor Yellow
            }
        } else {
            $newMap[$k] = $currVal
        }
    }

    # 2. Procesar configuraciones no sensibles
    foreach ($k in $defaultConfig.Keys) {
        $currVal = if ($existingMap.ContainsKey($k)) { $existingMap[$k] } else { $null }
        $isEmpty = [string]::IsNullOrWhiteSpace($currVal)
        $isMissing = -not $existingMap.ContainsKey($k)

        if ($isMissing -or $isEmpty) {
            $newMap[$k] = $defaultConfig[$k]
            $modified = $true
        } else {
            $newMap[$k] = $currVal
        }
    }

    # 3. Ensamblar contenido preservando variables ajenas y comentarios
    $finalLines = @()
    if (Test-Path $FilePath) {
        $allManagedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($k in $secretKeys) { $allManagedKeys.Add($k) | Out-Null }
        foreach ($k in $defaultConfig.Keys) { $allManagedKeys.Add($k) | Out-Null }

        $writtenKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

        foreach ($line in $rawLines) {
            $trimmed = $line.Trim()
            if ($trimmed -and -not $trimmed.StartsWith("#") -and $trimmed.Contains("=")) {
                $p = $trimmed.Split("=", 2)
                $k = $p[0].Trim()
                if ($allManagedKeys.Contains($k)) {
                    $finalLines += "$k=$($newMap[$k])"
                    $writtenKeys.Add($k) | Out-Null
                } else {
                    # Variable ajena al modulo: se conserva exactamente intacta
                    $finalLines += $line
                }
            } else {
                # Linea de comentario o espacio en blanco: se conserva
                $finalLines += $line
            }
        }

        # Anadir al final cualquier variable gestionada faltante que no existia en el archivo
        $missingToAdd = @()
        foreach ($k in $allManagedKeys) {
            if (-not $writtenKeys.Contains($k)) {
                $missingToAdd += "$k=$($newMap[$k])"
            }
        }
        if ($missingToAdd.Count -gt 0) {
            $finalLines += ""
            $finalLines += "# Variables de calidad_agua_iot agregadas automaticamente"
            $finalLines += $missingToAdd
        }
    } else {
        $finalLines += "# ============================================================================="
        $finalLines += "# VARIABLES DE ENTORNO LOCALES (SECRETO - NO VERSIONAR)"
        $finalLines += "# Generado de forma automatizada por provision_auth_db.ps1"
        $finalLines += "# ============================================================================="
        $finalLines += "DB_HOST=$($newMap['DB_HOST'])"
        $finalLines += "DB_PORT=$($newMap['DB_PORT'])"
        $finalLines += "DB_NAME=$($newMap['DB_NAME'])"
        $finalLines += ""
        $finalLines += "# Credencial de consulta EMQX"
        $finalLines += "EMQX_RO_DB_USER=$($newMap['EMQX_RO_DB_USER'])"
        $finalLines += "EMQX_RO_DB_PASS=$($newMap['EMQX_RO_DB_PASS'])"
        $finalLines += ""
        $finalLines += "# Credenciales MQTT para Identidades de Servicio y Clientes"
        $finalLines += "MQTT_USER_PUB=$($newMap['MQTT_USER_PUB'])"
        $finalLines += "MQTT_PASS_PUB=$($newMap['MQTT_PASS_PUB'])"
        $finalLines += ""
        $finalLines += "MQTT_USER_SUB=$($newMap['MQTT_USER_SUB'])"
        $finalLines += "MQTT_PASS_SUB=$($newMap['MQTT_PASS_SUB'])"
        $finalLines += ""
        $finalLines += "MQTT_USER_NODES=$($newMap['MQTT_USER_NODES'])"
        $finalLines += "MQTT_PASS_NODES=$($newMap['MQTT_PASS_NODES'])"
        $finalLines += ""
        $finalLines += "MQTT_USER_BACKEND=$($newMap['MQTT_USER_BACKEND'])"
        $finalLines += "MQTT_PASS_BACKEND=$($newMap['MQTT_PASS_BACKEND'])"
        $modified = $true
    }

    # 4. Escritura atomica y segura
    if ($modified -or -not (Test-Path $FilePath)) {
        $parentDir = Split-Path -Parent $FilePath
        if ($parentDir -and -not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
        }
        $tmpGuid = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
        $tmpFile = "$FilePath.tmp.$tmpGuid"
        Set-Content -Path $tmpFile -Value $finalLines -Encoding UTF8
        if (Test-Path $tmpFile) {
            Move-Item -Path $tmpFile -Destination $FilePath -Force
            Write-Host "[SEGURIDAD] Archivo .env preservado y actualizado de forma atomica en: $FilePath" -ForegroundColor Green
        }
    } else {
        Write-Host "[INFO] Variables y credenciales existentes verificadas sin cambios requeridos." -ForegroundColor Gray
    }

    $retMap = @{}
    foreach ($k in $newMap.Keys) { $retMap[$k] = $newMap[$k] }
    foreach ($k in $existingMap.Keys) {
        if (-not $retMap.ContainsKey($k)) { $retMap[$k] = $existingMap[$k] }
    }
    return $retMap
}

# Carga y preservacion de .env
$envMap = Update-EnvFileSafely -FilePath $EnvPath -Rotate:$RotateCredentials

if ($SkipDbApply) {
    Write-Host "[INFO] Modo SkipDbApply activo. Omitiendo aplicacion en MySQL." -ForegroundColor Gray
    exit 0
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
# 3. Sincronizacion de Contrasenas y Hashes de Usuarios MQTT
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

# Configurar o actualizar cuenta de consulta de solo lectura para EMQX
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

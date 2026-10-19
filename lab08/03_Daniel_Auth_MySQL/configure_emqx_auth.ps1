# =============================================================================
# PROYECTO: calidad_agua_iot
# MODULO: Laboratorio 08 (Apartado Daniel)
# ARCHIVO: configure_emqx_auth.ps1
# DESCRIPCION: Configuracion automatizada, reproducible y reversible de Authn y
#              Authz MySQL en EMQX 5.8.0 mediante API de Gestion y Control HOCON.
# =============================================================================

param (
    [string]$EmqxApiUrl = "http://localhost:18083/api/v5",
    [string]$AdminUser = "admin",
    [string]$AdminPass = "public",
    [switch]$Rollback,
    [switch]$StatusOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$EnvPath = Join-Path $RepoRoot ".env"

Write-Host "=== CONFIGURACION DE SEGURIDAD EMQX 5.8 (Authn y Authz MySQL) ===" -ForegroundColor Cyan

# 1. Obtener Token de Autenticacion de EMQX Dashboard
function Get-EmqxToken {
    try {
        $loginBody = @{ username = $AdminUser; password = $AdminPass } | ConvertTo-Json
        $res = Invoke-RestMethod -Uri "$EmqxApiUrl/login" -Method Post -Body $loginBody -ContentType "application/json"
        return $res.token
    } catch {
        Write-Host "Error al autenticarse en API EMQX: $_" -ForegroundColor Red
        throw $_
    }
}

$token = Get-EmqxToken
$headers = @{
    Authorization = "Bearer $token"
    "Content-Type" = "application/json"
}

# -----------------------------------------------------------------------------
# MODO: CONSULTA DE ESTADO
# -----------------------------------------------------------------------------
if ($StatusOnly) {
    Write-Host "`nConsultando configuracion activa en EMQX..." -ForegroundColor Yellow
    $authn = Invoke-RestMethod -Uri "$EmqxApiUrl/authentication" -Headers $headers
    $authzSettings = Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/settings" -Headers $headers
    $authzSources = Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/sources" -Headers $headers

    Write-Host "`n--- Autenticadores Registrados ---" -ForegroundColor Cyan
    $authn | Format-Table id, mechanism, backend, enable
    Write-Host "`n--- Ajustes Globales de Autorizacion ---" -ForegroundColor Cyan
    Write-Host "no_match    : $($authzSettings.no_match)"
    Write-Host "deny_action : $($authzSettings.deny_action)"
    Write-Host "cache enable: $($authzSettings.cache.enable)"
    Write-Host "`n--- Fuentes de Autorizacion (ACL) ---" -ForegroundColor Cyan
    $authzSources.sources | Format-Table type, enable
    exit 0
}

# -----------------------------------------------------------------------------
# MODO: REVERSION / ROLLBACK (Procedimiento de contingencia documentado)
# -----------------------------------------------------------------------------
if ($Rollback) {
    Write-Host "`n[REVERSION] Desactivando Authn/Authz MySQL y restaurando estado base..." -ForegroundColor Red

    # 1. Eliminar Autenticador MySQL si existe
    try {
        Invoke-RestMethod -Uri "$EmqxApiUrl/authentication/password_based:mysql" -Method Delete -Headers $headers | Out-Null
        Write-Host "  [OK] Autenticador MySQL eliminado (conexiones anonimas permitidas nuevamente)." -ForegroundColor Green
    } catch {
        Write-Host "  [INFO] Autenticador MySQL no estaba presente o ya fue eliminado." -ForegroundColor Gray
    }

    # 2. Restaurar Ajustes Globales de Autorizacion (no_match: allow)
    try {
        $revertSettings = @{
            no_match = "allow"
            deny_action = "ignore"
            cache = @{ enable = $true; max_size = 32; ttl = "1m" }
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/settings" -Method Put -Headers $headers -Body $revertSettings | Out-Null
        Write-Host "  [OK] Ajuste de autorizacion restaurado a no_match: allow." -ForegroundColor Green
    } catch {
        Write-Host "  [ERROR] Fallo al revertir ajustes de autorizacion: $_" -ForegroundColor Red
    }

    # 3. Eliminar fuente MySQL de autorizacion y re-habilitar fuente file si existe
    try {
        Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/sources/mysql" -Method Delete -Headers $headers | Out-Null
        Write-Host "  [OK] Fuente de autorizacion MySQL eliminada." -ForegroundColor Green
    } catch {
        Write-Host "  [INFO] Fuente MySQL no estaba presente." -ForegroundColor Gray
    }

    try {
        $fileSource = Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/sources/file" -Headers $headers
        $enableFile = @{ type = "file"; enable = $true; rules = $fileSource.rules } | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/sources/file" -Method Put -Headers $headers -Body $enableFile | Out-Null
        Write-Host "  [OK] Fuente de autorizacion basada en archivo re-habilitada." -ForegroundColor Green
    } catch {
        Write-Host "  [INFO] Fuente de archivo no requirio cambios." -ForegroundColor Gray
    }

    Write-Host "`nReversion completada. El broker opera nuevamente en modo abierto de laboratorio." -ForegroundColor Yellow
    exit 0
}

# -----------------------------------------------------------------------------
# MODO: APLICAR CONFIGURACION REPRODUCIBLE (Authn + Authz MySQL)
# -----------------------------------------------------------------------------

# Cargar credenciales desde .env
if (-not (Test-Path $EnvPath)) {
    Write-Host "Error: No se encontro el archivo de secretos $EnvPath. Ejecute primero provision_auth_db.ps1." -ForegroundColor Red
    exit 1
}

$envMap = @{}
Get-Content $EnvPath | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line.Split("=", 2)
        $envMap[$parts[0].Trim()] = $parts[1].Trim()
    }
}

$roUser = $envMap["EMQX_RO_DB_USER"]
$roPass = $envMap["EMQX_RO_DB_PASS"]

if (-not $roUser -or -not $roPass) {
    Write-Host "Error: Credenciales de consulta emqx_ro_user no encontradas en .env." -ForegroundColor Red
    exit 1
}

Write-Host "`n[1/4] Configurando Autenticacion Basada en Contrasenas (password_based:mysql)..." -ForegroundColor Yellow

$authnPayload = @{
    mechanism = "password_based"
    backend = "mysql"
    server = "mysql_server:3306"
    database = "emqx_db"
    username = $roUser
    password = $roPass
    pool_size = 8
    password_hash_algorithm = @{
        name = "sha256"
        salt_position = "suffix"
    }
    query = "SELECT password_hash, salt, is_superuser FROM mqtt_user WHERE username = `${username} LIMIT 1"
} | ConvertTo-Json -Depth 5

try {
    # Intentar creacion
    $resAuthn = Invoke-RestMethod -Uri "$EmqxApiUrl/authentication" -Method Post -Headers $headers -Body $authnPayload
    Write-Host "  [OK] Autenticador MySQL creado exitosamente." -ForegroundColor Green
} catch {
    # Si ya existe, actualizar
    try {
        $resAuthn = Invoke-RestMethod -Uri "$EmqxApiUrl/authentication/password_based:mysql" -Method Put -Headers $headers -Body $authnPayload
        Write-Host "  [OK] Autenticador MySQL existente actualizado correctamente." -ForegroundColor Green
    } catch {
        Write-Host "  [ERROR] Fallo configuracion de autenticador MySQL: $_" -ForegroundColor Red
        throw $_
    }
}

Write-Host "`n[2/4] Configurando Politica Global de Autorizacion (no_match: deny)..." -ForegroundColor Yellow

$authzSettingsPayload = @{
    no_match = "deny"
    deny_action = "ignore"
    cache = @{
        enable = $true
        max_size = 32
        ttl = "1m"
    }
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/settings" -Method Put -Headers $headers -Body $authzSettingsPayload | Out-Null
    Write-Host "  [OK] Politica global establecida: no_match = deny (lista blanca estricta)." -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Fallo ajuste global de autorizacion: $_" -ForegroundColor Red
    throw $_
}

Write-Host "`n[3/4] Configurando Fuente de Autorizacion MySQL (authz:mysql)..." -ForegroundColor Yellow

$authzSourcePayload = @{
    type = "mysql"
    enable = $true
    server = "mysql_server:3306"
    database = "emqx_db"
    username = $roUser
    password = $roPass
    pool_size = 8
    query = "SELECT action, permission, topic FROM mqtt_acl WHERE (username = `${username} OR username = '`$all') AND (clientid IS NULL OR clientid = '' OR clientid = `${clientid}) ORDER BY id ASC"
} | ConvertTo-Json -Depth 5

try {
    Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/sources" -Method Post -Headers $headers -Body $authzSourcePayload | Out-Null
    Write-Host "  [OK] Fuente de autorizacion MySQL registrada exitosamente." -ForegroundColor Green
} catch {
    try {
        Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/sources/mysql" -Method Put -Headers $headers -Body $authzSourcePayload | Out-Null
        Write-Host "  [OK] Fuente de autorizacion MySQL existente actualizada." -ForegroundColor Green
    } catch {
        Write-Host "  [ERROR] Fallo registro de fuente MySQL de autorizacion: $_" -ForegroundColor Red
        throw $_
    }
}

Write-Host "`n[4/4] Inhabilitando fuentes de autorizacion predeterminadas que puedan eludir MySQL..." -ForegroundColor Yellow

try {
    # Deshabilitar regla file para que no aplique {allow, all}
    $fileSource = Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/sources/file" -Headers $headers
    $disableFile = @{ type = "file"; enable = $false; rules = $fileSource.rules } | ConvertTo-Json -Depth 5
    Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/sources/file" -Method Put -Headers $headers -Body $disableFile | Out-Null
    Write-Host "  [OK] Fuente de autorizacion basada en archivo deshabilitada (evita bypass de MySQL)." -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] No se pudo deshabilitar la fuente de archivo: $_" -ForegroundColor Red
    throw $_
}

# Limpiar cache de autorizacion en todos los nodos
try {
    Invoke-RestMethod -Uri "$EmqxApiUrl/authorization/cache" -Method Delete -Headers $headers | Out-Null
    Write-Host "  [OK] Cache de autorizacion purgada en EMQX." -ForegroundColor Green
} catch {
    Write-Host "  [INFO] Purga de cache via API no requerida." -ForegroundColor Gray
}

Write-Host "`n=== INTEGRACION EMQX 5.8 COMPLETADA EXITOSAMENTE ===" -ForegroundColor Green
Write-Host "Autenticacion activa : password_based:mysql (SHA-256 suffix salt)"
Write-Host "Autorizacion activa  : authz:mysql (no_match: deny)"
Write-Host "Persistencia datos   : Mnesia y Cluster HOCON en volumen Docker emqx_data"

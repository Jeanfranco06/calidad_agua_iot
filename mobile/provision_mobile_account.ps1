param(
    [string]$ContainerName = 'mysql_server',
    [string]$DatabaseName = 'emqx_db',
    [string]$EnvPath = (Join-Path (Split-Path -Parent $PSScriptRoot) '.env')
)

$ErrorActionPreference = 'Stop'
$username = 'mobile_monitor'
$salt = 'lab11_mobile_monitor_2026'

function New-Password {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-Sha256([string]$value) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($value))
        return -join ($hash | ForEach-Object { $_.ToString('x2') })
    } finally { $sha.Dispose() }
}

$values = @{}
$lines = @()
if (Test-Path -LiteralPath $EnvPath) {
    $lines = @(Get-Content -LiteralPath $EnvPath)
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -and -not $trimmed.StartsWith('#') -and $trimmed.Contains('=')) {
            $parts = $trimmed.Split('=', 2)
            $values[$parts[0].Trim()] = $parts[1].Trim()
        }
    }
}

$password = $values['MQTT_PASS_MOBILE']
if ([string]::IsNullOrWhiteSpace($password)) { $password = New-Password }
$hash = Get-Sha256 ($password + $salt)
$values['MQTT_USER_MOBILE'] = $username
$values['MQTT_PASS_MOBILE'] = $password

$foundUser = $false
$foundPass = $false
$newLines = foreach ($line in $lines) {
    if ($line -match '^\s*MQTT_USER_MOBILE=') { $foundUser = $true; "MQTT_USER_MOBILE=$username" }
    elseif ($line -match '^\s*MQTT_PASS_MOBILE=') { $foundPass = $true; "MQTT_PASS_MOBILE=$password" }
    else { $line }
}
if (-not $foundUser) { $newLines += "MQTT_USER_MOBILE=$username" }
if (-not $foundPass) { $newLines += "MQTT_PASS_MOBILE=$password" }
[System.IO.File]::WriteAllLines($EnvPath, [string[]]$newLines, [System.Text.UTF8Encoding]::new($false))

$secureRootPass = Read-Host 'Contraseña root de MySQL (no se mostrará)' -AsSecureString
$rootPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureRootPass)
try {
    $rootPass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($rootPtr)
    $env:MYSQL_PWD = $rootPass
    $sql = @"
INSERT INTO mqtt_user (username, password_hash, salt, is_superuser)
VALUES ('$username', '$hash', '$salt', 0)
ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), salt = VALUES(salt), is_superuser = 0;
INSERT INTO mqtt_acl (username, clientid, action, permission, topic)
VALUES ('$username', '', 'subscribe', 'allow', 'cistern/+/telemetry')
ON DUPLICATE KEY UPDATE permission = 'allow';
SELECT username, is_superuser FROM mqtt_user WHERE username = '$username';
SELECT username, action, permission, topic FROM mqtt_acl WHERE username = '$username';
"@
    $sql | docker exec -e MYSQL_PWD="$rootPass" -i $ContainerName mysql -u root $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw 'MySQL rechazó el aprovisionamiento de la cuenta móvil.' }
} finally {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($rootPtr)
}

Write-Host 'Cuenta móvil aprovisionada. La contraseña quedó en el .env local ignorado por Git.' -ForegroundColor Green
Write-Host 'La cuenta tiene permiso de suscripción a cistern/+/telemetry; las demás operaciones dependen de la política default-deny activa de EMQX.' -ForegroundColor Gray

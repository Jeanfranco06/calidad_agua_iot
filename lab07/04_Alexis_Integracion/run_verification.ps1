param (
    [string]$ContainerName = "iot_virtual_nodes",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "../..")).Path
$EnvPath = Join-Path $RepoRoot ".env"

if (-not (Test-Path -LiteralPath $EnvPath)) {
    throw "Falta .env. Ejecute primero el aprovisionamiento de LAB 08."
}

if (-not $OutputPath) {
    $OutputPath = Join-Path $RepoRoot "evidencias/alexis/L07_ALEXIS_01_telemetria_websocket_mysql.json"
}

$envMap = @{}
Get-Content -LiteralPath $EnvPath | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line.Split("=", 2)
        $envMap[$parts[0].Trim()] = $parts[1].Trim()
    }
}

$required = @("MQTT_USER_SUB", "MQTT_PASS_SUB")
foreach ($key in $required) {
    if (-not $envMap[$key]) {
        throw "Falta la variable $key en .env."
    }
}

$tempHostEnv = Join-Path $ScriptDir (".tmp_alexis_" + [guid]::NewGuid().ToString("N") + ".env")
$tempContainerEnv = "/tmp/.alexis_integration.env"
$containerScript = "/tmp/verify_alexis_telemetry.py"
$lines = @(
    "MQTT_USER_SUB=$($envMap['MQTT_USER_SUB'])",
    "MQTT_PASS_SUB=$($envMap['MQTT_PASS_SUB'])"
)
Set-Content -LiteralPath $tempHostEnv -Value $lines -Encoding UTF8

try {
    docker cp (Join-Path $ScriptDir "verify_telemetry.py") "${ContainerName}:${containerScript}"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo copiar el verificador al contenedor." }
    docker cp $tempHostEnv "${ContainerName}:${tempContainerEnv}"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo copiar el archivo temporal de credenciales." }

    $output = docker exec -e "ENV_FILE=$tempContainerEnv" $ContainerName python $containerScript
    $exitCode = $LASTEXITCODE
    $output | Write-Output
    $outputDir = Split-Path -Parent $OutputPath
    if ($outputDir -and -not (Test-Path -LiteralPath $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }
    $output | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    Write-Host "Evidencia JSON: $OutputPath"
    exit $exitCode
} finally {
    docker exec $ContainerName rm -f $tempContainerEnv $containerScript 2>$null | Out-Null
    if (Test-Path -LiteralPath $tempHostEnv) {
        Remove-Item -LiteralPath $tempHostEnv -Force
    }
}

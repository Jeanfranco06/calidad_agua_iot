# =============================================================================
# EJECUTOR REPRODUCIBLE DE PRUEBAS EN CONTENEDOR (Lab 08)
# ARCHIVO: run_tests_docker.ps1
# DESCRIPCION: Suministra temporalmente al contenedor de pruebas unicamente
#              las credenciales necesarias para los clientes de prueba (pub/sub),
#              sin distribuir el .env completo ni exponer secretos en linea de comandos.
#              Elimina todos los archivos temporales al finalizar.
# =============================================================================

param (
    [ValidateSet("Acceptance", "Matrix", "All")]
    [string]$Suite = "Acceptance",
    [string]$ContainerName = "iot_virtual_nodes"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "../../..")).Path
$HostEnv = Join-Path $RepoRoot ".env"

if (-not (Test-Path $HostEnv)) {
    Write-Host "Error: No se encontro el archivo de secretos $HostEnv. Ejecute provision_auth_db.ps1 primero." -ForegroundColor Red
    exit 1
}

# 1. Extraer unicamente variables necesarias para pruebas de clientes
$envMap = @{}
Get-Content $HostEnv | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line.Split("=", 2)
        $envMap[$parts[0].Trim()] = $parts[1].Trim()
    }
}

$tmpHostEnv = Join-Path $ScriptDir ".tmp_test_runtime_$([System.Guid]::NewGuid().ToString('N').Substring(0,8)).env"
$tmpContainerEnv = "/tmp/.test_runtime_env"

$testEnvLines = @(
    "MQTT_USER_PUB=$($envMap['MQTT_USER_PUB'])",
    "MQTT_PASS_PUB=$($envMap['MQTT_PASS_PUB'])",
    "MQTT_USER_SUB=$($envMap['MQTT_USER_SUB'])",
    "MQTT_PASS_SUB=$($envMap['MQTT_PASS_SUB'])"
)

Set-Content -Path $tmpHostEnv -Value $testEnvLines -Encoding UTF8

$exitCode = 0

try {
    # 2. Sincronizar scripts de prueba actualizados en el contenedor
    $accScript = Join-Path $ScriptDir "test_acceptance_phase6.py"
    $matScript = Join-Path (Split-Path -Parent $ScriptDir) "test_matrix_phase5.py"

    docker cp $accScript "${ContainerName}:/app/test_acceptance_phase6.py"
    docker cp $matScript "${ContainerName}:/app/test_matrix_phase5.py"

    # 3. Copiar archivo temporal minimo de credenciales al contenedor
    docker cp $tmpHostEnv "${ContainerName}:${tmpContainerEnv}"

    if ($Suite -eq "Acceptance" -or $Suite -eq "All") {
        Write-Host "`n>>> EJECUTANDO SUITE DE ACEPTACION (test_acceptance_phase6.py)..." -ForegroundColor Cyan
        docker exec -i -e "ENV_FILE=${tmpContainerEnv}" $ContainerName python /app/test_acceptance_phase6.py
        if ($LASTEXITCODE -ne 0) { $exitCode = $LASTEXITCODE }
    }

    if ($Suite -eq "Matrix" -or $Suite -eq "All") {
        Write-Host "`n>>> EJECUTANDO MATRIZ DE SEGURIDAD PROTOCOLAR (test_matrix_phase5.py)..." -ForegroundColor Cyan
        docker exec -i -e "ENV_FILE=${tmpContainerEnv}" $ContainerName python /app/test_matrix_phase5.py
        if ($LASTEXITCODE -ne 0) { $exitCode = $LASTEXITCODE }
    }
} finally {
    # 4. Limpieza estricta de archivos temporales
    docker exec $ContainerName rm -f $tmpContainerEnv 2>$null
    if (Test-Path $tmpHostEnv) {
        Remove-Item $tmpHostEnv -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode

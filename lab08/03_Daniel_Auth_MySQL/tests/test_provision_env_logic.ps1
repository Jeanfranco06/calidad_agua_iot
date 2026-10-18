# =============================================================================
# PRUEBA DE ACEPTACION DE PRESERVACION DE .ENV (Casos A - F)
# ARCHIVO: test_provision_env_logic.ps1
# DESCRIPCION: Ejercita directamente el script real provision_auth_db.ps1
#              sobre un archivo temporal aislado, verificando la preservacion
#              de variables ajenas, idempotencia, reemplazo de plantillas y rotacion.
# =============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProvisionScript = Join-Path (Split-Path -Parent $ScriptDir) "provision_auth_db.ps1"

Write-Host "=== TEST SUITE: PRESERVACION Y LOGICA DE .ENV (Casos A - F) ===" -ForegroundColor Cyan
Write-Host "Script bajo prueba: $ProvisionScript" -ForegroundColor Gray

# Crear archivo temporal fuera de la vista web
$tmpEnv = Join-Path $ScriptDir ".tmp_test_env_$([System.Guid]::NewGuid().ToString('N').Substring(0,8)).env"

try {
    # -------------------------------------------------------------------------
    # Preparacion inicial del archivo de prueba
    # -------------------------------------------------------------------------
    $initialContent = @"
# Archivo de configuracion previo con variables ajenas
CUSTOM_FOREIGN_VAR=ValorAjen0_12345
ANOTHER_CUSTOM_SETTING=ConfiguracionExterna!99

# Credencial pre-existente valida (Debe preservarse)
EMQX_RO_DB_PASS=StaticPassPreExisting!2026

# Credencial con marcador de plantilla (Debe sustituirse)
MQTT_PASS_PUB=CAMBIAR_POR_CLAVE_PUBLICADOR

# Credencial vacia (Debe generarse)
MQTT_PASS_SUB=

# Nota: MQTT_PASS_NODES y MQTT_PASS_BACKEND estan ausentes (Deben generarse)
"@
    Set-Content -Path $tmpEnv -Value $initialContent -Encoding UTF8

    Write-Host "`n[FASE 1] Primera ejecucion normal (Idempotente)..." -ForegroundColor Yellow
    & $ProvisionScript -EnvFile $tmpEnv -SkipDbApply

    # Leer resultados fase 1
    $map1 = @{}
    Get-Content $tmpEnv | ForEach-Object {
        $t = $_.Trim()
        if ($t -and -not $t.StartsWith("#") -and $t.Contains("=")) {
            $p = $t.Split("=", 2)
            $map1[$p[0].Trim()] = $p[1].Trim()
        }
    }

    # Comprobacion A: Variables adicionales de prueba permanecen intactas
    $passA = ($map1["CUSTOM_FOREIGN_VAR"] -eq "ValorAjen0_12345" -and $map1["ANOTHER_CUSTOM_SETTING"] -eq "ConfiguracionExterna!99")
    Write-Host "  Control A (Variables ajenas intactas)          : $(if ($passA) {'PASS'} else {'FAIL'})" -ForegroundColor $(if ($passA) {'Green'} else {'Red'})

    # Comprobacion B: Credencial existente permanece igual
    $passB = ($map1["EMQX_RO_DB_PASS"] -eq "StaticPassPreExisting!2026")
    Write-Host "  Control B (Credencial valida preservada)       : $(if ($passB) {'PASS'} else {'FAIL'})" -ForegroundColor $(if ($passB) {'Green'} else {'Red'})

    # Comprobacion C: Variables ausentes y vacias se generan
    $passC = (-not [string]::IsNullOrWhiteSpace($map1["MQTT_PASS_NODES"]) -and
              -not [string]::IsNullOrWhiteSpace($map1["MQTT_PASS_BACKEND"]) -and
              -not [string]::IsNullOrWhiteSpace($map1["MQTT_PASS_SUB"]))
    Write-Host "  Control C (Variables ausentes/vacias generadas): $(if ($passC) {'PASS'} else {'FAIL'})" -ForegroundColor $(if ($passC) {'Green'} else {'Red'})

    # Comprobacion E: Marcador de plantilla se detecta y reemplaza
    $passE = ($map1["MQTT_PASS_PUB"] -ne "CAMBIAR_POR_CLAVE_PUBLICADOR" -and -not [string]::IsNullOrWhiteSpace($map1["MQTT_PASS_PUB"]))
    Write-Host "  Control E (Marcador plantilla sustituido)      : $(if ($passE) {'PASS'} else {'FAIL'})" -ForegroundColor $(if ($passE) {'Green'} else {'Red'})

    # -------------------------------------------------------------------------
    # Comprobacion D: Segunda ejecucion normal NO cambia lo ya generado
    # -------------------------------------------------------------------------
    Write-Host "`n[FASE 2] Segunda ejecucion normal (Verificacion de idempotencia)..." -ForegroundColor Yellow
    & $ProvisionScript -EnvFile $tmpEnv -SkipDbApply

    $map2 = @{}
    Get-Content $tmpEnv | ForEach-Object {
        $t = $_.Trim()
        if ($t -and -not $t.StartsWith("#") -and $t.Contains("=")) {
            $p = $t.Split("=", 2)
            $map2[$p[0].Trim()] = $p[1].Trim()
        }
    }

    $passD = $true
    foreach ($k in $map1.Keys) {
        if ($map1[$k] -ne $map2[$k]) {
            $passD = $false
            Write-Host "    Discrepancia en key $($k): '$($map1[$k])' != '$($map2[$k])'" -ForegroundColor Red
        }
    }
    Write-Host "  Control D (Segunda ejecucion idempotente)      : $(if ($passD) {'PASS'} else {'FAIL'})" -ForegroundColor $(if ($passD) {'Green'} else {'Red'})

    # -------------------------------------------------------------------------
    # Comprobacion F: Rotacion explicita cambia solo valores previstos
    # -------------------------------------------------------------------------
    Write-Host "`n[FASE 3] Tercera ejecucion con -RotateCredentials..." -ForegroundColor Yellow
    & $ProvisionScript -EnvFile $tmpEnv -RotateCredentials -SkipDbApply

    $map3 = @{}
    Get-Content $tmpEnv | ForEach-Object {
        $t = $_.Trim()
        if ($t -and -not $t.StartsWith("#") -and $t.Contains("=")) {
            $p = $t.Split("=", 2)
            $map3[$p[0].Trim()] = $p[1].Trim()
        }
    }

    # Secretos deben haber rotado (diferentes a map2)
    $secretsRotated = ($map3["EMQX_RO_DB_PASS"] -ne $map2["EMQX_RO_DB_PASS"] -and
                       $map3["MQTT_PASS_PUB"] -ne $map2["MQTT_PASS_PUB"] -and
                       $map3["MQTT_PASS_SUB"] -ne $map2["MQTT_PASS_SUB"] -and
                       $map3["MQTT_PASS_NODES"] -ne $map2["MQTT_PASS_NODES"] -and
                       $map3["MQTT_PASS_BACKEND"] -ne $map2["MQTT_PASS_BACKEND"])

    # Variables ajenas y configuraciones no secretas NO deben haber cambiado
    $foreignPreserved = ($map3["CUSTOM_FOREIGN_VAR"] -eq "ValorAjen0_12345" -and
                         $map3["ANOTHER_CUSTOM_SETTING"] -eq "ConfiguracionExterna!99" -and
                         $map3["DB_HOST"] -eq $map2["DB_HOST"] -and
                         $map3["DB_NAME"] -eq $map2["DB_NAME"])

    $passF = ($secretsRotated -and $foreignPreserved)
    Write-Host "  Control F (Rotacion afecta solo secretos)      : $(if ($passF) {'PASS'} else {'FAIL'})" -ForegroundColor $(if ($passF) {'Green'} else {'Red'})

    # Resumen
    $allPass = ($passA -and $passB -and $passC -and $passD -and $passE -and $passF)
    Write-Host "`n=== RESUMEN DE PRUEBAS DE PRESERVACION DE .ENV ===" -ForegroundColor Cyan
    Write-Host "Resultado Global: $(if ($allPass) {'APROBADO (Todos los controles A-F superados)'} else {'REPROBADO'})" -ForegroundColor $(if ($allPass) {'Green'} else {'Red'})

    if (-not $allPass) {
        exit 1
    }
} finally {
    if (Test-Path $tmpEnv) {
        Remove-Item $tmpEnv -Force -ErrorAction SilentlyContinue
    }
}
exit 0

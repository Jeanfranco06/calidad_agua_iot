# Ejecutar como ADMINISTRADOR (clic derecho > Ejecutar con PowerShell).
# Abre en el firewall de Windows los puertos que usa la app movil, solo para la red local.
$ports = @{ 'TurbiSense MQTT WebSocket (EMQX)' = 8084; 'TurbiSense Web movil / APK' = 8086; 'TurbiSense MQTT TCP' = 1884 }
foreach ($name in $ports.Keys) {
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $ports[$name] `
        -Action Allow -Profile Private,Public -RemoteAddress LocalSubnet | Out-Null
    Write-Host "OK  puerto $($ports[$name])  ($name)"
}
Write-Host "`nListo. En el celular abre http://192.168.18.10:8084/ ; si responde algo (aunque sea un error), el puerto ya es alcanzable."

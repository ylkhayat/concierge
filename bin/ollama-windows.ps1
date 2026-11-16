# Llama's models in the Ollama app on Windows, for Concierge in WSL (profile ollama-windows in docker-compose.yml).
# The app reaches any GPU Windows has (an Intel or AMD one too, through Vulkan); Docker in WSL reaches only an NVIDIA
# one. This keeps the app listening on the address WSL reaches Windows by (WSL's own adapter: only WSL reaches it, never
# the network), with the GPU on, built-in ones included. That address can change when WSL restarts: every minute this
# moves the app to the current one, and starts the app when it isn't running.
#
# Once, from Windows PowerShell:  powershell -File \\wsl.localhost\<distro>\<path>\bin\ollama-windows.ps1 -Install
# copies this to %LOCALAPPDATA%\Concierge and runs it at every sign-in (and now), hidden.
param([switch]$Install)

$here = Join-Path $env:LOCALAPPDATA 'Concierge\ollama-windows.ps1'
if ($Install) {
    New-Item -ItemType Directory -Force (Split-Path $here) | Out-Null
    Copy-Item $PSCommandPath $here -Force
    $run = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$here`""
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName 'Concierge Ollama' -Action $run -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName 'Concierge Ollama'
    Write-Output "installed: $here runs at every sign-in"
    exit
}

$app = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
# as the container has them (docker-compose.yml), and the built-in GPU, which Ollama otherwise leaves out
$settings = @{ OLLAMA_IGPU_ENABLE = '1'; OLLAMA_CONTEXT_LENGTH = '32768'; OLLAMA_KEEP_ALIVE = '10m' }

function Set-Both($name, $value) {
    # for the user, so the app finds it when started from the Start menu or at sign-in, and for this process, whose
    # environment the app started from here inherits
    if ([Environment]::GetEnvironmentVariable($name, 'User') -ne $value) { [Environment]::SetEnvironmentVariable($name, $value, 'User') }
    Set-Item "env:$name" $value
}
foreach ($k in $settings.Keys) { Set-Both $k $settings[$k] }

while ($true) {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object InterfaceAlias -like 'vEthernet (WSL*' | Select-Object -First 1).IPAddress
    if ($ip) {
        $want = "${ip}:11434"
        if ($env:OLLAMA_HOST -ne $want -or [Environment]::GetEnvironmentVariable('OLLAMA_HOST', 'User') -ne $want) {
            # WSL came up on another address (or this is the first run): the app restarts there
            Set-Both 'OLLAMA_HOST' $want
            Get-Process 'ollama app', 'ollama' -ErrorAction SilentlyContinue | Stop-Process -Force
            Start-Sleep 2
        }
        if (-not (Get-Process 'ollama app' -ErrorAction SilentlyContinue)) { Start-Process $app }
    }
    Start-Sleep 60
}

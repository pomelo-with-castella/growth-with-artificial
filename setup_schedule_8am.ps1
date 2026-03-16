# Register a scheduled task: run AI dashboard update every day at 8:00 AM
# Usage (in PowerShell, as current user):
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
#   cd "C:\Users\19808\Desktop\claudetest - 副本"
#   .\setup_schedule_8am.ps1

$TaskName  = "AI_Dashboard_Daily_Update"
$ScriptDir = "C:\Users\19808\Desktop\claudetest - 副本"
$NodePath  = "node"
$ScriptPath = Join-Path $ScriptDir "fetch_news_and_analyze.js"

$Action   = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$ScriptPath`"" -WorkingDirectory $ScriptDir
$Trigger  = New-ScheduledTaskTrigger -Daily -At "08:00"
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Remove existing task with the same name if it exists
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Register new task
Register-ScheduledTask -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Run AI dashboard update daily at 08:00"

Write-Host "Created scheduled task: $TaskName (daily at 08:00)" -ForegroundColor Green
Write-Host "You can view/modify it in Task Scheduler." -ForegroundColor Cyan
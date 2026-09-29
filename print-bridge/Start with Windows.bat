@echo off
rem Adds a shortcut to the Startup folder so the Print Bridge starts minimised at every login.
set "TARGET=%~dp0Start Print Bridge.bat"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BillVyse Print Bridge.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); $s.TargetPath=$env:TARGET; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo BillVyse Print Bridge will now start by itself when Windows starts.
pause

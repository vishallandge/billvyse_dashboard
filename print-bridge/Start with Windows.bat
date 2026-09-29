@echo off
title BillVyse Print Bridge - setup
rem One double-click: the bridge starts now, in the background, and again by itself at
rem every Windows login. No window stays open.
set "LAUNCHER=%~dp0Print Bridge (background).vbs"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BillVyse Print Bridge.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); $s.TargetPath='wscript.exe'; $s.Arguments='\"' + $env:LAUNCHER + '\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
wscript.exe "%LAUNCHER%"
echo.
echo  BillVyse Print Bridge chalu ho gaya, aur ab computer on hote hi apne aap chalega.
echo  Ye window band kar sakte ho.
echo.
pause

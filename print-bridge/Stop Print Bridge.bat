@echo off
title BillVyse Print Bridge - stop
rem Stops the running bridge (whatever is listening on its port) and removes it from
rem Windows startup. Run "Start with Windows.bat" again to turn it back on.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "127.0.0.1:17777" ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BillVyse Print Bridge.lnk" >nul 2>&1
echo.
echo  BillVyse Print Bridge band ho gaya, aur ab apne aap nahi chalega.
echo.
pause

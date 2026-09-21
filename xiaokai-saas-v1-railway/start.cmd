@echo off
setlocal EnableExtensions

REM Always run from this project's own folder. Works with spaces and Chinese paths.
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Cannot enter the project folder:
  echo %~dp0
  echo.
  echo Move the whole project folder to a normal local disk folder and try again.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json was not found in:
  cd
  echo.
  echo Please keep start.cmd, package.json, server.js, public and src in the same folder.
  pause
  popd
  exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 18 or newer, then run this file again.
  pause
  popd
  exit /b 1
)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo A new .env file was created.
)

set "KIE_KEY="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /C:"KIE_API_KEY=" ".env" 2^>nul`) do set "KIE_KEY=%%B"
if not defined KIE_KEY (
  echo.
  echo KIE_API_KEY is empty. Notepad will open .env now.
  echo Paste your Kie API key after KIE_API_KEY= and save the file.
  echo.
  notepad.exe ".env"
  echo After saving and closing Notepad, press any key to continue.
  pause >nul
  set "KIE_KEY="
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B /C:"KIE_API_KEY=" ".env" 2^>nul`) do set "KIE_KEY=%%B"
  if not defined KIE_KEY (
    echo [ERROR] KIE_API_KEY is still empty.
    pause
    popd
    exit /b 1
  )
)

if not exist "node_modules\express\package.json" (
  echo.
  echo Installing dependencies for the first run...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    popd
    exit /b 1
  )
)

echo.
echo ==============================================
echo xiaokai SaaS V1 is starting...
echo Home: http://127.0.0.1:4318/
echo Dashboard: http://127.0.0.1:4318/dashboard
echo Health: http://127.0.0.1:4318/api/health
echo Credits: http://127.0.0.1:4318/api/credits
echo Press Ctrl+C to stop the server.
echo ==============================================
echo.

node.exe server.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Server exited with code %EXIT_CODE%.
pause
popd
exit /b %EXIT_CODE%

@echo off

setlocal
set "SCRIPT_DIR=%~dp0"
set "PLUGINS_DIR=%SCRIPT_DIR%plugins"
set "OUTPUT_DIR=%SCRIPT_DIR%src\main\resources"

:: Install dependencies
call npm install --silent --prefix "%PLUGINS_DIR%\JSEndpoints"
call npm install --silent --prefix "%PLUGINS_DIR%\JSParameters"
call npm install --silent --prefix "%PLUGINS_DIR%\JSRequests"

:: Build plugins
call esbuild "%PLUGINS_DIR%\JSParameters\JSParameters.js" --bundle --platform=node --minify --outfile="%OUTPUT_DIR%\JSParams\jsparams.js"
call esbuild "%PLUGINS_DIR%\JSEndpoints\JSEndpoints.js" --bundle --platform=node --minify --outfile="%OUTPUT_DIR%\JSEndpoints\jsendpoints.js"
call esbuild "%PLUGINS_DIR%\JSRequests\JSRequests.js" --bundle --platform=node --minify --outfile="%OUTPUT_DIR%\JSRequest\jsrequests.js"

echo All plugins built successfully
pause
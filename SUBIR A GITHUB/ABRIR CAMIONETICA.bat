@echo off
title Camionetica
cd /d "%~dp0"
echo Revisando... > registro.txt
where node >> registro.txt 2>&1
if errorlevel 1 (
  echo.
  echo  FALTA INSTALAR NODE.JS
  echo  Entra en https://nodejs.org , descarga la version LTS e instalala.
  echo  Luego vuelve a abrir este archivo.
  echo NO HAY NODE >> registro.txt
  echo.
  start "" https://nodejs.org/es
  pause
  exit
)
node -v >> registro.txt 2>&1
if not exist node_modules\express (
  echo  Preparando la app por primera vez, espera un momento...
  call npm install >> registro.txt 2>&1
)
echo.
echo  ==========================================
echo    CAMIONETICA esta encendida
echo    No cierres esta ventana mientras la uses
echo  ==========================================
echo.
start "" http://localhost:3000
node server.js 2>> registro.txt
echo.
echo  La app se detuvo. Avisale a Claude para que revise el archivo registro.txt
echo.
pause

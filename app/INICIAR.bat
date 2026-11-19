@echo off
title Painel Qualidade
cd /d "%~dp0"
set "PY="
where pyw >nul 2>nul && set "PY=pyw"
if exist "%~dp0python\pythonw.exe" set "PY=%~dp0python\pythonw.exe"
if defined PY goto rodar
echo Baixando o Python portatil, so na primeira vez...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip -OutFile python.zip; Expand-Archive python.zip -DestinationPath python -Force; Remove-Item python.zip"
set "PY=%~dp0python\pythonw.exe"
:rodar
start "" "%PY%" "%~dp0painel_app.py"

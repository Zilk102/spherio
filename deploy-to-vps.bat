@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo === Sphere3D: деплой на VPS ===
python --version >nul 2>&1 || (
  echo Установите Python 3.11+ и добавьте в PATH.
  exit /b 1
)

if not exist "deploy\keys\spherio_deploy" (
  echo Создаём SSH-ключ...
  python scripts\gen-deploy-key.py
)

if not exist "deploy\secrets\mail.local" (
  echo.
  echo Файл deploy\secrets\mail.local не найден.
  echo Скопируйте deploy\secrets\mail.local.example -^> mail.local и укажите SMTP_PASS.
  pause
  exit /b 1
)

pip install paramiko cryptography -q
python scripts\generate-prod-env.py
python scripts\deploy.py
if errorlevel 1 (
  echo.
  echo Деплой завершился с ошибкой.
  pause
  exit /b 1
)

echo.
echo OK: https://sphere3d.ru
pause

@echo off
setlocal
chcp 65001 >nul

set "ROOT_DIR=%~dp0"
set "ENV_FILE=%ROOT_DIR%backend\.env"
set "COMPOSE_FILE=%ROOT_DIR%backend\infra\compose.yaml"

echo ========================================================
echo  Khởi động Backend C48 và MinIO Community
echo ========================================================
echo.

if not exist "%ENV_FILE%" goto missing_env
where.exe docker >nul 2>&1
if errorlevel 1 goto docker_missing
docker info >nul 2>&1
if errorlevel 1 goto engine_unavailable

echo Đang build và khởi động các dịch vụ...
docker compose -p c48 --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" --profile seed --profile storage up --build -d
if errorlevel 1 goto startup_failed

echo.
echo Trạng thái các dịch vụ:
docker compose -p c48 --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" --profile seed --profile storage ps -a
if errorlevel 1 goto status_failed

echo.
echo Backend đã khởi động. Web và API: http://127.0.0.1:8080
goto success

:missing_env
echo Không tìm thấy backend\.env. Hãy tạo file này từ backend\.env.example và điền cấu hình theo docs\backend\00-setup.md.
goto failed

:docker_missing
echo Không tìm thấy Docker CLI. Hãy cài đặt Docker Desktop và mở lại file này.
goto failed

:engine_unavailable
echo Không kết nối được Docker Engine. Hãy mở Docker Desktop, đợi Engine sẵn sàng rồi chạy lại file.
goto failed

:startup_failed
echo Khởi động thất bại. Kiểm tra cấu hình trong backend\.env và Docker Compose logs.
goto failed

:status_failed
echo Không đọc được trạng thái dịch vụ. Hãy kiểm tra Docker Engine.
goto failed

:success
echo.
pause
endlocal
exit /b 0

:failed
echo.
pause
endlocal
exit /b 1

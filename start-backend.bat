@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo  Khởi động Backend C48: PostgreSQL, API, Nginx, MinIO nếu có giấy phép
echo ========================================================
echo.
set "STORAGE_LICENSE_PATH="
for /f "tokens=1,* delims==" %%A in ('findstr /b "AISTOR_LICENSE_PATH=" backend\.env') do set "STORAGE_LICENSE_PATH=%%B"
set "STORAGE_LICENSE_PATH=%STORAGE_LICENSE_PATH:"=%"
if defined STORAGE_LICENSE_PATH if exist "%STORAGE_LICENSE_PATH%" goto start_with_storage

echo Không tìm thấy tệp giấy phép AIStor. Đang khởi động backend không kèm MinIO.
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml up -d
if errorlevel 1 goto startup_failed
goto startup_succeeded

:start_with_storage
echo Tìm thấy tệp giấy phép AIStor. Đang khởi động backend kèm MinIO.
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml --profile storage up -d
if errorlevel 1 goto startup_failed

:startup_succeeded
echo.
echo Nạp lại Nginx để cập nhật địa chỉ các API.
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml restart nginx
if errorlevel 1 goto startup_failed
echo.
echo Trạng thái các dịch vụ Backend C48:
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml ps
if errorlevel 1 goto startup_failed
echo.
echo ========================================================
echo  Backend C48 đã sẵn sàng phục vụ Web và Mobile!
echo ========================================================
goto done

:startup_failed
echo.
echo Khởi động backend thất bại. Hãy xem log db-init và các dịch vụ phụ thuộc.
echo Lệnh xem log: docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml logs --tail=100 db-init identity-api response-api logistics-api nginx

:done
pause

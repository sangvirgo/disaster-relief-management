@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo  Khởi động Backend C48: PostgreSQL, API, Nginx và MinIO Community
echo ========================================================
echo.
echo Đang khởi động backend kèm profile storage (MinIO, không cần giấy phép).
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml --profile storage up --build -d
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
echo Khởi động backend thất bại. Hãy xem log các dịch vụ backend và MinIO.
echo Lệnh xem log: docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml --profile storage logs --tail=100 db-init identity-api response-api logistics-api minio minio-init nginx

:done
pause

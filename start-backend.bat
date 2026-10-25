@echo off
chcp 65001 >nul
echo ========================================================
echo  Khoi dong Backend C48: Postgres, APIs, Nginx, MinIO
echo ========================================================
echo.
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml --profile storage up -d
if errorlevel 1 goto startup_failed
echo.
echo Trang thai cac dich vu Backend C48:
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml ps
if errorlevel 1 goto startup_failed
echo.
echo ========================================================
echo  Backend C48 da san sang phuc vu Mobile va Web!
echo ========================================================
goto done

:startup_failed
echo.
echo Khoi dong backend that bai. Hay xem log db-init va cac dich vu phu thuoc.
echo Lenh xem log: docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml logs --tail=100 db-init

:done
pause

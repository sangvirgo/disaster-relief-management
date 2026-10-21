@echo off
chcp 65001 >nul
echo ========================================================
echo  Khoi dong Backend C48: Postgres, APIs, Nginx, MinIO
echo ========================================================
echo.
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml --profile storage up -d
echo.
echo Trang thai cac dich vu Backend C48:
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml ps
echo.
echo ========================================================
echo  Backend C48 da san sang phuc vu Mobile va Web!
echo ========================================================
pause

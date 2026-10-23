@echo off
chcp 65001 >nul
echo ========================================================
echo  Tam dung cac dich vu Backend C48 de giai phong RAM va CPU
echo ========================================================
echo.
docker compose -p c48 --env-file backend/.env -f backend/infra/compose.yaml --profile storage stop
echo.
echo ========================================================
echo  Da tam dung Backend C48 thanh cong.
echo ========================================================
pause

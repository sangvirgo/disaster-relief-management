#!/usr/bin/env bash
# Two-session race tests for the Logistics schema (T0-S exit gate, 01-schema-review.md §9.4).
# No arguments. Creates the fresh database hl_race, loads logistics.sql, builds its own fixtures and runs real
# two-session races: session 1 holds its transaction open for ~1 s after its statement; session 2 starts ~0.3 s later
# and must wait on the row lock / unique index. Prints PASS/FAIL per race and exits non-zero on any FAIL.
# Connection comes from the standard PG* environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD); defaults below.
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-x}"
DB=hl_race
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAILS=0

admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
q()     { psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

admin -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" 2>&1 | grep -v NOTICE
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/logistics.sql" >/dev/null || { echo "FAIL: logistics.sql did not load"; exit 2; }

U() { printf '00000000-0000-0000-0000-%012x' "$1"; }   # deterministic uuids
ORG=$(U 1); WH=$(U 2); ITEM=$(U 3)

# ---- shared fixtures ----
q <<SQL
INSERT INTO item_type VALUES ('FOOD','Lương thực'); INSERT INTO unit VALUES ('PIECE','cái',0);
INSERT INTO item (id,item_type_code,unit_code,name) VALUES ('$ITEM','FOOD','PIECE','Mì gói');
INSERT INTO warehouse (id,organization_id,region_code,name) VALUES ('$WH','$ORG','R1','Kho 1');
INSERT INTO fulfillment_cycle (id,request_id,work_cycle,organization_id) VALUES ('$(U 10)',gen_random_uuid(),1,'$ORG');
INSERT INTO relief_need (id,cycle_id,item_id,original_quantity,requested_quantity) VALUES ('$(U 11)','$(U 10)','$ITEM',50,50);
INSERT INTO commitment (id,relief_need_id,item_id,warehouse_id,quantity,created_by_user_id) VALUES ('$(U 12)','$(U 11)','$ITEM','$WH',50,gen_random_uuid());
SQL

# race <name> <session1 sql> <session2 sql>: runs both in real concurrent transactions; sets R1/R2 (psql exit codes) and E1/E2 (output)
race() {
  local n="$1"
  { echo "BEGIN;"; echo "$2"; echo "SELECT pg_sleep(1.0);"; echo "COMMIT;"; } > "$TMP/$n.1.sql"
  { echo "BEGIN;"; echo "$3"; echo "COMMIT;"; } > "$TMP/$n.2.sql"
  psql -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$DB" -f "$TMP/$n.1.sql" > "$TMP/$n.1.out" 2>&1 & local p1=$!
  sleep 0.3
  psql -X -q -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$DB" -f "$TMP/$n.2.sql" > "$TMP/$n.2.out" 2>&1 & local p2=$!
  wait $p1; R1=$?; wait $p2; R2=$?
  E1="$(grep -h 'ERROR' "$TMP/$n.1.out" | head -1)"; E2="$(grep -h 'ERROR' "$TMP/$n.2.out" | head -1)"
}
verdict() { # <name> <ok 0/1> <detail>
  if [ "$2" = 1 ]; then echo "PASS $1 - $3"; else echo "FAIL $1 - $3"; FAILS=$((FAILS+1)); fi
}
mv_sql() { # <balance> <type> <dh> <dr> <extra cols> <extra vals> <opref> <actor>
  echo "INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,$5operation_ref,actor_user_id) VALUES ('$1','$2',$3,$4,$6'$7','$8');"
}

# ---------- (a) two concurrent RESERVE 6 on on_hand 10 ----------
BA=$(U 100)
q <<SQL
INSERT INTO stock_balance (id,warehouse_id,item_id) VALUES ('$BA','$WH','$ITEM');
$(mv_sql $BA OPENING 10 0 "" "" open-a "$(U 900)")
SQL
race a "$(mv_sql $BA RESERVE 0 6 "commitment_id," "'$(U 12)'," res-a1 "$(U 901)")" "$(mv_sql $BA RESERVE 0 6 "commitment_id," "'$(U 12)'," res-a2 "$(U 902)")"
read -r ONH RES NMOV <<<"$(q -c "SELECT b.on_hand, b.reserved, (SELECT count(*) FROM stock_movement WHERE balance_id=b.id AND movement_type='RESERVE') FROM stock_balance b WHERE b.id='$BA'" | tr '|' ' ')"
ok=0; [ "$ONH" = 10.000 ] && [ "$RES" = 6.000 ] && [ "$NMOV" = 1 ] && [ $((R1==0)) = 1 ] && [ "$R2" != 0 ] && [[ "$E2" == *23514* ]] && ok=1
verdict "(a) concurrent RESERVE 6+6 on on_hand 10" $ok "on_hand=$ONH reserved=$RES reserve_movements=$NMOV s1_rc=$R1 s2_rc=$R2 s2_error='${E2:0:90}'"

# ---------- (b) same approved adjustment applied twice, different operation_ref ----------
BB=$(U 110); ADJ=$(U 111); REQ=$(U 903); REV=$(U 904)
q <<SQL
INSERT INTO item (id,item_type_code,unit_code,name) VALUES ('$(U 5)','FOOD','PIECE','Gạo đóng túi');
INSERT INTO stock_balance (id,warehouse_id,item_id) VALUES ('$BB','$WH','$(U 5)');
$(mv_sql $BB OPENING 10 0 "" "" open-b "$(U 900)")
INSERT INTO stock_adjustment (id,balance_id,delta_on_hand,reason,requested_by_user_id) VALUES ('$ADJ','$BB',3,'kiểm kê','$REQ');
UPDATE stock_adjustment SET status='APPROVED', reviewed_by_user_id='$REV', reviewed_at=now() WHERE id='$ADJ';
SQL
adj() { mv_sql $BB ADJUSTMENT 3 0 "adjustment_id," "'$ADJ'," "$1" "$REV"; }
race b "$(adj ADJ:b1)" "$(adj ADJ:b2)"
read -r ONH NMOV <<<"$(q -c "SELECT b.on_hand, (SELECT count(*) FROM stock_movement WHERE adjustment_id='$ADJ') FROM stock_balance b WHERE b.id='$BB'" | tr '|' ' ')"
ok=0; [ "$ONH" = 13.000 ] && [ "$NMOV" = 1 ] && [ "$R1" = 0 ] && [ "$R2" != 0 ] && [[ "$E2" == *23505* ]] && ok=1
verdict "(b) same approved adjustment applied twice" $ok "on_hand=$ONH adjustment_movements=$NMOV s1_rc=$R1 s2_rc=$R2 s2_error='${E2:0:90}'"

# ---------- (c) two RECEIPT movements for the same receipt + balance ----------
BC=$(U 120); DRV=$(U 121); DLV=$(U 122); RCP=$(U 123)
q <<SQL
INSERT INTO donation_drive (id,organization_id,intake_warehouse_id,title) VALUES ('$DRV','$ORG','$WH','Đợt 1');
INSERT INTO donation_delivery (id,public_code,drive_id,organization_id,donor_name,donor_phone) VALUES ('$DLV','RC000001','$DRV','$ORG','An','0900000001');
INSERT INTO donation_declaration (delivery_id,revision,created_by_kind) VALUES ('$DLV',1,'DONOR');
INSERT INTO donation_line VALUES ('$DLV',1,'$ITEM',20);
INSERT INTO donation_receipt (id,delivery_id,warehouse_id) VALUES ('$RCP','$DLV','$WH');
INSERT INTO receipt_count (receipt_id,revision,counted_by_user_id) VALUES ('$RCP',1,'$(U 905)');
INSERT INTO receipt_count_line VALUES ('$RCP',1,'$ITEM',20,20,0,0,NULL,NULL);
INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('$RCP','$DLV',1,1,'$(U 906)','APPROVE');
INSERT INTO item (id,item_type_code,unit_code,name) VALUES ('$(U 4)','FOOD','PIECE','Nước đóng chai');
INSERT INTO stock_balance (id,warehouse_id,item_id) VALUES ('$BC','$WH','$(U 4)');
SQL
rcpt() { mv_sql $BC RECEIPT 20 0 "receipt_id," "'$RCP'," "$1" "$2"; }
race c "$(rcpt RCPT:c1 "$(U 907)")" "$(rcpt RCPT:c2 "$(U 908)")"
read -r ONH NMOV <<<"$(q -c "SELECT b.on_hand, (SELECT count(*) FROM stock_movement WHERE receipt_id='$RCP' AND balance_id=b.id AND movement_type='RECEIPT') FROM stock_balance b WHERE b.id='$BC'" | tr '|' ' ')"
ok=0; [ "$ONH" = 20.000 ] && [ "$NMOV" = 1 ] && [ "$R1" = 0 ] && [ "$R2" != 0 ] && [[ "$E2" == *23505* ]] && ok=1
verdict "(c) same receipt posted twice (different operation_ref)" $ok "on_hand=$ONH receipt_movements=$NMOV s1_rc=$R1 s2_rc=$R2 s2_error='${E2:0:90}'"

# ---------- (d) two concurrent LOSS reviews on one handoff ----------
DIS=$(U 130); HO=$(U 131)
q <<SQL
INSERT INTO distribution (id,warehouse_id,organization_id,purpose,preparer_user_id) VALUES ('$DIS','$WH','$ORG','CAMPAIGN_DISTRIBUTION','$(U 909)');
INSERT INTO handoff_record (id,distribution_id,handoff_kind,source_stage,recorder_user_id,confirmation_basis,occurred_at) VALUES ('$HO','$DIS','LOSS','IN_TRANSIT','$(U 910)','mất hàng',now());
SQL
race d "INSERT INTO handoff_loss_review (handoff_id,reviewer_user_id,decision,reason) VALUES ('$HO','$(U 911)','APPROVE','đã xác minh');" \
       "INSERT INTO handoff_loss_review (handoff_id,reviewer_user_id,decision,reason) VALUES ('$HO','$(U 912)','REJECT','không xác minh được');"
NREV=$(q -c "SELECT count(*) FROM handoff_loss_review WHERE handoff_id='$HO'")
ok=0; [ "$NREV" = 1 ] && [ "$R1" = 0 ] && [ "$R2" != 0 ] && [[ "$E2" == *23505* ]] && ok=1
verdict "(d) two LOSS reviews on one handoff" $ok "loss_reviews=$NREV s1_rc=$R1 s2_rc=$R2 s2_error='${E2:0:90}'"

echo
if [ "$FAILS" -ne 0 ]; then echo "RESULT: $FAILS race(s) FAILED"; exit 1; fi
echo "RESULT: all races PASS"

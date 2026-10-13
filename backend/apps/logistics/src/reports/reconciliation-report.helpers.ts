export const physicalHandoffsLateralSql = `LEFT JOIN LATERAL (
           SELECT SUM(line.quantity) FILTER (
                    WHERE distribution_line.commitment_id IS NULL AND (
                      (distribution.relief_point_id IS NULL AND handoff.handoff_kind='DIRECT_HOUSEHOLD') OR
                      (distribution.relief_point_id IS NOT NULL AND handoff.handoff_kind='HOUSEHOLD_HANDOUT')
                    )
                  ) AS delivered,
                  SUM(line.quantity) FILTER (
                    WHERE handoff.handoff_kind='RETURN' AND NOT EXISTS (
                      SELECT 1 FROM issued_line_settlement settlement WHERE settlement.handoff_line_id=line.id
                    )
                  ) AS returned,
                  SUM(line.quantity) FILTER (
                    WHERE handoff.handoff_kind='LOSS' AND loss_review.decision='APPROVE' AND NOT EXISTS (
                      SELECT 1 FROM issued_line_settlement settlement WHERE settlement.handoff_line_id=line.id
                    )
                  ) AS lost
             FROM handoff_line line
             JOIN handoff_record handoff ON handoff.id=line.handoff_id
             JOIN distribution_line distribution_line ON distribution_line.id=line.distribution_line_id
             JOIN distribution distribution ON distribution.id=distribution_line.distribution_id
             LEFT JOIN handoff_loss_review loss_review ON loss_review.handoff_id=handoff.id
            WHERE distribution_line.warehouse_id=b.warehouse_id AND distribution_line.item_id=b.item_id
         ) physical_handoffs ON TRUE`;

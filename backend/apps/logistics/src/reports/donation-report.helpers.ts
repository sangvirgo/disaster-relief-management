export const finalDistributionHandoffPredicate = `((handoff.handoff_kind='DIRECT_HOUSEHOLD'
                  AND (commitment.id IS NULL OR need.designated_point_id IS NULL))
              OR handoff.handoff_kind='HOUSEHOLD_HANDOUT')`;

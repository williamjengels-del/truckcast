-- Fix the commission_with_minimum formula in the net_after_fees generated column.
-- The correct formula: operator keeps = gross - GREATEST(flat_minimum, gross * fee_rate / 100)
-- (organizer takes whichever is higher: flat minimum OR percentage of gross)

ALTER TABLE events DROP COLUMN net_after_fees;

ALTER TABLE events ADD COLUMN net_after_fees DECIMAL(10,2) GENERATED ALWAYS AS (
  CASE
    WHEN net_sales IS NULL THEN NULL
    WHEN fee_type = 'none' OR fee_type = 'pre_settled' THEN net_sales
    WHEN fee_type = 'flat_fee' THEN net_sales - COALESCE(fee_rate, 0)
    WHEN fee_type = 'percentage' THEN net_sales * (1 - COALESCE(fee_rate, 0) / 100)
    WHEN fee_type = 'commission_with_minimum' THEN
      net_sales - GREATEST(COALESCE(sales_minimum, 0), net_sales * COALESCE(fee_rate, 0) / 100)
    ELSE net_sales
  END
) STORED;

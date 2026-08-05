-- Add width/height to pnid_line so line annotations have proper bounding boxes,
-- matching pnid_equipment and pnid_instrument which already have these columns.
-- Without dimensions, line overlays render at the top-left corner of the detection
-- box instead of being properly sized and centered.

ALTER TABLE pnid_line
  ADD COLUMN IF NOT EXISTS annotation_w_pct DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS annotation_h_pct DECIMAL(5,2);

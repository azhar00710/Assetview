-- ═══════════════════════════════════════════════════════════════════
-- TRUNCATE ALL DATA — Keep schema, remove all rows
-- Run: psql $DATABASE_URL -f truncate_all.sql
-- ═══════════════════════════════════════════════════════════════════

-- Use TRUNCATE CASCADE to handle foreign key dependencies in one shot
TRUNCATE TABLE
  -- OCR & AI analysis tables
  ocr_extraction,
  ocr_job,
  ocr_batch_file,
  ocr_batch,
  ai_relationship,
  ai_generated_entity,
  ai_analysis_job,
  -- Annotation tables
  annotation_reply,
  annotation,
  annotation_snapshot,
  -- Junction tables
  pnid_instrument,
  pnid_equipment,
  pnid_line,
  pnid_system,
  -- Entity tables
  instrument,
  equipment,
  line,
  pnid,
  pnid_version,
  tag_document_link,
  -- Topology tables
  topology_edges,
  canvas_layout,
  topology_edge,
  topology_node,
  system_boundary,
  system_layout,
  -- Hierarchy
  system,
  platform,
  complex,
  field,
  location,
  concession,
  document_upload,
  list_upload_version,
  transmittal,
  project,
  client,
  storage_config,
  tag_dictionary,
  change_log
CASCADE;

-- Reset any sequences if needed
-- (UUID-based PKs don't use sequences, but just in case)

SELECT 'All data cleared. Database is empty and ready for fresh data.' AS status;

-- Migration: Add comprehensive engineering data columns to line table
-- Adds FROM/TO connections, fluid data, operating/design conditions (min/max),
-- test conditions, piping design, NDT, PWHT, and P&ID references

BEGIN;

-- FROM/TO connections (line-to-line, equipment, or descriptors)
ALTER TABLE line ADD COLUMN IF NOT EXISTS from_connection VARCHAR(500);
ALTER TABLE line ADD COLUMN IF NOT EXISTS to_connection VARCHAR(500);

-- Insulation details
ALTER TABLE line ADD COLUMN IF NOT EXISTS insulation_thickness VARCHAR(20);
ALTER TABLE line ADD COLUMN IF NOT EXISTS tracing VARCHAR(50);

-- Fluid data
ALTER TABLE line ADD COLUMN IF NOT EXISTS flow_medium VARCHAR(100);
ALTER TABLE line ADD COLUMN IF NOT EXISTS liquid_flow_bpd DECIMAL(12,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS water_flow_bwpd DECIMAL(12,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS gas_flow_mmscfd DECIMAL(12,4);
ALTER TABLE line ADD COLUMN IF NOT EXISTS viscosity_cp DECIMAL(10,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS molecular_weight DECIMAL(10,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS density_kg_m3 DECIMAL(10,2);

-- Operating conditions (min/max replaces single operating_pressure/temperature)
ALTER TABLE line ADD COLUMN IF NOT EXISTS operating_pressure_min DECIMAL(10,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS operating_pressure_max DECIMAL(10,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS operating_temperature_min DECIMAL(10,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS operating_temperature_max DECIMAL(10,2);

-- Design conditions (min/max replaces single design_pressure/temperature)
ALTER TABLE line ADD COLUMN IF NOT EXISTS design_pressure_min DECIMAL(10,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS design_pressure_max DECIMAL(10,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS design_temperature_min DECIMAL(10,2);
ALTER TABLE line ADD COLUMN IF NOT EXISTS design_temperature_max DECIMAL(10,2);

-- Test conditions
ALTER TABLE line ADD COLUMN IF NOT EXISTS test_medium VARCHAR(50);

-- Piping design
ALTER TABLE line ADD COLUMN IF NOT EXISTS design_code VARCHAR(100);
ALTER TABLE line ADD COLUMN IF NOT EXISTS schedule_wall_thickness VARCHAR(100);
ALTER TABLE line ADD COLUMN IF NOT EXISTS stress_relief VARCHAR(10);
ALTER TABLE line ADD COLUMN IF NOT EXISTS nace_mr0175 VARCHAR(10);

-- NDT
ALTER TABLE line ADD COLUMN IF NOT EXISTS ndt_rt_pct DECIMAL(5,1);
ALTER TABLE line ADD COLUMN IF NOT EXISTS ndt_dpi_pct DECIMAL(5,1);
ALTER TABLE line ADD COLUMN IF NOT EXISTS ndt_mpi_pct DECIMAL(5,1);
ALTER TABLE line ADD COLUMN IF NOT EXISTS pwht VARCHAR(10);

-- P&ID references (comma-separated drawing numbers)
ALTER TABLE line ADD COLUMN IF NOT EXISTS pnid_references VARCHAR(500);

-- Remarks
ALTER TABLE line ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Migrate existing data from old columns to new columns where applicable
UPDATE line SET from_connection = from_equipment_tag WHERE from_equipment_tag IS NOT NULL AND from_connection IS NULL;
UPDATE line SET to_connection = to_equipment_tag WHERE to_equipment_tag IS NOT NULL AND to_connection IS NULL;
UPDATE line SET design_pressure_max = design_pressure WHERE design_pressure IS NOT NULL AND design_pressure_max IS NULL;
UPDATE line SET design_temperature_max = design_temperature WHERE design_temperature IS NOT NULL AND design_temperature_max IS NULL;
UPDATE line SET operating_pressure_max = operating_pressure WHERE operating_pressure IS NOT NULL AND operating_pressure_max IS NULL;
UPDATE line SET operating_temperature_max = operating_temperature WHERE operating_temperature IS NOT NULL AND operating_temperature_max IS NULL;

COMMIT;

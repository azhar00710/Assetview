/**
 * P&ID Symbol Map
 *
 * Maps database type strings to SVG symbol components from pid-symbols.js.
 */

import {
  // Equipment
  ChristmasTree,
  ChokeValve,
  SafetyValve,
  SpectacleBind,
  Header,
  Vessel,
  Package,
  Pump,
  Separator,
  HeatExchanger,
  Tank,
  FilterStrainer,
  Compressor,
  // Valves
  GateValve,
  GlobeValve,
  BallValve,
  CheckValve,
  ControlValve,
  ButterflyValve,
  NeedleValve,
  // Instruments
  InstrumentFieldMounted,
  InstrumentPanelMounted,
  InstrumentDCS,
  InstrumentSafety,
} from './pid-symbols';

// ─── Equipment type → symbol component ───────────────────────────────
const equipmentMap = {
  'Christmas Tree': ChristmasTree,
  'Choke Valve': ChokeValve,
  'Safety Valve': SafetyValve,
  'Spectacle Blind': SpectacleBind,
  'Header': Header,
  'Vessel': Vessel,
  'Package': Package,
  'Pump': Pump,
  'Separator': Separator,
  'Heat Exchanger': HeatExchanger,
  'Tank': Tank,
  'Filter/Strainer': FilterStrainer,
  'Compressor': Compressor,
};

// ─── Valve type → symbol component ───────────────────────────────────
const valveMap = {
  'Gate Valve': GateValve,
  'Globe Valve': GlobeValve,
  'Ball Valve': BallValve,
  'Check Valve': CheckValve,
  'Control Valve': ControlValve,
  'Butterfly Valve': ButterflyValve,
  'Needle Valve': NeedleValve,
};

// ─── Instrument location → symbol component ─────────────────────────
const instrumentLocationMap = {
  'Field': InstrumentFieldMounted,
  'Field-mounted': InstrumentFieldMounted,
  'Panel': InstrumentPanelMounted,
  'Panel-mounted': InstrumentPanelMounted,
  'DCS': InstrumentDCS,
  'DCS/SCADA': InstrumentDCS,
  'SCADA': InstrumentDCS,
  'Safety': InstrumentSafety,
  'SIS': InstrumentSafety,
};

/**
 * Get the SVG symbol component for an equipment type.
 * Falls back to Vessel if type is unrecognized.
 *
 * @param {string} equipmentType - DB equipment_type value
 * @returns {Function} React component returning SVG
 */
export function getEquipmentSymbol(equipmentType) {
  return equipmentMap[equipmentType] || valveMap[equipmentType] || Vessel;
}

/**
 * Get the SVG symbol component for an instrument.
 * The location determines the bubble style (field, panel, DCS, safety).
 * Falls back to field-mounted if location is unrecognized.
 *
 * @param {string} instrumentType - Instrument type string (e.g. "PT", "FT")
 * @param {string} location - Mounting location from DB
 * @returns {Function} React component returning SVG
 */
export function getInstrumentSymbol(instrumentType, location) {
  return instrumentLocationMap[location] || InstrumentFieldMounted;
}

/**
 * Get the SVG symbol component for a valve type.
 * Falls back to GateValve if type is unrecognized.
 *
 * @param {string} valveType - Valve type string from DB
 * @returns {Function} React component returning SVG
 */
export function getValveSymbol(valveType) {
  return valveMap[valveType] || GateValve;
}

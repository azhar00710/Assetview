import EquipmentNode from './EquipmentNode';
import InstrumentNode from './InstrumentNode';
import CollapsedGroupNode from './CollapsedGroupNode';
import SystemGatewayNode from './SystemGatewayNode';
import TeeNode from './TeeNode';

/** Maps node type strings to React Flow node components */
const nodeRegistry = {
  equipment: EquipmentNode,
  instrument: InstrumentNode,
  collapsedGroup: CollapsedGroupNode,
  gateway: SystemGatewayNode,
  tee: TeeNode,
};

export default nodeRegistry;

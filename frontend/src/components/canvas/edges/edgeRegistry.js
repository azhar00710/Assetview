import PipeEdge from './PipeEdge';
import SignalEdge from './SignalEdge';
import BoundaryEdge from './BoundaryEdge';
import UtilityEdge from './UtilityEdge';

/** Maps edge type strings to React Flow edge components */
const edgeRegistry = {
  pipe: PipeEdge,
  signal: SignalEdge,
  boundary: BoundaryEdge,
  utility: UtilityEdge,
};

export default edgeRegistry;

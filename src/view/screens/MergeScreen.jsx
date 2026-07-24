// Merge context panel (below the persistent combat panel): the scrollable order
// tray + the 7×6 merge board.
import Orders from '../Orders.jsx';
import Board from '../Board.jsx';

export default function MergeScreen() {
  return (
    <div className="merge-context">
      <Orders />
      <div className="board-area">
        <Board />
      </div>
    </div>
  );
}

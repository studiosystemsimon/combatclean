// A single board cell: item, generator, or tappable reward token. Presentational.
import { itemAsset, generatorAsset, mergeStyle } from './assets.js';
import Art from './Art.jsx';

export default function Cell({ index, cell, dragging, over, onPointerDown }) {
  let a = null;
  let cls = 'cell';
  const special = !!(cell && cell.kind === 'item' && cell.special); // S-tile — rendered as an "S", no chain art
  if (cell) {
    if (cell.kind === 'item') {
      if (!special) a = itemAsset(cell.chain, cell.level);
      cls += special ? ' cell-item cell-special' : ' cell-item';
    } else if (cell.kind === 'generator') {
      a = generatorAsset(cell.genId, cell.level);
      cls += ' cell-generator';
    }
  }
  if (dragging) cls += ' cell-dragging';
  if (over) cls += ' cell-over';

  return (
    <div className={cls} data-cell-index={index} onPointerDown={cell ? (e) => onPointerDown(e, index) : undefined}>
      {special ? (
        <span key={cell.id} className="cell-art cell-s">S</span>
      ) : a && (
        <span key={cell.id} className="cell-art">
          {/* Merge items AND generators render 1:1 with the trim tool: reg-point → tile centre +
              per-icon scale + rotation (mergeStyle). */}
          <Art a={a} className="cell-emoji" style={mergeStyle(a)} />
        </span>
      )}
      {cell && cell.kind === 'generator' && <span className="cell-badge">⚡</span>}
    </div>
  );
}

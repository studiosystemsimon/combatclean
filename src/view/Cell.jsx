// A single board cell: item, generator, or tappable reward token. Presentational.
import { itemAsset, generatorAsset, mergeStyle } from './assets.js';
import Art from './Art.jsx';

export default function Cell({ index, cell, dragging, over, onPointerDown }) {
  let a = null;
  let cls = 'cell';
  if (cell) {
    if (cell.kind === 'item') {
      a = itemAsset(cell.chain, cell.level);
      cls += ' cell-item';
    } else if (cell.kind === 'generator') {
      a = generatorAsset(cell.genId);
      cls += ' cell-generator';
    }
  }
  if (dragging) cls += ' cell-dragging';
  if (over) cls += ' cell-over';

  return (
    <div className={cls} data-cell-index={index} onPointerDown={cell ? (e) => onPointerDown(e, index) : undefined}>
      {a && (
        <span key={cell.id} className="cell-art">
          {/* Merge items render 1:1 with the trim tool: reg-point → tile centre + per-icon scale +
              rotation (mergeStyle). Generators fill the box as before. */}
          <Art a={a} className="cell-emoji" style={cell.kind === 'item' ? mergeStyle(a) : undefined} />
        </span>
      )}
      {cell && cell.kind === 'generator' && <span className="cell-badge">⚡</span>}
    </div>
  );
}

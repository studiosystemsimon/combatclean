// Test minigame — a single centered button. Clicking it completes the game, returning a result
// data structure ({ score }) to the harness. Proves the harness contract: input in, result out.
export default function TestButtonGame({ input, onComplete }) { // eslint-disable-line no-unused-vars
  return (
    <div className="mg-test">
      <button type="button" className="mg-test-btn" onClick={() => onComplete({ score: 1 })}>Click me</button>
    </div>
  );
}

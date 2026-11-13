// The 3D event queue's order (13 Nov, his note: his whisper's answer waited behind minutes of other nations'
// events). Your own nations' records go ahead of everything else, after yours already waiting; the rest keep
// their order. Returns the new queue (the input arrays aren't changed).
export function mergeQueue(queue, records, isMine = () => false) {
  const mine = (r) => { try { return !!isMine(r); } catch { return false; } };
  const ownWaiting = queue.filter(mine), rest = queue.filter((r) => !mine(r));
  const ownNew = records.filter(mine), restNew = records.filter((r) => !mine(r));
  return [...ownWaiting, ...ownNew, ...rest, ...restNew];
}

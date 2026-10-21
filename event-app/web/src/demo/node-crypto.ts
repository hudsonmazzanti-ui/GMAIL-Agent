/** Browser stand-in for the bits of `node:crypto` the server modules use. */
class HexBytes extends Uint8Array {
  toString(encoding?: string) {
    if (encoding === 'hex') return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
    return super.toString();
  }
  subarray(begin?: number, end?: number): HexBytes {
    return new HexBytes(Uint8Array.prototype.slice.call(this, begin, end));
  }
}

export function randomBytes(n: number): HexBytes {
  return new HexBytes(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

export function randomInt(max: number): number {
  return Math.floor((globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * max);
}

export default { randomBytes, randomInt };

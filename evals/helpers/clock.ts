export interface Clock {
  now(): Date;
}

export class ControlledClock implements Clock {
  #current: Date;

  constructor(initialIsoTime: string) {
    this.#current = parseIso(initialIsoTime);
  }

  now(): Date {
    return new Date(this.#current);
  }

  set(isoTime: string): void {
    const next = parseIso(isoTime);
    if (next < this.#current) throw new RangeError('ControlledClock cannot move backwards');
    this.#current = next;
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError('Clock advancement must be a non-negative finite number');
    }
    this.#current = new Date(this.#current.getTime() + milliseconds);
  }
}

function parseIso(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`Expected a canonical UTC ISO timestamp, received ${value}`);
  }
  return parsed;
}

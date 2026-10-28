import { EventEmitter } from "node:events";

/** In-process signal bus. Every ledger write emits here so the Director can react at once. */
export interface Signal { type: string; actor: string; playerId: string | null; payload: any; at: string }

class Bus extends EventEmitter {
  emitSignal(s: Signal) {
    // Emit on the next tick so the originating transaction has committed before listeners read.
    setImmediate(() => { this.emit("signal", s); this.emit(s.type, s); });
  }
  onSignal(fn: (s: Signal) => void) { this.on("signal", fn); return () => this.off("signal", fn); }
}
export const bus = new Bus();
bus.setMaxListeners(50);

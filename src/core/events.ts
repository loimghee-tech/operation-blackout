/**
 * Tiny typed event bus used for cross-system communication
 * (missions <-> AI <-> UI <-> audio). Keeps systems decoupled.
 */
export type Handler<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private map = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Handler<Events[K]>): void {
    this.map.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    // copy so handlers may unsubscribe during dispatch
    for (const fn of Array.from(set)) {
      try {
        (fn as Handler<Events[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] handler error for "${String(type)}":`, err);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}

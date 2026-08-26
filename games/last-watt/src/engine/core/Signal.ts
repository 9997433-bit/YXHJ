export type Listener<T> = (payload: T) => void;

/**
 * Minimal synchronous event hook. Subscribing returns the unsubscribe function
 * so callers never have to hold on to the original reference.
 */
export class Signal<T = void> {
  private readonly listeners = new Set<Listener<T>>();

  add(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  once(listener: Listener<T>): () => void {
    const off = this.add((payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  remove(listener: Listener<T>): void {
    this.listeners.delete(listener);
  }

  emit(payload: T): void {
    // Copy: listeners are allowed to unsubscribe themselves mid-dispatch.
    for (const listener of [...this.listeners]) listener(payload);
  }

  clear(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}

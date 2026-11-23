/**
 * Estado observável mínimo. Toda a interface lê daqui e reage a mudanças;
 * nenhuma parte da UI guarda cópia própria do estado.
 *
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();

  return {
    /** @returns {T} */
    get() {
      return state;
    },

    /** @param {Partial<T> | ((s: T) => Partial<T>)} patch */
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      const prev = state;
      state = { ...state, ...next };
      listeners.forEach((fn) => fn(state, prev));
    },

    /** @param {(state: T, prev: T) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

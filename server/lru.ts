// A Map that holds at most `max` entries: reading one makes it the newest, and adding past the limit drops the one
// read longest ago. For caches of what can be read or fetched again, which otherwise only grow for as long as the
// server runs.
export class Lru<K, V> extends Map<K, V> {
  private max: number
  constructor(max: number) { super(); this.max = max }
  get(k: K): V | undefined {
    if (!super.has(k)) return undefined
    const v = super.get(k)!
    super.delete(k); super.set(k, v)
    return v
  }
  set(k: K, v: V): this {
    super.delete(k); super.set(k, v)
    while (this.size > this.max) super.delete(this.keys().next().value as K)
    return this
  }
}

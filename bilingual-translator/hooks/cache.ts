export type PairEntry = [string, string]

export class BoundedCache {
  private readonly maxEntries: number
  private readonly map = new Map<string, string>()

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries
  }

  get(key: string): string | undefined {
    const normalized = key.trim()
    return this.map.get(key) ?? this.map.get(normalized)
  }

  set(key: string, value: string): void {
    const normalized = key.trim()
    if (this.map.has(normalized)) this.map.delete(normalized)
    this.map.set(normalized, value)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  load(raw: unknown): void {
    if (!Array.isArray(raw)) return
    for (const item of raw) {
      if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string') {
        this.set(item[0], item[1])
      }
    }
  }

  export(): PairEntry[] {
    return [...this.map.entries()]
  }
}

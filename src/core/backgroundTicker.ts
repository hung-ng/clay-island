/**
 * Ticks from a Web Worker so hidden tabs keep receiving them. The game loop
 * measures real elapsed time itself, so sparse ticks batch catch-up rather
 * than defining simulation speed.
 */
export function createBackgroundTicker(
  onTick: () => void,
  intervalMs = 500,
): { start(): void; stop(): void } {
  let worker: Worker | null = null
  let workerUrl: string | null = null
  let fallback = 0

  return {
    start(): void {
      if (worker || fallback) return
      try {
        const source = `setInterval(() => postMessage(0), ${intervalMs})`
        workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        worker = new Worker(workerUrl)
        worker.onmessage = () => onTick()
      } catch {
        fallback = window.setInterval(onTick, intervalMs)
      }
    },

    stop(): void {
      worker?.terminate()
      worker = null
      if (workerUrl) URL.revokeObjectURL(workerUrl)
      workerUrl = null
      if (fallback) clearInterval(fallback)
      fallback = 0
    },
  }
}

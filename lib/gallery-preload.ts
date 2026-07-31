export function isInPreloadBuffer(
  index: number,
  activeIndex: number,
  windowRadius: number,
  preloadRadius: number
): boolean {
  const distance = Math.abs(index - activeIndex)
  return distance > windowRadius && distance <= preloadRadius
}
